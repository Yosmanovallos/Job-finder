# 08 — Security & Threat Model

**Fecha:** 2026-11-14 · **Marcas:** [V] verificado · [P] propuesto · [?] pendiente

| Tema | Estado |
|---|---|
| Controles existentes reutilizables | [V] §1 |
| Hallazgos en el código actual | [V] §2 (no se corrigen en esta fase) |
| Amenazas y controles nuevos | [P] §3–§5 |

## 1. Lo que ya hay [V]

- Sesión: Bearer token verificado con `supabaseServer.auth.getUser` (`src/auth/verify-session.ts:30-46`).
- Base de datos: RLS activo sin políticas y `REVOKE ALL` a `anon`/`authenticated`; la app usa `postgres` desde el servidor (`schema.sql:705-748`; `docs/SECURITY-AUDIT-2026-08-02.md:39-45`).
- Supabase: protección contra contraseñas filtradas activada (`docs/SUPABASE-ADVISOR-2026-10-25.md:11`).
- Rate limit en el inicio de checkout (`server.ts:1491-1539`).
- Secretos solo por variables de entorno (`render.yaml`, `sync: false`).

## 2. Hallazgos de esta auditoría [V] (para un cambio aparte)

| # | Hallazgo | Riesgo | Propuesta |
|---|---|---|---|
| H1 | El webhook de Wompi compara el checksum con `===` (`src/payments/webhook.ts:53-63`) | Bajo (ataque de tiempo poco práctico por red) | `crypto.timingSafeEqual` |
| H2 | El webhook no compara el monto aprobado con `amount_in_cents` guardado | Medio si se activan pagos | Rechazar si no coincide |
| H3 | `cv_pii_vault` tuvo RLS apagado y permisos públicos hasta 2026-10-25 (`docs/SUPABASE-ADVISOR-2026-10-25.md:9`), 0 filas | Ya corregido | Auditar las otras tablas viejas antes de decidir su destino (doc 06 §4.3) |
| H4 | `render.yaml:23` dice `plan: free`; AGENTS.md dice Starter | Configuración ambigua | Confirmar en el panel de Render [?] |

## 3. Amenazas (STRIDE resumido) [P]

| Amenaza | Vector | Control |
|---|---|---|
| **Acceso a CV ajeno (IDOR)** | Cambiar `resumeId` en la URL/API | Toda consulta filtra por `user_id` de la sesión; ids UUID v4; pruebas que intentan leer/editar/descargar con otra cuenta |
| Sesión anónima secuestrada | Robo del id de sesión anónima | Id aleatorio de 128 bits en cookie `HttpOnly; Secure; SameSite=Lax`; datos anónimos solo en el navegador salvo la constancia de autorización |
| **Inyección de prompts** desde el CV o la vacante | Texto «ignora las instrucciones y…» en un CV o en una vacante scrapeada | Delimitadores + instrucción de tratar como dato; el modelo **no tiene herramientas**; salida validada contra esquema JSON; validador de factualidad por código; el modelo nunca decide permisos, precios ni desbloqueos |
| Exfiltración por salida del modelo | El modelo devuelve URLs/HTML | Salida solo texto plano; se escapa al pintar; enlaces no permitidos en el CV salvo los que escriba el usuario |
| **Archivo malicioso** | PDF con JS, DOCX con macros, ZIP bomb, XXE | Firma de bytes; 2 MB cortando el stream; 4 páginas; rechazo de macros/objetos/relaciones externas; parser sin resolver entidades XML; límite de descompresión (p. ej. 20 MB) y de entradas del ZIP; 5 s de tiempo; no se guarda el archivo |
| Escaneo antivirus | Malware en el archivo | Como el archivo no se guarda ni se sirve a terceros, se mitiga con el rechazo estructural de arriba. Antivirus externo [?] solo si algún día se almacenan originales |
| Datos en logs | CV o tokens en logs/GA4 | Logger con redacción; eventos de analítica solo con ids y contadores; sin texto del CV en errores; Sentry/equivalente con *scrubbing* [?] |
| Abuso de costo de IA | Bots que usan el chat gratis | Autorización + límite por sesión (p. ej. 40 llamadas/día) y por IP; presupuesto global diario; Turnstile/CAPTCHA **no** se usa en el MVP [?] |
| Fraude de pago | Desbloquear sin pagar; reutilizar referencia | Desbloqueo solo por webhook verificado + H2; referencia única ligada a `resumeId` y `userId` |
| Fuga de secretos | Llave del proveedor en el cliente | Llave solo en el servidor; rotación documentada |
| Repudio | «Nunca autoricé» | `rs_consents` solo-inserción con versión y hash |
| Denegación de servicio | Muchos parseos | Un parseo concurrente por instancia y cola corta; 429 con `Retry-After` |

## 4. Cifrado y secretos [P]

- Tránsito: HTTPS (Cloudflare + Render) [V hoy].
- Reposo: cifrado de disco de Supabase [V por plataforma, ?: confirmar en su
  documentación]. Además, `facts_json` cifrado a nivel de aplicación con
  AES-256-GCM y llave en variable de entorno con versión (patrón que ya usaba
  `user_ai_credentials`, `schema.sql:416`) [P].
- Llaves: `RESUME_DATA_KEY_V1`, `RESUME_AI_API_KEY`; nunca en el repo ni en
  `.env` versionado.

## 5. Mínimo privilegio [P]

- El navegador nunca accede a tablas `rs_*` (REVOKE + RLS sin políticas).
- El proveedor de IA recibe solo hechos sin contacto (marcadores).
- Los agentes de código no leen `.env`, `private/`, `secrets/` (ya en
  `.claude/settings.json` [V]).
- Superficies públicas de agentes (REST/MCP/A2A/WebMCP) **no** exponen nada
  del Resume Studio (contrato de `docs/AGENT-READINESS-RUNBOOK.md`).

## 6. Incidentes [P]

1. Detectar (alertas de errores 5xx, gasto IA anómalo, accesos cruzados en logs).
2. Contener (`RESUME_STUDIO_ENABLED=false`, rotar llaves).
3. Evaluar alcance (qué titulares, qué datos).
4. Notificar a la SIC y a los titulares según la Ley 1581 [?: plazo y forma con abogado].
5. Post-mortem en `docs/`.

## 7. Trazabilidad [P]

Bitácora de eventos sin contenido: consentimiento otorgado/revocado, CV
creado/borrado, análisis ejecutado, pago aprobado, descarga, exportación,
solicitud de derechos. Retención de la bitácora: 2 años [?].

## 8. Pruebas de seguridad automatizadas

Detalladas en el doc 09 §5 (IDOR, archivos, inyección, logs, pago).
