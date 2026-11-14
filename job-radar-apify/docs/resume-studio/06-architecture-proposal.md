# 06 — Architecture Proposal

**Fecha:** 2026-11-14 · **Marcas:** [V] verificado · [P] propuesto · [?] pendiente

| Tema | Estado |
|---|---|
| Stack actual | [V] auditoría del repo, §1 |
| Componentes y modelo de datos nuevos | [P] §2–§4 |
| Reutilización de Wompi | [V] lectura de código · [P] cambios §7 |
| Tablas viejas del CV Generator | [V] siguen en `schema.sql` · [?] auditoría en Supabase antes de decidir, §4.3 |
| Costos y precio | [V] tarifas · [P] cálculo y precio, §9 |

## 1. Lo que ya existe [V]

| Pieza | Dónde | Uso en el Resume Studio |
|---|---|---|
| Vite 8 + React 19 + react-router 7 | `package.json`, `src/App.tsx:110-190` | Rutas nuevas con *lazy import* |
| Servidor Node `http` propio | `src/server.ts` (3.314 líneas; `createServer` :739) | Rutas `/api/resume/*` en un módulo aparte (`src/server/routes/resume.ts`), como `agent-readiness.ts` |
| Supabase Auth (Google + correo/contraseña) | `src/auth/auth-provider.tsx:172,190,199`; `src/auth/verify-session.ts:30-46` | Mismo `verifySession` en todas las rutas privadas |
| Tabla `users` | `src/db/schema.sql:103` | `user_id` de las tablas nuevas |
| Postgres vía `pg` como `postgres` (BYPASSRLS), RLS activo sin políticas + `REVOKE` a `anon`/`authenticated` | `schema.sql:705-748`; `docs/SECURITY-AUDIT-2026-08-02.md:39-45` | Mismo patrón: el navegador nunca toca las tablas; todo pasa por el servidor con chequeo de `user_id` |
| Wompi Web Checkout + webhook | `src/payments/checkout.ts`, `src/payments/webhook.ts`, rutas `server.ts:1491-1539,1543` | Reutilizar firma de integridad y verificación de eventos con un discriminador de producto (§7) |
| Design system | `src/index.css:10-42,246-259`, `src/lib/brand-tints.ts`, `src/components/ContentPage.tsx` | Todas las pantallas |
| Analítica | `src/lib/analytics.ts:97` (`trackEvent`) | Solo eventos sin datos del CV |
| IA | **No hay** integración en `src/` (se borró en `053a21a`) | Módulo nuevo, mínimo |
| PDF/DOCX/subida | **No hay** dependencias (se borraron pdfkit, docx, mammoth, pdf-parse, busboy) | Ver §5–§6 |

Render: AGENTS.md fija **Starter, USD 7/mes**, pero `render.yaml:23` dice
`plan: free` [V]. El archivo puede no reflejar el plan del panel [?]. En
cualquier caso, Starter tiene 512 MB [V: render.com/pricing], así que nada
pesado corre en el servidor.

## 2. Vista general [P]

```
Navegador (React)                         Servidor Node (Render)                 Externos
─────────────────                         ───────────────────────                ─────────
/hoja-de-vida/*  (lazy)                   src/server/routes/resume.ts
  Onboarding, editor, vista previa  ───►    verifySession / sesión anónima
  Render del CV en HTML (plantillas)        rate limit + presupuesto por usuario
  PDF en el cliente (§6)                    resume/extract.ts  ── texto ──►  ┐
  Borrador en localStorage                  resume/ai-gateway.ts ──────────► │ Proveedor IA (alias)
                                            resume/analyze.ts (código)       ┘
                                            resume/score.ts   (código)
                                            resume/consent.ts
                                            payments/* (+ producto resume_unlock) ──► Wompi
                                            Postgres (Supabase) tablas rs_*
```

Principio: **módulo aparte**, sin tocar el código de vacantes, búsqueda ni la
caché del dashboard (`docs/DASHBOARD-PERFORMANCE-RUNBOOK.md`). El único cambio
en páginas existentes es un enlace en `JobDetailPanel.tsx` después del CTA de
aplicar (`:224-234`) [V: ubicación], detrás de una bandera.

## 3. Banderas [P]

| Bandera | Por defecto | Efecto |
|---|---|---|
| `RESUME_STUDIO_ENABLED` | `false` | Rutas `/hoja-de-vida/*` y `/api/resume/*` responden 404 |
| `RESUME_STUDIO_JOB_CTA` | `false` | Muestra el botón en la vacante |
| `RESUME_STUDIO_PAYMENTS` | `false` | Permite crear checkouts `resume_unlock` |
| `RESUME_AI_PROVIDER` | `none` | Alias del modelo; `none` = solo edición manual |

