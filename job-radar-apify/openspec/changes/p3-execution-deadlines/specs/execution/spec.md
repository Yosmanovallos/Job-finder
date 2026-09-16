# Spec delta — ejecución: plazos, cancelación y cadencia (P3)

Requisitos observables. Cada ID se traza a escenarios, pruebas
(`tests/validate-fetch-context.test.ts` = unitaria,
`tests/validate-execution-deadlines.ts` = integración) y resultado.

Gates ejecutados (PostgreSQL 16 desechable, runner aislado, sin tocar
producción): unitarias 12/12 y 11/11 (P2 intacto) · integración completa
(OBS-001…012 + EXE-003/005/006/007/008/009) · baseline 9 rutas · build ✅ ·
`tsc` **29** y `eslint` **295** — idénticos a la línea base heredada, **0
errores nuevos**.

**Extensión del contrato de P2:** P3 añade la señal `deadline_exceeded` a
`SignalTally`, de modo que la tabla señal→estado de **OBS-003** (capacidad
archivada `p2-run-observability`) gana una fila:
`deadline_exceeded → timeout / deadline_exceeded`. Se ordena por debajo de
los fallos reales (una fuente bloqueada estaba bloqueada; el plazo no es el
dato interesante) y por encima de `circuit_open` (quedarse sin presupuesto
es un desenlace vivo; un circuito abierto es una omisión). Las pruebas de
P2 siguen pasando sin cambios.

Delta: solo comportamiento que cambia respecto de la base. La
clasificación de intentos de P2 (OBS-001…012) se mantiene intacta y sirve
de instrumento de medida.

## EXE-001 — Runtime alineado e instalación reproducible

Los workflows de scraping deben ejecutar la versión de Node que el paquete
declara (`engines.node`), y la instalación debe fallar de forma visible si
el lockfile no es utilizable.

- Escenario: instalación en Actions → cero avisos `EBADENGINE`.
- Escenario: lockfile desincronizado → el paso falla con el error de
  `npm ci`, en vez de instalar en silencio un árbol distinto.

**Base medida:** `required: { node: '24.18.0' } current: { node: 'v20.20.2' }`
más 6 paquetes `@supabase/*` que exigen `>=22.0.0`, en cada ejecución.
`npm ci` ya funcionaba (`added 349 packages … in 10s`): el fallback era
riesgo latente, no daño activo.

**Resultado:** ✅ Los 3 workflows de scraping pasan a Node 24 (alineado con `engines.node = 24.18.0`) y a `npm ci` sin fallback. Pendiente de confirmar en Actions tras el despliegue: el EBADENGINE solo desaparece cuando el runner ejecuta el workflow nuevo.

## EXE-002 — El presupuesto de trabajo cabe dentro del plazo

La suma de los sub-plazos que el tick puede conceder nunca puede exceder
el plazo global menos la reserva de cierre. Los sub-plazos se derivan del
plazo global, nunca al revés.

- Escenario: lote rápido → su sobrante queda disponible para el siguiente.
- Escenario: lote que agota su plazo → no consume la reserva de cierre.

**Base medida:** 3 min (catálogo) + 4 lotes × 5 min = **23 min** de trabajo
permitido bajo `OVERALL_DEADLINE_MS` de **20 min**. `remainingMs` negativo
→ la espera de rezagados se salta entera.

**Resultado:** ✅ Unitaria: `planTickBudget` garantiza por construcción `catálogo + lotes × techo ≤ presupuesto de trabajo`, y la reserva de cierre queda fuera del reparto. Verificado además que un lote nunca recibe más de lo que queda del presupuesto de trabajo, para 5 valores de tiempo transcurrido.

## EXE-003 — Vencido el plazo, no empieza trabajo nuevo

Tras vencer el plazo no se inicia ninguna solicitud de red ni ninguna
escritura del trabajo cancelado: ni una fuente más, ni un detalle más, ni
una página más, ni un reintento más.

- Escenario: plazo vencido con fuentes pendientes → ninguna se inicia; se
  registran como no intentadas, no como fallidas.
- Escenario: plazo vence entre listado y detalle → el listado ya guardado
  persiste, el detalle no se inicia.

**Resultado:** ✅ Unitaria: contexto vencido → `hasBudgetFor` falso incluso para trabajo gratuito; contexto vivo con 5 s rechaza una fuente estimada en 30 s. Integración: con el plazo ya vencido no se inicia ninguna fuente (0 vacantes, 0 entradas en el informe). Sin contexto, comportamiento idéntico al anterior a P3.

## EXE-004 — Las esperas no sobreviven al plazo

Las pausas deliberadas (backoff 1/3/9 s de `executeWithResilience`,
`jitterDelay` de 1-6 s) terminan al vencer el plazo en vez de dormir hasta
el final.

- Escenario: plazo vence durante un backoff de 9 s → la espera termina de
  inmediato y no se realiza el reintento.
- Escenario: plazo vence durante el enfriamiento de 3-6 s previo al
  detalle → no se solicita ningún detalle.

**Resultado:** ✅ Unitaria: un backoff de 9 s bajo un plazo de 120 ms termina en <1 s y no se reintenta. Una espera dentro del presupuesto sí espera y no cancela el contexto. Sin contexto, se duerme como antes.

## EXE-005 — Cancelar nunca pierde lo ya obtenido *(riesgo principal)*

La cancelación distingue puntos abortables de no abortables. Una vez
iniciada una escritura, se termina.

**Abortables:** antes de una fuente nueva · antes de un detalle nuevo ·
durante backoff · durante jitter · entre páginas.

