# Plan Google Empleos: que cada vacante nueva llegue a Google

Fecha: 2026-11-01. Base: `origin/main` en `8e8f95f`. Estado: **plan, sin
código**. Cada fase se ejecuta en su propia sesión, con worktree `codex/`
creada desde `origin/main`, y se registra aquí al cerrarla.

Documentos que este plan **no reemplaza** y que cada sesión debe leer:
`JOBPOSTING-GOOGLE-CONTRACT.md` (contrato propiedad por propiedad),
`JOB-SEO-ARCHITECTURE-V2.md` (puerta de aptitud y máquina de detalle),
`adr/0004-indexing-api-notification-policy.md` (cola de la Indexing API),
`adr/0008-private-job-archive.md` (máximo público de 30 días),
`INDEXING-API-QUOTA-REQUEST.md`, `SEO-CRAWLED-AUDIT-2026-10-29.md`,
`DASHBOARD-PERFORMANCE-RUNBOOK.md` y el plan maestro `SEO-IMPROVEMENT-PLAN.md`.

## 1. Qué exige Google (releído el 2026-11-01)

Fuente: Google Search Central, «Job posting (JobPosting) structured data» y
«Indexing API quickstart».

| Requisito de Google | Estado en BuscoTrabajo |
|---|---|
| `title`, `description` completa en HTML, `datePosted`, `hiringOrganization`, `jobLocation` (o `applicantLocationRequirements` + `TELECOMMUTE` en 100 % remoto) | Cumple. Solo se emite si el evaluador único `evaluateGoogleJobReadiness()` (`src/lib/google-job-readiness.ts`) da apta; si falta algo, no hay JobPosting parcial |
| `validThrough` cuando la oferta vence | Cumple. Solo se emite si la fuente publica una fecha de vencimiento (contrato §2, `buildJobPosting`); hoy ningún parser la lee. El fin se expresa con 410 + salida del sitemap. *Corregido en F2: antes decía `datePosted + 30 d`, que es lo que el contrato retiró.* |
| Marcado solo en la página de detalle; una oferta por página | Cumple. Solo `/empleos/:id/:slug`; hubs con ItemList, nunca JobPosting |
| El marcado coincide con lo visible | Cumple. Mismo renderizador para cuerpo y JSON-LD (contrato §3) |
| Una vía para postular sin login | Cumple. Enlace a la fuente en el HTML del servidor; captura de leads opcional |
| `baseSalary` solo del empleador | Cumple: no se emite (somos terceros); el salario de la fuente solo se muestra |
| Vencidas: 404/410 o sin marcado, y avisar | Cumple. 410 + fuera del sitemap; `URL_DELETED` solo para URLs notificadas (ADR 0004) |
| Sitemap con URLs canónicas y `lastmod` real | Cumple. `sitemap-jobs.xml` filtrado por la misma puerta; muestra de 30 URLs = 30 × 200 |
| Indexing API solo para páginas con JobPosting | Cumple. `checkIndexingTarget` no envía nada no apto |

Conclusión: **la página de una vacante apta ya cumple todo lo que Google
pide.** No hay un requisito técnico pendiente que explique la falta de
indexación.

## 2. Cómo viaja hoy una vacante nueva (todo fuera de la ruta web)

```
GitHub Actions scrape-jobs(-ve).yml
  listado → validación → dedupe → INSERT con detail_status
  detalle en el tick + paso run-detail-drain (presupuesto 420 s, cupos por fuente)
  evaluateGoogleJobReadiness() → seo_ready + seo_ready_at
     apta  → 200 indexable + JobPosting + sitemap + URL_UPDATED (misma transacción)
     no    → 200 visible, noindex,follow, sin JobPosting, fuera del sitemap
GitHub Actions indexing-tick.yml (cron horario, corre ~5 veces/día)
  reconcile → planIndexingSends() 50 % nuevas / 50 % borrados, FIFO
  envía con la cuenta de servicio GOOGLE_INDEXING_CLIENT_EMAIL,
  Propietaria de la propiedad en Search Console
Día 30 (ADR 0008): archivo privado + 410 + fuera del sitemap
```

