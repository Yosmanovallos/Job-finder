# Spec delta — observabilidad de ejecuciones y fuentes (P2)

Requisitos observables. Cada ID se traza a escenarios, pruebas
(`tests/validate-run-telemetry.test.ts` = unitaria,
`tests/validate-run-observability.ts` = integración) y resultado.
Resultados obtenidos en local, PostgreSQL 16 desechable (imagen fijada) y
servidor real; **sin despliegue** — la decisión de publicación sigue
pendiente (ver `tasks.md`, «Publicación»).

## OBS-001 — Toda ejecución queda registrada

Cuando un tick de scraping (CO, VE o navegador) arranca, debe existir un
registro de ejecución con: flujo (`scrape-tick` / `browser-tick`), disparo
(`schedule`, `workflow_dispatch`, `manual`, `test`), país, inicio, latido,
final, estado y motivo. Si corre en GitHub Actions, se guardan SHA,
repositorio, workflow, `run_id` y `run_attempt`; fuera de Actions esos
campos quedan en `null` (nunca inventados).

- Escenario: entorno con variables `GITHUB_*` → los identificadores quedan
  persistidos y el disparo es el `GITHUB_EVENT_NAME`.
- Escenario: sin variables `GITHUB_*` → disparo `manual`, correlación `null`.

**Resultado:** ✅ integración: fila con `schedule`, SHA, repositorio,
workflow, `run_id`/`run_attempt`; unitaria: entorno vacío → `manual`/`null`,
valores hostiles (SHA, repositorio, run id, evento) descartados.
`run-scrape-tick.ts` / `run-browser-tick.ts` cableados y cubiertos por `tsc`
(no ejecutados completos: requieren fuentes vivas / Playwright + proxy).

## OBS-002 — Todo intento por fuente queda registrado con contadores

Cada intento de una fuente (etapa `listing` o `detail`) persiste: fuente,
rol (o `null` en catálogo global/navegador), etapa, estado, motivo (código
corto), clase de error (sin mensaje crudo), inicio, final, duración,
solicitudes y contadores `received`, `valid`, `filtered`, `new`,
`duplicate`, `failed`. `bytes_received` y `cost_usd` quedan en `null`
mientras la fuente no los reporte.

- Listado: `received` = vacantes devueltas por el adaptador; `valid` =
  aceptadas por el validador; `filtered` = `received − valid`; `new` /
  `duplicate` = resultado de la deduplicación.
- Detalle: `received` = vacantes nuevas elegibles; `valid` = detalles
  obtenidos; `filtered` = no intentadas por el tope por adaptador/rol;
  `failed` = detalles que lanzaron error.

**Resultado:** ✅ 12 intentos (11 listado + 1 detalle) con contadores
exactos (p. ej. `2/2/0/2/0`, duplicados `0/2`, rechazados `1/0/1`,
detalle `1/1/0/0`), `request_count` real (2 con reintentos, 0 con circuito
abierto), `bytes`/`cost` en `null`, ningún mensaje de error crudo
persistido.

## OBS-003 — Ningún fallo se presenta como éxito vacío

El estado de un intento se deriva de señales reales del código:

| Situación | Estado | Motivo |
|---|---|---|
| Resultados > 0 sin señales negativas | `success` | `ok` |
| 0 resultados sin señales negativas | `empty` | `no_results` |
| Resultados > 0 con alguna señal negativa | `partial` | motivo de la señal |
| Circuito abierto, 0 resultados | `skipped` | `circuit_open` |
| Deny definitivo (401/403), 0 resultados | `blocked` | `http_deny` |
| Reintentos agotados, 0 resultados | `failed` | `retries_exhausted` |
| Error capturado y tragado dentro del scraper, 0 resultados | `failed` | `swallowed_error` |
| Credencial requerida ausente | `misconfigured` | `missing_credentials` |
| Excepción que escapa del adaptador | `failed` / `blocked` / `timeout` | `exception` / `http_deny` / `timeout` |
| Error al persistir vacantes | `failed` | `persistence_error` |
| Resultados > 0 y todos rechazados por validación | `failed` | `all_rejected_by_validation` |

- Escenario: fuente con circuito abierto → `skipped`, no `empty`.
- Escenario: fuente con 403 → `blocked`, no `empty`.
- Escenario: Jooble sin `JOOBLE_API_KEY` → `misconfigured`, no `empty`.

**Resultado:** ✅ tabla completa en unitaria; en integración cada estado
emitido sale de caminos reales (`executeWithResilience`, `joobleAdapter`
sin red, validador, adaptador que lanza, mezcla ok+403 → `partial`).
Señales aisladas entre intentos concurrentes (`AsyncLocalStorage`).
Señal `swallowed_error` añadida solo a Jooble y a los scrapers de
navegador; el resto de scrapers de `src/index.ts` que tragan errores queda
para P4/P5.

## OBS-004 — Vocabulario completo, emisión honesta

El contrato acepta además `rate_limited`, `quota_exhausted` y
`schema_changed`. **P2 no los emite**: el código actual no dispone de una
señal fiable para distinguirlos (se incorporan con `SourceFetchResult` en
P4 y señales por adaptador en P5). Ningún intento se etiqueta con ellos por
inferencia.

**Resultado:** ✅ presentes en `CHECK` y contrato; barrido exhaustivo de
combinaciones de señales × etapas × resultados nunca los produce.

## OBS-005 — Latido y reconciliación de ejecuciones muertas

Una ejecución activa actualiza su latido cada 60 s. Una ejecución en
`running` cuyo latido supera 10 min se considera muerta:

