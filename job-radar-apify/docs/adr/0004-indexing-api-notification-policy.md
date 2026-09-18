# ADR 0004 — Política de notificaciones a la Google Indexing API

**Fecha:** 2026-09-18
**Estado:** aceptado localmente en `feat/job-seo-v2` · no desplegado · cambia
`docs/JOBPOSTING-GOOGLE-CONTRACT.md` §2 (`validThrough`) y §6
**Contexto:** análisis de inflow de la cola (2026-09-18, solo lectura en
producción), `docs/JOB-SEO-ARCHITECTURE-V2.md` F7,
`scripts/simulate-indexing-queue.ts`

## Problema

La Indexing API tiene una cuota de publicación de **200/día por proyecto**
(cuota inicial de Google; `URL_UPDATED` y `URL_DELETED` gastan la misma
cuota). Producción creó **23,494 filas en 7 días (~3,356/día)**, sin
duplicados (factor 1.00: cada fila es un job o una URL distinta):

| Productor (código de `origin/main`) | /día | Qué es |
|---|---|---|
| `saveJobs` en cada INSERT | ~1,432 URL_UPDATED | 77.5% eran jobs no aptos para Google |
| `purgeOldJobs` | ~1,919 URL_DELETED | 96% de URLs que Google nunca recibió por la API |
| reconcile horario | ~4 | inactivo |

La rama ya limita `URL_UPDATED` a la transición real a apto (≈389/día con la
mezcla de los últimos 14 días), pero con la política de borrado actual el
total sigue en ~2,250/día contra 200. Además, los carriles estrictos de la
rama (borrado = 1 antes de recién-apto = 2) dejarían a los jobs nuevos detrás
de 7,690 borrados: **≥38 días**, y sin límite mientras la llegada de borrados
supere 200/día.

## Principio: fuente de verdad ≠ aceleración

El ciclo de vida real de una vacante **no** depende de la Indexing API:

| Estado | Lo que ve Google sin la API |
|---|---|
| Apta | HTTP 200, indexable, un `JobPosting`, en `sitemap-jobs.xml` con `lastmod` real |
| Visible pero no apta | HTTP 200, `noindex,follow`, sin `JobPosting`, fuera del sitemap |
| Vencida (purgada) | **HTTP 410** (`wasJobPurged()`), sin `JobPosting`, fuera del sitemap |

Eso es la **fuente de verdad**, y es correcto en cada rastreo. `URL_UPDATED`
y `URL_DELETED` solo le piden a Google que rastree antes: son un mecanismo de
**aceleración** con cuota escasa, no un requisito de corrección. El contrato
de `JobPosting` sigue igual: sin `validThrough` inventado, la expiración se
expresa con 410 más la salida del sitemap. `URL_DELETED` la adelanta cuando
tiene sentido.

Verificado en el código: `checkIndexingTarget` no envía nada que no sea apto
y canónico; el sitemap y `JobPosting` leen el mismo predicado
(`seoReadySql`/`isGoogleReadyNow`); el 410 sale de cualquier fila
`URL_DELETED` de la cola **en cualquier estado**. Por eso una lápida que no se
envía conserva el 410.

## Método

`scripts/simulate-indexing-queue.ts` reproduce las llegadas **reales**,
exportadas en solo lectura (horas epoch y banderas, sin ids ni texto):
65,956 jobs activos, 11,982 vidas de jobs purgados, 42,976 borrados
pendientes. Horizonte de 90 días, envío diario con presupuesto rodante de 24
h (como `getIndexingBudgetRemaining`), semilla fija. La mezcla base repite
los últimos 14 días completos (389 nuevos aptos/día). La mezcla pico repite
30 días e incluye la semana de ~1,000 aptos/día (500/día de media). El
planificador que simula es **el mismo módulo** que se despliega
(`src/lib/indexing-scheduler.ts`).

Vida de una vacante en la fuente (último avistamiento − descubrimiento,
cohorte de hace 31-45 días, 18,355 jobs): p50 1.96 d, p75 15.8 d. Probabilidad
de seguir viva en la fuente: 64% a 1 d, 46% a 2 d, 41.5% a 3 d, 39% a 7 d, 32%
a 10 d, 27% a 14 d. La mitad desaparece en 2 días; lo que sobrevive se
estabiliza hasta el día 7 y luego vuelve a caer.