El «usuario administrador que indexa» es esa cuenta de servicio (confirmado
por el usuario el 2026-11-01). La web (Render) solo lee el
veredicto guardado. Por eso las fases 0 a 3 no afectan el rendimiento del
sitio.

## 3. Lo que funciona y no se toca

- La puerta de aptitud y el contrato JobPosting (un solo evaluador para robots,
  JSON-LD, sitemap y cola).
- La regla de 30 días y el 410 (ADR 0008).
- Hubs de ciudad/cargo, enlazado vacante → hub, portada con hubs.
- Caché del dashboard, warmup CO/VE y presupuesto de Render.
- Clics orgánicos: de ~1/día a 9–24/día desde el 26-Oct.

## 4. Cuellos de botella medidos (2026-11-01)

**C1. Cuota de la Indexing API.** Los 30 últimos `indexing-tick` (26-Oct a
02-Nov) envían exactamente 200 al día, sin fallos. Las `URL_UPDATED` que
caducan sin enviarse (`api_window_expired`) suman 125–245 por día, con mediana
~190. La demanda es de ~330–450 notificaciones por día frente a 200, así que
**cerca de la mitad de las vacantes nuevas aptas nunca se notifica** y
depende solo del sitemap. La solicitud de 1.500/día está preparada, pero
`INDEXING-API-QUOTA-REQUEST.md` dice «NO enviado».

**C2. Orden de envío.** El carril de nuevas es FIFO (más antigua primero). La
vida mediana de una vacante en la fuente es de ~2 días (ADR 0004). Con la cola
saturada, la cuota se gasta en vacantes de días atrás mientras las recién
aptas esperan. La simulación del ADR 0004 vio poca diferencia con 200/día;
hay que volver a medirlo con datos de noviembre antes de cambiarlo.

**C3. Detalle de las vacantes nuevas.** Sin descripción completa una vacante
nunca es apta. Último tick CO: Magneto 28/30 completas; LinkedIn 0–2 de 8
reclamadas (429); Computrabajo 3–4 de 8 (429). Límites que no se cruzan:
robots de LinkedIn, ruta translate.goog y cualquier evasión anti-bot.

**C4. Medición engañosa.** El informe de páginas de GSC está atrasado
(actualizado el 22-Oct). La auditoría del 29-Oct inspeccionó una por una
ejemplos de «rastreada, sin indexar» y Google ya los tenía indexados. Sus
totales no sirven como censo actual.

**C5. Diferenciación de la página.** La página repite casi textual la oferta
original. PR #90 diseña bloques con datos reales (otras vacantes de la
empresa, reputación, marca oficial). Mejora unicidad y enlazado; **no está
probado que cambie la indexación**.

**C6. Meta description de plantilla.** `buildJobMeta()` emite «Vacante
agregada de {fuente}…» en todas las vacantes que no vienen del portal oficial
(contrato §5, fase I sin terminar).

## 5. Fases (una por sesión, en este orden)

Cada fase entrega: objetivo, evidencia, archivos, pruebas, criterio de
salida y registro en este documento. Ninguna hace merge, despliegue,
migración ni escritura en producción sin aprobación explícita del usuario.

### F0. Línea base del embudo (sesión, solo lectura)

- Medir por día y por fuente: nuevas → aptas → notificadas → caducadas sin
  enviar, y cuánto tarda cada paso. Fuentes: logs de Actions y una consulta
  agregada de solo lectura a producción (**pide aprobación**).
- Inspección individual en GSC de 20 aptas recientes: 10 notificadas por la
  API y 10 solo por sitemap. Registrar URL, fecha, indexada sí/no y canonical.
- Salida: `docs/seo-baseline/2026-11-google-jobs-funnel.md` con los números
  que necesitan F1 y F2. Sin cambios de código.