**No comparte nada con `PAYWALL_ENABLED`**, que sigue en `false`.

## 4. Modelo de datos [P]

Tablas nuevas con prefijo `rs_`, migración aditiva (`ADD … IF NOT EXISTS`,
patrón `scripts/migrate-*.ts`), RLS activo sin políticas y `REVOKE ALL` a
`anon`/`authenticated`, como el resto del esquema.

| Tabla | Columnas clave | Notas |
|---|---|---|
| `rs_consents` | id, user_id (nullable), anon_session_id, purpose (`cv_processing`, `cloud_storage`), policy_version, granted (bool), text_hash, ip_hash, user_agent_hash, created_at, revoked_at | **Solo inserciones.** Revocar = fila nueva. Sin IP en claro. |
| `rs_resumes` | id, user_id, title, template_id, facts_json (cifrado de aplicación, §8 del doc 08), status, created_at, updated_at, last_used_at | Base y adaptadas. Límite 1 base + 5 adaptadas activas. |
| `rs_resume_versions` | id, resume_id, version_no, facts_json, change_summary, created_by (`user`/`ai_accepted`), created_at | Historial; deshacer en el servidor. Máx. 50 por CV (se podan las más viejas). |
| `rs_job_analyses` | id, resume_id, job_id (ON DELETE SET NULL), job_snapshot_json, requirements_json, evidence_json, score_json, formula_version, created_at | La foto de la vacante sobrevive a su borrado o archivo. |
| `rs_ai_usage` | id, user_id, stage, model_alias, input_tokens, output_tokens, cost_usd, cached, created_at | Sin contenido. Alimenta presupuestos y la tabla de costos real. |
| `rs_entitlements` | id, user_id, resume_id, transaction_reference, unlocked_at, expires_at | Qué versiones se pueden descargar. |
| `transactions` (existe) | + columna `product` (`subscription` por defecto, `resume_unlock`) | Ver §7. |

Archivos subidos: **no se guardan**. Se leen en memoria, se extrae el texto y
se descartan. Se guarda solo `facts_json`. Si el producto necesita guardar el
original [?], iría a Supabase Storage privado con URL firmada de corta
duración.

### 4.3 Tablas del CV Generator retirado [V hechos · ? decisión]

- En `schema.sql`: `cv_profiles` (:274), `cv_generations` (:321),
  `llm_response_cache` (:362), `llm_usage_ledger` (:393),
  `user_ai_credentials` (:416), columna `users.resume_studio_beta` (:125).
- `cv_pii_vault` **no está en el repo**; solo en
  `docs/SUPABASE-ADVISOR-2026-10-25.md:9`: tenía RLS apagado y permisos
  completos para `anon` y `authenticated`, 0 filas; se corrigió el 2026-10-25.
- Propuesta: **no reutilizarlas**. Antes de la implementación, auditar en
  Supabase (solo lectura): filas, grants, políticas, y si hay datos personales.
  Luego decidir con el propietario borrarlas o archivarlas en una migración
  separada. Reutilizar nombres viejos mezcla un diseño con BYOK y créditos que
  ya no aplica.

## 5. Extracción de documentos [P]

- Subida por `multipart` con límite duro de 2 MB en el servidor (corte del
  stream, no después de leer), tipos permitidos por **firma de bytes** (PDF
  `%PDF-`, DOCX = ZIP con `word/document.xml`), máx. 4 páginas.
- Librerías: una para PDF y una para DOCX, puras JS, sin binarios nativos
  [?: elegir en R1 con criterio de mantenimiento, licencia y CVE; las
  anteriores fueron pdf-parse y mammoth].
- DOCX: se rechazan macros (`vbaProject.bin`), objetos incrustados y
  relaciones externas. PDF: se rechazan cifrados y con JavaScript/acciones.
- Tiempo máximo de parseo 5 s; fuera de eso, error.
- Alternativa sin subida: «Pegar texto» (cero parseo binario en el servidor).

## 6. Render y descarga [P]

- Plantillas en React (HTML/CSS), las mismas en vista previa y en el PDF.
- **PDF en el cliente.** Dos opciones a evaluar en R2:
  1. Generar el PDF en el navegador con una librería JS (texto real,
     seleccionable). Pros: cero carga en Render. Contras: peso del bundle
     solo en `/hoja-de-vida`.
  2. `window.print()` con hoja de estilos de impresión. Pros: cero
     dependencias. Contras: el resultado depende del navegador; difícil de
     controlar márgenes en móvil.