## Decisión 1 — Qué borrados usan la API: D2

| Política | Borrados/día (ola d0-30 → estable d30-90) | Total con nuevos (base) | Reducción vs 3,356 | Solo 410+sitemap | Cuota mínima estable* |
|---|---|---|---|---|---|
| D0 actual: todo job purgado | 2,013 → 1,461 | ~1,850 | 45% | 0 | no existe ≤3,000 |
| D1 alguna vez apto | 480 → 349 | ~740-870 | 74-78% | ~1,450/día nunca aptos | 1,350 (pico 1,625) |
| **D2 con URL_UPDATED enviado (misma URL o mismo job)** | ≈ envíos de URL_UPDATED (≤ nuevos) → ~349 | **~2× nuevos ≈ 780** | **~77%** | los nunca notificados, incl. 35,286 pendientes | **875 (pico 1,325)** |
| D3 D2 + señal fuerte | = D1 | = D1 | = D1 | = D1 | = D1 |

\* Sin ventana, planificador S2, con cola que no crece, p95 de nuevos ≤48 h
y p95 de borrados ≤7 d.

- **D3 no aporta una señal nueva.** El repo no guarda ninguna prueba de
  indexación por URL (`check-search-console.ts --inspect` es una muestra
  manual que no persiste). La única señal duradera es `seo_ready_at`, y hoy
  la estampó el clasificador sobre 15,580 filas antes de que la v2 exponga
  nada: no prueba exposición. Tras el despliegue, D3 es igual a D1.
- **Qué cuenta como "notificada".** Una fila `URL_UPDATED` `sent` para la
  misma URL, o para el mismo `job_id` aunque el slug haya cambiado después: si
  Google recibió el job, su retiro merece aceleración.
- **D2 se autolimita.** Solo genera borrados de URLs que la API notificó. Con
  cuota suficiente, cada notificación enviada termina en un borrado, así que
  la demanda estable es ≈2× los nuevos aptos. Con cuota escasa baja sola: un
  `URL_UPDATED` que no se envió no produce `URL_DELETED`. Por eso su "demanda"
  depende de la cuota y no es un número fijo.
- **Ninguno de los 15,580 aptos actuales recibió nunca `URL_UPDATED`.** Los
  1,723 envíos históricos aún activos son todos de jobs hoy no aptos. Con D1
  habría una ola de ~480 borrados/día durante 30 días; con D2 no la hay.
- Lo que D2 deja sin `URL_DELETED` sigue con 410 más la salida del sitemap.
  Google lo retirará en su próximo rastreo en vez de en horas. Es un riesgo
  aceptado (ver Riesgos).

**Telemetría:** la purga siempre registra la fila `URL_DELETED` (es la lápida
del 410). Si la URL no fue notificada por la API, la fila nace en
`status='superseded'` con `superseded_reason='delete_not_api_notified'`: es
terminal, no se envía y no consume cuota. Los 35,286 pendientes heredados
reciben ese mismo estado en el reconcile, acotado por corrida.

## Decisión 2 — Planificador: S2, reparto ponderado con desborde

Resultados D2, ventana de 7 días, mezcla base (pico entre corchetes).
Columnas: cola a 7/30/60/90 días · nuevos p50/p95 · % de nuevos enviados ·
borrados p50/p95.

| Cuota | SF FIFO global (desplegado) | S0 carriles estrictos (rama) | **S2 50/50 + desborde** | S4 más nuevos primero |
|---|---|---|---|---|
| 200 | 9,641/5,792/2,521/3,748 · nunca · 23% · 22.8d/37.4d | · nunca · 20% | 9,641/8,692/8,589/8,665 · nunca · 28% · nunca | nunca · 26% |
| 400 | nuevos 6.9d/nunca 54% | nunca/nunca 49% | 6.9d/nunca 55% · del 13.8d/33.3d | 20h/nunca 51% |
| 600 | 2.7d/nunca 90% | 3.2d/nunca 82% | 6.5d/nunca 87% · del 25h/15.4d | 16h/nunca 85% |
| 800 | 18h/6.6d 97% [41h/nunca 92%] | 18h/6.8d 96% [2.2d/nunca 86%] | **17h/33h 100%** · del 14h/6.8d [4.4d/nunca 95%] | 16h/23h 100% [16h/nunca 85%] |
| 1000 | 17h/4.9d 99% [25h/6.8d 97%] | 17h/4.9d 98% [27h/6.9d 96%] | **16h/22h 100%** · del 14h/23h [46h/4.9d 100%] | 16h/22h 100% [16h/nunca 93%] |
| 1500 | 17h/2.4d 100% | 17h/2.1d 100% | **16h/22h 100%** [17h/33h 100%] | 16h/22h [16h/45h] |