- **Registro (2026-11-01, hecho).** Rama `codex/google-jobs-f0-baseline`.
  Consulta de solo lectura aprobada por el usuario, logs de 18-oct a 1-nov e
  inspección en GSC de 20 URLs.
  - Embudo: 286 aptas no oficiales/día y 308 `URL_UPDATED`/día. Se envían
    100 al día; caducan 172 al día.
  - En la cohorte cerrada, solo el **30 %** de las aptas se notificó por la
    API.
  - Cada envío sale **158–167 h** después de que la vacante pasa a apta,
    justo antes de caducar.
  - Muestra de GSC: 19/20 indexadas (API 10/10, solo sitemap 9/10). En al menos
    8 de las 10 notificadas, Google ya había rastreado la página antes del
    envío.
  - Hay 8,850 `URL_DELETED` pendientes, con una mediana de 44 días.
  - **F2 está justificada.** Las fuentes que limitan F3 son Computrabajo CO
    (2 % aptas, 429), LinkedIn CO (21 %, 429) y el atraso del drain de
    Magneto (107–113 h hasta apta, sin 429).
  - `INDEXING-API-QUOTA-REQUEST.md` está actualizado para F1.

### F1. Cuota de la Indexing API (acción del usuario)

- La sesión de F0 actualiza `INDEXING-API-QUOTA-REQUEST.md` con las cifras
  reales.
- El usuario, como dueño del proyecto de Google Cloud, envía el formulario.
  Nunca se pega la clave privada; nunca se reparte entre proyectos.
- Salida: cuota vigente registrada. No requiere código: el tick lee el
  presupuesto restante.
- **Estado (2026-11-01): EN PAUSA.**
  - En la consola del proyecto, la cuota «Publish requests per day» aparece
    como ajustable, pero el panel solo admite valores entre 0 y 200.
  - Probablemente exige una cuenta de facturación, y el usuario no puede
    asumir costos.
  - Las palancas principales pasan a ser F2 y F3, con 200/día.

### F2. Orden de envío (sesión, solo si F0 lo justifica)

- Reproducir `scripts/simulate-indexing-queue.ts` con las llegadas de
  noviembre y comparar FIFO con `newest`/`age` (ya existen en
  `src/lib/indexing-scheduler.ts`).
- Si mejora la proporción de nuevas notificadas a tiempo: enmienda del ADR
  0004 + cambio de `DEFAULT_SCHEDULER` + pruebas del planificador.
- Solo toca el tick de Actions, nunca la web.
- **Registro (2026-11-02, hecho en rama; sin push ni despliegue).**
  - Rama `codex/google-jobs-f2-scheduling`.
  - Simulación: `docs/seo-baseline/2026-11-02-indexing-f2-simulation.md`.
    Reconstruye las llegadas desde los agregados de F0 sin consultar
    producción y reproduce las 300 ejecuciones reales del tick. Calibrada:
    FIFO reproduce los 158–167 h de F0.
  - Enmienda: ADR 0004, «Enmienda F2».
  - Resultado con 200/día:

    | Indicador | Antes | Después |
    |---|---|---|
    | Nuevas aptas notificadas en ≤24 h | 0.4 % | ~33 % |
    | p50 apta → envío | 6.8 d | <1 h |
    | Retiros enviados en ≤7 d | ~0 % | ~85 % |
    | p50 purga → retiro | ~44 d (atasco FIFO) | 2 h |
    | `URL_DELETED` pendientes | ~8,800 | <100 |
    | Envíos/día | 184 | 180 |

    El total notificado no sube (misma cuota). Cambia el momento: la cuota
    deja de gastarse en vacantes de una semana que Google ya había rastreado.
    El efecto en la indexación se mide en F6.

  - Tres cambios, cada uno con su commit y sus pruebas:
    1. **Orden.** Nuevas newest-first. `age` no ayuda.
       `getPendingIndexingLanes` trae las filas más nuevas de ese carril.
    2. **Retiros.** Newest-first y ventana de 7 días
       (`delete_window_expired`, sin borrar filas, el 410 intacto). El reparto
       se queda en 50/50: no está medido que un carril tenga mejor respaldo, y
       `validThrough` no se emite. La curva para moverlo está en la
       simulación (75/25 → 46 % / 36 %).
    3. **Reparto en el día.** `pacedSendAllowance` limita cada ejecución a 74
       envíos como máximo, frente a 200, con el mismo presupuesto rodante.
  - Validación:
    - `npx tsc --noEmit` y `npm run test:unit` en verde.
    - El SQL nuevo se probó en un Postgres embebido (PGlite), fuera del repo.
    - `test:job-seo`/`test:integration` no se corrieron: no hay Docker en el
      equipo.
  - **Pendiente de aprobación del usuario:** push, merge y despliegue.
    - El primer reconcile tras el despliegue cierra los `URL_DELETED` con más
      de 7 días, solo con cambio de estado. Estimación con F0: unas 7,700
      filas.
    - Antes de desplegar, ver el conteo con
      `npx tsx scripts/backfill-indexing-queue.ts --dry-run`.