**No abortables:** dentro de `saveJobs()` · dentro de `updateJobDetail()` ·
`markRoleSourceRun` / `markGlobalSourceRun` de trabajo completado · cierre
de un intento de P2.

- Escenario: plazo vence con vacantes ya traídas y sin guardar → se
  guardan igualmente; el recuento coincide con el de una corrida sin plazo.
- Escenario: plazo vence durante `saveJobs` → el persist termina y su
  intento de P2 registra contadores reales, no `null`.

**Por qué importa:** el guardado por adaptador existe precisamente por un
incidente de pérdida de datos (2026-07-25, citado en `scrape-worker.ts`).
Una cancelación ingenua lo reintroduce.

**Resultado:** ✅ Integración: con presupuesto para una sola fuente, las 3 vacantes de la primera se persisten íntegras y la segunda no se inicia (`perSource.Magneto === undefined` — no se inventa un resultado). Unitaria: el orden observado es `fetch → persist-begin → persist-end` incluso con el plazo vencido a mitad de la escritura, y la siguiente fuente queda como `not-started`.

## EXE-006 — El proceso termina por su cuenta

El tick termina dentro de su plazo sin depender del `timeout-minutes` de
Actions. Ningún tramo posterior al vencimiento queda sin límite, incluido
el cierre del pool.

- Escenario: rezagados aún en vuelo al vencer → gracia acotada, cierre de
  la ejecución de P2, cierre del pool con límite y salida limpia.
- Escenario: el pool no cierra dentro de su límite → salida explícita
  registrada, nunca un bloqueo indefinido.

**Base medida:** 3 de los 12 últimos ticks CO (25%) terminaron `cancelled`
a los 27-28 min. El run 35031341207 agotó los 262 s completos de gracia
(22:46:52 → 22:51:14) sin que los rezagados terminaran.

**Resultado:** ✅ Unitaria: el temporizador del propio contexto está `unref`'d — comprobado sobre los handles activos del proceso — así que el mecanismo del plazo no puede ser lo que impida salir. Integración: la ejecución se cierra sola y libera sus leases. En el tick: cierre en 5 pasos, todos acotados, incluido `pool.end()` con tope de 10 s y salida explícita.

## EXE-007 — Reclamación atómica de rol/fuente

Dos ticks solapados nunca scrapean el mismo par rol/fuente a la vez. La
reclamación es una sola sentencia; un par ya reclamado y vivo se salta sin
error.

- Escenario: dos reclamaciones concurrentes del mismo par → exactamente
  una la obtiene.
- Escenario: lease caducado (proceso muerto) → el siguiente tick lo
  reclama sin intervención manual.
- Escenario: tabla sin migrar → se concede con aviso; la coordinación
  nunca impide que se scrapee.

**Resultado:** ✅ Integración: de dos reclamaciones concurrentes del mismo par gana exactamente una; un lease vivo no es robable; uno caducado se recupera sin intervención; el latido extiende solo los del propio `run_id`. Bloque de esquema aditivo, idempotente (aplicado dos veces) y con RLS activo. Sin la tabla migrada, se concede con aviso y el scraping continúa.

## EXE-008 — El rescan manual no invalida un lease activo

El rescan autenticado (`src/server.ts:876`) fuerza a un rol a estar
vencido, pero no puede liberar el lease de un tick que está scrapeando ese
rol en ese momento.

- Escenario: rescan manual durante un scrape activo del mismo rol → el
  lease sobrevive; el rol se recoge en el tick siguiente.

**Por qué es un requisito y no un detalle:** `markRoleForImmediateRescan`
hace `DELETE FROM role_source_runs WHERE role_name = $1`. Guardar el lease
en esa tabla lo expondría a ese borrado — es la razón de que sea una tabla
aparte.

**Resultado:** ✅ Integración: tras `markRoleForImmediateRescan`, la fila de cadencia desaparece pero el lease sobrevive, y otra ejecución no puede reclamar el par. Es la prueba directa de por qué la tabla es independiente.

## EXE-009 — Un rol vencido informa lo que sí completó

Cuando un rol agota su plazo, las fuentes que completó antes del
vencimiento siguen apareciendo en el resumen y en la telemetría de P2.

- Escenario: rol con 5 fuentes que vence en la 4ª → las 3 completadas se
  informan; la 4ª como interrumpida; la 5ª como no intentada.

**Base medida:** en el tick 35031341207 la tabla resumen listó 7 fuentes;
faltaban **Computrabajo, Elempleo y Magneto** porque `runWithTimeout`
devuelve `perSource: {}` al vencer.

**Resultado:** ✅ Integración: la fuente completada antes del corte sigue en el informe (`perSource.Torre.fetched === 3`). Antes de P3 ese mapa volvía vacío al vencer el rol.

## EXE-010 — La pérdida de disparos queda registrada y medida

La cadencia real de los ticks es observable a partir de `scrape_runs`, y
la decisión sobre el scheduler queda registrada con su evidencia.

- Escenario: consultar ejecuciones de 7 días → cadencia real frente a la
  solicitada por el cron.

**Base medida:** `*/15` (96/día) → 12 ejecuciones en 47 h. Prueba de que
no es configuración propia: `scrape-browser-tick.yml` pide `0 13 */2 * *`,
dura 4 min, grupo de concurrencia propio, y dispara entre las 15:40 y las
17:58 UTC. Impacto real acotado: las cadencias de 4-6 h se absorben solas
porque un rol vencido sigue vencido; las víctimas reales son RemoteOK y
GetOnBoard, a 1 h.

**Resultado:** ✅ Registrado en `docs/adr/0003-scheduler-cadence.md` con la evidencia y la consulta de medición sobre `scrape_runs`. Cron bajado a `*/30` como experimento con revisión el 2026-09-22.