- **S0 (carriles estrictos) queda descartado.** Con borrados primero, los
  nuevos esperan detrás de todo el backlog de borrados. Necesita 1,550/día
  (pico 2,325) para lo que S2 logra con 875 (pico 1,325).
- **S1 (cuotas fijas sin desborde) desperdicia cuota.** A 1,000/día y 70/30
  todavía crece +77/día, y los carriles vacíos pierden su parte.
- **S3 (plazo más cercano primero) colapsa con sobrecarga.** A 600/día la
  cola crece +163/día (ventana de 7 días); sin ventana, el p95 de los
  borrados sale "nunca".
- **S4 empata con S2 en la mezcla base pero pierde en la pico.** A 1,000/día
  envía 93% de los nuevos frente a 100%. Además es LIFO, lo que contradice lo
  medido el 2026-08-10: el orden más-nuevo-primero dejó filas sin enviar
  durante semanas. Se descarta por ambos motivos.
- **Reparto:** con D2 la demanda estable de nuevos ≈ la de borrados, así que
  S2 usa 50/50. La barrida 0.4-0.8 lo confirma: 0.6-0.8 solo funciona si
  sobra cuota, y 0.4 hace que los nuevos se venzan. El orden de desborde es
  nuevo → borrado → cambio de contenido → reconcile. Ningún carril puede
  dejar sin servicio al otro mientras ambos tengan trabajo: cada uno tiene
  garantizado el 50% del presupuesto del día.
- Los cambios de contenido (medido ~0/día) y el reconcile solo reciben
  desborde. La capacidad se conserva, detrás de los jobs nuevos.

## Decisión 3 — Backlog acotado: ventana de aceleración de 7 días

Un `URL_UPDATED` solo es enviable mientras la versión esté dentro de la
**ventana de la API: 7 días** desde `COALESCE(content_updated_at, created_at)`.
Es decir, desde el descubrimiento o desde el último cambio real de contenido.

- **Por qué 7.** Con la mezcla pico a 1,000/día, una ventana de 3 días deja
  vencer el 7% de los nuevos (93% enviados) y una de 7 días el 0% (100%, p95
  4.9 d). Con la mezcla base, de 2 a 21 días dan resultados idénticos desde
  800/día. La supervivencia en la fuente casi no cambia entre el día 3 y el
  7 (41.5% → 39%) y cae después (32% a 10 d, 27% a 14 d). Pasados 7 días, la
  notificación ya no adelanta una vacante que siga viva.
- **Al vencer,** la fila pasa a `superseded` con
  `superseded_reason='api_window_expired'`, conservando `job_id` y
  `content_hash`. Es telemetría: **no** cambia `seo_ready`, el robots, el
  `JobPosting` ni el sitemap. La página sigue indexable y el sitemap es el
  respaldo.
- **Efecto medido:** con la ventana, la cola queda acotada con cualquier
  cuota. A 200/día, D2+S2 se estabiliza en ~8,700 filas (+3/día) en vez de
  crecer. Sin ventana también crece poco (+39/día), pero manda notificaciones
  de hace semanas.
- **Decisión explícita sobre el backlog heredado:** los 15,580 `URL_UPDATED`
  pendientes de jobs aptos tienen una mediana de 21 días desde su
  descubrimiento. Casi todos están fuera de la ventana y quedan en
  `api_window_expired` al primer reconcile. El sitemap los cubre. Es una
  decisión, no un accidente de la simulación.

## Decisión 4 — El reconcile no resucita lo vencido