- **No** Chromium/Puppeteer en el servidor: no cabe en 512 MB junto al resto
  [riesgo, ver §10].
- Desbloqueo: el servidor entrega el `facts_json` sin marca de agua solo si
  hay un `rs_entitlements` vigente. La vista previa con marca de agua se
  pinta en el cliente. [?: un usuario técnico puede quitar la marca de agua
  de la vista previa en su navegador; se acepta el riesgo porque el costo
  por CV es bajo y el valor está en el análisis y la edición.]
- DOCX: opcional en R4 con una librería JS en el cliente [?].

## 7. Pagos: reutilizar Wompi sin tocar el paywall [V código · P cambios]

Hoy [V]:

- `startPaymentCheckout` arma la referencia `jobradar_${plan}_${userId}_${Date.now()}`,
  guarda una fila `pending` en `transactions` con `plan` y devuelve la firma
  de integridad `sha256(reference+amountInCents+"COP"+WOMPI_INTEGRITY_SECRET)`
  (`src/payments/checkout.ts`).
- `POST /api/checkout/start` responde 404 si `PAYWALL_ENABLED` es `false`
  (`server.ts:1491-1539`).
- El webhook verifica el checksum con
  `sha256(valores de signature.properties + timestamp + WOMPI_EVENTS_SECRET)`
  comparado con `===` (`webhook.ts:53-63`); en `APPROVED`,
  `markTransactionApproved` es idempotente y luego **sube el `subscription_tier`
  del usuario** (`job-repository.ts:1884,1894,1958`).
- **No** comprueba que el monto pagado coincida con `amount_in_cents`
  guardado. La comparación no es de tiempo constante.

Cambios propuestos:

1. Ruta nueva `POST /api/resume/checkout` (no la de suscripción), protegida
   por `RESUME_STUDIO_PAYMENTS`, no por `PAYWALL_ENABLED`.
2. Referencia `rs_unlock_<resumeId>_<userId>_<ts>`; `transactions.product =
   'resume_unlock'`; precio constante `RESUME_UNLOCK_PRICE_COP` en
   `src/config.ts`.
3. El webhook ramifica por `product`: `resume_unlock` crea `rs_entitlements`
   y **nunca** toca `users.subscription_tier`.
4. Arreglos de seguridad del webhook, que benefician a ambos productos:
   comparar el monto aprobado con el guardado; `crypto.timingSafeEqual`.
   [Estos dos hallazgos son de la auditoría de este diseño; se proponen como
   cambio aparte, no se aplican ahora.]
5. Desbloqueo solo por webhook verificado (o consulta de transacción a la
   API de Wompi), nunca por la URL de retorno.

## 8. Consentimiento y derechos [P]

Detalle legal en el doc 07. Técnicamente:

- Pantalla S3 antes de cualquier procesamiento; inserta en `rs_consents`.
- El servidor rechaza `/api/resume/extract` y llamadas IA sin un
  consentimiento `cv_processing` vigente para ese usuario/sesión.
- «Mi cuenta → Datos y privacidad»: exportar (JSON), corregir (editor),
  borrar todo (job de borrado ≤ 24 h), revocar.
- Retención: borrado automático tras 12 meses sin uso [P; ?: validar plazo
  con abogado], con aviso por correo 30 días antes.

## 9. Costos y precio

### 9.1 Costo variable por CV pagado [V tarifas · P supuestos]

Tarifa Wompi publicada: **2,65 % + COP 700 + IVA** sobre la comisión
(`wompi.com/es/co/planes-tarifas`, Plan Avanzado, consultado 2026-11-14). No
hay desglose oficial por medio de pago [?].

| Concepto | P = COP 9.900 | P = COP 12.300 | P = COP 14.900 |
|---|---|---|---|
| IVA por la venta, si el vendedor es responsable de IVA (19 % incluido en el precio) [?] | 1.581 | 1.964 | 2.379 |
| Base sin IVA | 8.319 | 10.336 | 12.521 |
| Comisión Wompi (2,65 % × P + 700) × 1,19 | 1.145 | 1.221 | 1.303 |
| IA, escenario pesado con Gemini 2.5 Flash-Lite (USD 0,038 × 4.000) | 152 | 152 | 152 |
| IA de usuarios que no pagan (supuesto: 10 CV gratis por cada pago, escenario medio USD 0,0126 × 10 × 4.000) | 504 | 504 | 504 |
| Reserva de reembolsos y contracargos (3 %) [P] | 297 | 369 | 447 |
| **Margen bruto con IVA** | **6.221 (63 %)** | **8.090 (66 %)** | **10.115 (68 %)** |
| **Margen bruto sin IVA** (vendedor no responsable) | **7.802 (79 %)** | **10.054 (82 %)** | **12.494 (84 %)** |