- Al iniciar el siguiente tick se reconcilia a `interrupted`
  (`heartbeat_expired`), y sus intentos en `running` pasan a `interrupted`
  (`run_interrupted`). La operación es idempotente.
- Las lecturas (`/api/runs`, admin) muestran ya `interrupted` para una
  ejecución muerta aún no reconciliada, sin escribir.
- Un estado terminal nunca se sobrescribe: un proceso pausado que retoma
  no revive la ejecución ni cambia su resultado.

**Resultado:** ✅ reconciliación `{runs: 1, attempts: 1}` y luego
`{0, 0}`; `finishRun`/latido tardíos no cambian `interrupted`; API muestra
`interrupted`/`heartbeat_expired` para una ejecución muerta mientras la
fila sigue `running` (lectura sin escritura).

## OBS-006 — Plazo agotado

Al cerrar un tick, los intentos que siguen en curso pasan a `timeout`
(`deadline_exceeded`) y la ejecución queda en `timeout`. Si el trabajo
rezagado termina después, no sobrescribe ese estado.

**Resultado:** ✅ intento colgado → `timeout`; al liberarlo guarda su
vacante (`savedCount = 1`) y la fila sigue `timeout/deadline_exceeded`.
La cancelación efectiva del trabajo rezagado es alcance de P3.

## OBS-007 — La telemetría nunca pone en riesgo las vacantes

Un fallo de telemetría (tabla ausente, BD lenta, pool cerrado) no lanza
errores al camino de scraping, no impide `saveJobs`, no impide actualizar
la cadencia y no retrasa el trabajo más allá de su tiempo acotado por
consulta (5 s). Tras fallos repetidos la telemetría se desactiva para esa
ejecución y lo registra en logs una vez.

- Escenario: migración P2 no aplicada → el worker guarda las vacantes y
  termina normalmente.

**Resultado:** ✅ sin tablas (`42P01`) el worker guardó 2 vacantes y la
cadencia, un único aviso; unitaria: store que falla → 1 intento de
escritura y trabajo intacto; store que cuelga → `finish` acotado
(< 1 s con plazo de prueba).

## OBS-008 — `/api/runs` compatible y seguro para público

- Mantiene `200 {"runs": [{"id","name","count", …}], "count"}`; los campos
  nuevos son aditivos (`status`, `reason`, `workflow`, `country`,
  `startedAt`, `finishedAt`, `jobs`, `attempts.byStatus`, `nextCursor`).
- Fuente: ejecuciones persistidas, no el caché JSON local.
- Paginado: `limit` (1–50, por defecto 20) y cursor opaco `before`;
  cursor inválido → `400`.
- No expone roles, clases de error, SHA, identificadores de Actions ni
  ejecuciones de prueba.
- Si la BD falla → `503` con `{"error": …}`; nunca `200` con lista vacía.

**Resultado:** ✅ contra el servidor real: forma y claves exactas,
`Cache-Control: no-store`, orden y paginación sin huecos ni duplicados,
`400` con cursor manipulado, sin roles/SHA/run id/repositorio/clases de
error/ejecución de prueba, `503` sin `runs` al ocultar la tabla.
Cambio aprobado: los `id` pasan de `run_<epoch>` a UUID.

## OBS-009 — Vista administrativa paginada

- `GET /api/admin/runs` y `GET /api/admin/runs/:id` exigen
  `Authorization: Bearer <OPS_ADMIN_TOKEN>` (comparación en tiempo
  constante).
- Sin `OPS_ADMIN_TOKEN` configurado (o con menos de 32 caracteres) → `404`
  (desactivado, fail-closed). Token ausente o incorrecto → `401`.
- Incluye correlación con Actions, disparo, latido, reconciliación y los
  intentos de la ejecución paginados (`limit` 1–200, cursor `after`).
- `includeTest=true` muestra ejecuciones de prueba; por defecto se ocultan.

**Resultado:** ✅ unitaria: sin token/corto → `disabled`, esquema o token
distinto → `unauthorized`; integración: `401` sin/erróneo, URL de Actions
construida, 12 intentos recorridos en páginas de 5 sin duplicados,
intentos de ejecución muerta como `interrupted`, `404` para id inválido o
inexistente, `400` con cursor inválido, prueba oculta salvo `includeTest`.

## OBS-010 — Registros de prueba separados

Una ejecución iniciada bajo el entorno aislado de pruebas se marca
`is_test = true` con disparo `test` y no aparece como actividad productiva
en `/api/runs` ni en la vista admin por defecto.

**Resultado:** ✅ fila `test/true`; ausente del listado público y del
admin por defecto.

## OBS-011 — Migración aditiva y reversible

- Solo `CREATE TABLE/INDEX IF NOT EXISTS`; ninguna tabla existente cambia.
- Aplicarla dos veces es idempotente.
- RLS habilitado y `REVOKE ALL … FROM anon, authenticated` en la misma
  migración (patrón zero-policy).
- Rollback: revertir el código deja de escribir; las tablas pueden quedar
  sin afectar a nada. No se borran vacantes.

**Resultado:** ✅ el bloque real de `schema.sql` aplicado dos veces, sin
`DROP`/`TRUNCATE`/`DELETE FROM`/`ALTER` ajenos; `relrowsecurity = true` en
ambas tablas; `REVOKE` declarado (verificación contra roles reales de
Supabase pendiente de staging: la base desechable no tiene `anon`).

## OBS-012 — Retención acotada

Al cerrar cada tick se purgan, en lotes acotados, ejecuciones terminadas
con más de 30 días (sus intentos en cascada). Un fallo de la purga no
falla el tick.

**Resultado:** ✅ ejecución de 40 días purgada con sus intentos; las
recientes se conservan. Aislamiento del fallo vía `runTelemetrySafely`.