### F3. Más vacantes nuevas aptas (sesión)

- Medir en F0 la proporción de aptas por fuente y el atasco del drain.
- Dar prioridad a las vacantes más recientes en el drain y reasignar el
  presupuesto a las fuentes que sí completan, sin subir la presión sobre las
  que dan 429.
- Ampliar empleadores directos (ATS oficiales, iniciativa D1–D5): traen la
  descripción completa y son aptos al insertarse.
- Criterio: más aptas nuevas por día sin más 429 ni más tiempo de tick.

### F4. Diferenciación de la página (PR #90)

- Implementar B1–B3 de `openspec/changes/job-page-differentiation/`.
- Descripción y JSON-LD idénticos byte a byte; nada inventado; sin consultas
  nuevas en caliente; TTFB en frío con edge MISS dentro de +10 %.

### F5. Meta description y título (contrato §5)

- Reemplazar la plantilla «Vacante agregada de…» por datos reales de la
  vacante. Cambia el `<head>`: `/seo drift compare` antes y después.

### F6. Seguimiento (cada checkpoint)

- 7, 12 y 26 de noviembre: Search Analytics de páginas `/empleos/<uuid>` con
  impresiones, apariciones «Ofertas de empleo», clics por hub, y la misma
  muestra de inspección de F0. No atribuir efectos a una fase sola cuando
  varias coinciden en fechas.

## 6. Indicadores

| Indicador | Hoy | Fuente |
|---|---|---|
| Notificaciones nuevas caducadas sin enviar/día | 172 (media), 196 (mediana), 19–31 oct | consulta de solo lectura + logs `indexing-tick` |
| Aptas nuevas/día y % por fuente | 286/día no oficiales (+72 oficiales). LinkedIn 159, Magneto 56, Elempleo 36, Computrabajo 30. Notificadas por la API: 30 % | consulta de solo lectura |
| % de aptas recientes indexadas (muestra de 20) | 95 % (API 10/10, solo sitemap 9/10) | inspección de URL, 2026-11-01 |
| Páginas de vacante con impresiones (28 d) | por medir | Search Analytics |
| Clics de «Ofertas de empleo» (3 meses) | 65 | GSC aparición en búsquedas |
| Clics orgánicos/día | 9–24 (26–30 oct) | GSC |

## 7. Rendimiento: invariantes

- F0–F3 corren en GitHub Actions o en scripts; la web no cambia.
- F4–F5 tocan el SSR de `/empleos/:id`: línea base y medición de TTFB en frío
  con edge MISS según el runbook, sin consultas nuevas en caliente y sin
  warmups nuevos.
- Render se queda en Starter. No se añaden servicios de pago.

## 8. Decisiones del usuario pendientes

1. ~~¿Se envió alguna vez la solicitud de cuota de 1.500/día?~~ No, nunca
   (respuesta del usuario, 2026-11-01). Se envía en F1.
2. ~~¿El «usuario administrador que indexa» es la cuenta de servicio?~~ Sí
   (respuesta del usuario, 2026-11-01).