Notas:

- La comisión de Wompi pesa **7–9 veces más que la IA** incluso contando la IA
  de quienes no pagan.
- Retenciones en la fuente, ICA y la condición tributaria del propietario
  (persona natural o jurídica, responsable o no de IVA) quedan **pendientes
  de un contador** [?].
- TRM supuesta COP 4.000/USD [?].

### 9.2 Costos fijos [V tarifas]

| Servicio | Plan | Costo | Impacto del Resume Studio |
|---|---|---|---|
| Render | Starter USD 7/mes (tope total USD 10/mes, AGENTS.md) | Ya se paga | Sin subir plan. Sin Chromium. Llamadas IA son I/O, no CPU. |
| Supabase | Pro USD 25/mes (`docs/SUPABASE-ADVISOR-2026-10-25.md:12`: org en Pro) | Ya se paga | Filas JSON pequeñas (~20 KB por CV con versiones). 10.000 CV ≈ 200 MB de 8 GB. |
| Proveedor IA | Pago por uso | Variable | Tope mensual de gasto [P: USD 20 hasta tener datos reales]. |

Si se cargara al Resume Studio el 100 % de Render + Supabase (USD 32 ≈ COP
128.000/mes), el punto de equilibrio sería de **21 ventas al mes a COP 9.900
con IVA**. Como esos costos ya existen por las vacantes, el costo marginal fijo
es cercano a cero.

### 9.3 Recomendación de precio [P]

**COP 9.900, IVA incluido, pago único por CV** que desbloquea PDF (y DOCX si
entra en R4), re-ediciones y re-descargas por 30 días, y hasta 5
adaptaciones a otras vacantes en ese plazo.

- Comparación con la referencia [V grabación]: JobStep cobra COP 18.900 por
  un mes o COP 12.300 al mes en el plan trimestral (≈ COP 36.900 por
  adelantado), con renovación. Nuestro pago único queda por debajo de
  cualquiera de las dos y sin renovación automática.
- Margen bruto 63 % en el peor caso tributario.
- Alternativa: COP 12.900 (margen 66–82 %) si el propietario prefiere
  igualar la referencia mensual de JobStep.
- Por debajo de ~COP 6.000 la comisión fija de Wompi (COP 833 con IVA)
  supera el 14 % y no conviene.

## 10. Riesgos técnicos y comerciales

| Riesgo | Mitigación |
|---|---|
| La IA inventa datos | Validador por código + `new_fact` con pregunta (doc 05 §5); evals adversariales (doc 09) |
| Fuga de CV de otro usuario (IDOR) | Toda consulta con `WHERE user_id = sesión`; pruebas dedicadas (doc 08) |
| Memoria de Render | PDF en el cliente; límite de 2 MB por archivo y 1 parseo concurrente |
| Costo IA desbocado | Presupuesto diario por usuario y global; alias `none` como interruptor |
| Pocas ventas | El valor para AdSense y retención no depende de las ventas; fijo marginal ≈ 0 |
| Vacantes sin descripción | Mensaje honesto; solo revisión general |
| Proveedor cambia términos o depreca modelo | Alias + segundo proveedor; revisión trimestral |
| Quitar marca de agua desde el navegador | Riesgo aceptado (§6) |
| Contrato público de agentes dice «sin CV» | Se mantiene cierto: REST/MCP/A2A siguen sin exponer CV. Actualizar textos solo en la implementación. |

## 11. Reutilizar vs. construir

| Reutilizar | Construir |
|---|---|
| Auth, `verifySession`, tabla `users` | Rutas `/api/resume/*` y tablas `rs_*` |
| Wompi checkout/webhook (con discriminador) | Extracción, gateway IA mínimo, puntuación |
| Design system y `ContentPage` | Editor, vista previa, plantillas |
| Búsqueda y API de vacantes para elegir vacante | Consentimiento y derechos del titular |
| Patrón RLS + REVOKE, migraciones aditivas | Job de borrado/retención |
| Ideas del CV Generator retirado (factualidad, ledger) consultando `git show 053a21a^` | — (no se restaura su código) |