El reconcile horario es una red de seguridad. Un `(job_id, content_hash)` con
una fila `sent` **o** `api_window_expired` ya está resuelto:

- `enqueueIndexingNotificationsWith` ignora esa versión (defensa central,
  vale para todo productor).
- El paso 2 del reconcile solo mira jobs aptos **dentro de la ventana** y
  excluye esos estados.
- Solo un cambio real de contenido (hash nuevo y `content_updated_at` nuevo)
  abre una ventana nueva.

## Decisión 5 — Cuota a solicitar

| Concepto | /día | Origen |
|---|---|---|
| Nuevos aptos, mezcla base (14 d) | 389 | llegadas reales |
| Nuevos aptos, mezcla pico (30 d) | 500 | llegadas reales |
| Semana pico observada | ~1,000 nuevos aptos | 2026-08-19…26 |
| Demanda estable D2 (≈2× nuevos) | ~780 | simulación: 758 enviados/día a 1,000 |
| Demanda estable D2 en semanas pico | ~1,000 | simulación con replay de 30 d |
| Ola de transición con D2 | ninguna; 7,690 borrados heredados se vacían en 11-17 días con ≥1,000/día | simulación |
| Mínima estable, p95 nuevos ≤48 h (base / pico) | 875 / 1,325 | búsqueda `--grid=minquota` |

- **Solicitar 1,500/día.** Es el mínimo de la mezcla pico (1,325) más ~13%
  de margen para crecer y absorber el día de envío que GitHub Actions
  retrasa.
- **Mínimo aceptable: 800/día.** Con la mezcla base: nuevos p95 33 h, 100%
  enviados, cola ≤122. En semanas pico se degrada sin crecer sin límite: 95%
  enviados y el resto vence por ventana.
- **Nunca** repartir el tráfico entre varios proyectos o cuentas para
  esquivar la cuota.

## Consecuencias

- `purgeOldJobs` registra la lápida siempre, pero solo encola como enviable
  lo que la API notificó.
- `run-indexing-tick.ts` planifica con `planIndexingSends` (S2) sobre
  candidatos por carril en vez de `ORDER BY priority`.
- `backfill-indexing-queue.ts` (reconcile) añade: vencer por ventana,
  degradar los borrados no notificados y excluir lo vencido.
- `superseded_reason` gana dos valores: `api_window_expired` y
  `delete_not_api_notified`. No hay cambio de esquema: la columna es
  `VARCHAR(40)`.
- `docs/JOBPOSTING-GOOGLE-CONTRACT.md` §2/§6: "Expiry is signaled by 410 +
  sitemap removal; URL_DELETED accelerates it for API-notified URLs."

## Riesgos

1. **Vacantes vencidas visibles en Google más tiempo.** Aplica a las URLs
   nunca notificadas por la API: hasta el próximo rastreo, no horas. En
   `origin/main` todas las páginas descriptibles tuvieron `JobPosting` y
   sitemap, así que Google pudo indexar muchas por rastreo. Mitigación: 410,
   salida del sitemap y muestreo periódico con
   `check-search-console.ts --inspect` para medir la tasa real de vencidas
   aún indexadas.
2. **A 200/día nada es bueno:** solo ~28% de los nuevos se notifica. La
   ventana evita que la cola crezca sin límite, pero la solicitud de cuota es
   necesaria.
3. **El modelo usa la vida observada** (`last_seen_at`), que depende de la
   cadencia del scraper (ADR 0003). Una cadencia más fiable alarga los spans:
   hay que volver a simular antes de cambiar la ventana.
4. **La mezcla pico podría repetirse** (fuente nueva, reclasificación).
   Mitigación: la ventana acota la cola con cualquier cuota.

## Reproducir

```bash
# export de solo lectura (ver cabecera del script) → simdata.json
npx tsx scripts/simulate-indexing-queue.ts simdata.json --grid=main  --replay=14
npx tsx scripts/simulate-indexing-queue.ts simdata.json --grid=final --replay=30
npx tsx scripts/simulate-indexing-queue.ts simdata.json --grid=minquota
npx tsx scripts/simulate-indexing-queue.ts simdata.json --grid=window
npx tsx scripts/simulate-indexing-queue.ts simdata.json --grid=shares
```
