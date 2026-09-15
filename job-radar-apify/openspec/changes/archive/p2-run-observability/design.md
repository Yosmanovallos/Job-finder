# P2 — Diseño: observabilidad de ejecuciones y fuentes

Aprobado en sesión 2026-09-15 (decisiones del usuario: vista admin con
token de operador, tick de navegador incluido, retención 30 días).

## Evidencia de partida (código en `61ec1b1`)

- `GET /api/runs` → `getRuns()` → `getAllCachedRuns()` lee
  `data/jobs-cache.json`, archivo **versionado en git**. `saveJobs()` escribe
  una entrada por llamada (por adaptador por rol, máx. 20) en el disco del
  proceso que la ejecuta — un runner de Actions efímero. Render sirve el
  último snapshot commiteado: no refleja ninguna ejecución real.
- `/api/runs` no tiene consumidores en el repositorio (búsqueda en
  `*.ts`, `*.tsx`, `*.js`, workflows y docs): la compatibilidad requerida
  es la forma de respuesta, no una UI.
- `executeWithResilience()` devuelve `[]` ante circuito abierto, deny
  (`FetchBlockedError`) y reintentos agotados; `scrapeJooble()` devuelve
  `[]` sin API key, ante `!response.ok` y ante excepción; los scrapers de
  navegador capturan errores internamente. En el worker todo eso llega como
  `{fetched: 0}` — indistinguible de una fuente vacía.
- `validateJobs()` no incluye `Jooble` en `KNOWN_SOURCES`: toda vacante de
  Jooble se descarta antes de persistir (hallazgo previo; se hace visible
  con P2, se corrige en P5/P6).
- No existe primitiva de autorización administrativa en `server.ts`.
- Producción: ticks one-shot en GitHub Actions (CO/VE cada 15 min,
  navegador cada 2 días) + servidor web en Render. No hay proceso siempre
  vivo que pueda reconciliar.

## Contratos

### Esquema (aditivo, `src/db/schema.sql`, bloque `p2-run-observability`)

`scrape_runs` — una fila por ejecución:
`id UUID PK`, `workflow`, `trigger`, `is_test`, `country`, `git_sha`,
`gh_repository`, `gh_workflow`, `gh_run_id`, `gh_run_attempt`, `status`
(CHECK), `reason`, `started_at`, `heartbeat_at`, `finished_at`,
`reconciled_at`, `attempts_total`, `jobs_received`, `jobs_new`,
`jobs_duplicate`.
Índices: `(started_at DESC, id DESC)`; parcial `(heartbeat_at) WHERE
status = 'running'`.

`source_attempts` — una fila por fuente × rol × etapa dentro de una
ejecución (el detalle se agrega en una fila por adaptador/rol, no una por
vacante): `id UUID PK`, `run_id → scrape_runs ON DELETE CASCADE`,
`source_name`, `role_name`, `stage` (CHECK `listing|detail|verification`),
`status` (CHECK), `reason`, `error_class`, `started_at`, `finished_at`,
`duration_ms`, `received_count`, `valid_count`, `filtered_count`,
`new_count`, `duplicate_count`, `failed_count`, `request_count`,
`bytes_received`, `cost_usd`.
Índices: `(run_id, started_at)`; `(source_name, started_at DESC)`.

RLS habilitado en el mismo bloque y ambas tablas añadidas al `REVOKE ALL …
FROM anon, authenticated` existente. Se aplica con el `scripts/migrate.ts`
de siempre. Nunca se persiste el mensaje de error crudo (puede contener
URLs con credenciales, p. ej. la ruta de la API de Jooble): solo
`error_class` (nombre de la clase, ≤100) y un motivo codificado.

### Vocabulario

- Ejecución: `running`, `success`, `empty`, `partial`, `failed`,
  `timeout`, `interrupted`, `skipped`.
- Intento: `running`, `success`, `empty`, `partial`, `failed`, `timeout`,
  `interrupted`, `skipped`, `blocked`, `misconfigured`, y reservados
  `rate_limited`, `quota_exhausted`, `schema_changed` (OBS-004).

### Señales (`src/observability/run-telemetry.ts`)

`reportSourceSignal(signal)` escribe en el intento activo mediante
`AsyncLocalStorage`; fuera de un intento es no-op. Así
`executeWithResilience` informa sin cambiar su firma ni su comportamiento
(el pipeline de reputación lo comparte y no se ve afectado), y dos roles
concurrentes nunca mezclan señales.

| Emisor | Señal |
|---|---|
| `executeWithResilience` | `request` (cada invocación), `circuit_open`, `blocked`, `retries_exhausted` |
| `scrapeJooble` | `misconfigured` (sin key), `swallowed_error` (`!ok`, excepción) |
| Scrapers de navegador | `swallowed_error` en sus `catch` |

Se descartó derivar el estado del delta de `source_circuit_state.failures`
antes/después: `recordSuccess()` lo reinicia a 0 (un fallo seguido de un
éxito en otra keyword da delta 0) y roles concurrentes comparten la fila
de la fuente.

Clasificación pura `classifyAttempt({counters, signals, error, phase})` —
tabla en la spec OBS-003. Estado de ejecución
`deriveRunStatus(statuses)`: sin intentos → `skipped`
(`no_due_sources`); algún intento aún en curso al cerrar → `timeout`;
algún negativo (`failed`, `blocked`, `misconfigured`, `timeout`,
`interrupted`, `partial`, reservados) con algún `success`/`partial` →
`partial`; solo negativos → `failed`; sin negativos → `success` si hubo
algún éxito, si no `empty`, si no `skipped`. `skipped` y `empty` son
neutros.

### `RunRecorder`

```ts
RunRecorder.start({ workflow, country, store, env?, now? }): Promise<RunRecorder> // nunca lanza
recorder.trackAttempt(meta: {source, role, stage}, work: (a: AttemptHandle) => Promise<T>): Promise<T>
recorder.finish({ fatal? }): Promise<RunSummary>   // acotado por tiempo
RunRecorder.disabled(): RunRecorder                  // no-op para llamadores sin telemetría
```

- `store: RunTelemetryStore` es inyectable; la implementación Postgres
  vive en `src/db/run-repository.ts` (`createPgRunStore()`), así el módulo
  de telemetría no importa el pool y es testeable offline.
- Escrituras en una cola serializada **fuera** del camino del trabajo: el
  scraping nunca espera a la telemetría. Cada consulta lleva
  `query_timeout: 5000`. Tras 3 fallos consecutivos la telemetría de esa
  ejecución se desactiva (un aviso en logs).
- IDs generados en cliente (`randomUUID`), así un `insert` fallido no deja
  al trabajo sin identificador.
- `trackAttempt` relanza la excepción original del trabajo sin
  modificarla: el `catch` existente del worker conserva su mensaje en
  `perSource[].error`.
- Latido: `setInterval(60 s).unref()` desde `start()` hasta `finish()`.
- Todas las transiciones terminales usan `WHERE status = 'running'`:
  latido tardío, cierre tardío o intento rezagado no reviven ni
  sobrescriben un estado terminal.
- Detección de entorno: `JOB_RADAR_TEST_MODE` → `trigger=test`,
  `is_test=true`; `GITHUB_ACTIONS=true` → `trigger=GITHUB_EVENT_NAME`,
  `GITHUB_SHA/REPOSITORY/WORKFLOW/RUN_ID/RUN_ATTEMPT`; en otro caso
  `manual` y correlación `null`. Los workflows no necesitan cambios
  (variables por defecto de Actions).

### Integración

- `ScrapeWorker.processRoleJob({ …, recorder? })`: intento `listing`
  (fetch + `saveJobs`) y, si hubo inserciones y el adaptador tiene detalle,
  intento `detail` separado; luego `markRoleSourceRun` como hoy. Sin
  `recorder` el comportamiento es idéntico al actual. `perSource[]` gana
  `status` (aditivo).
- `saveJobs()` devuelve además `validCount` (aditivo); sigue escribiendo
  el caché JSON (lo leen `check-cache-jobs.ts`/`fix-cache-urls.ts`).
- `scripts/run-scrape-tick.ts`: `reconcileStaleRuns()` → `start` →
  catálogo global y roles con intentos → espera acotada existente →
  `finish()` (intentos en curso → `timeout`) → `purgeOldRuns(30)` →
  `pool.end()`. El resumen de Actions añade el estado por fuente.
- `scripts/run-browser-tick.ts`: mismo ciclo con 4 intentos `listing`.

### Superficies HTTP (`src/server/routes/runs.ts`)

- `GET /api/runs` (público): OBS-008. `name` =
  `"<workflow> <país|global> · <inicio ISO minuto>"`, `count` =
  `jobs_received`. El estado efectivo se deriva en SQL
  (`running` + latido > 10 min → `interrupted`). Error de BD → `503`.
- `GET /api/admin/runs`, `GET /api/admin/runs/:id` (OBS-009):
  `src/server/ops-auth.ts` compara SHA-256 del token con
  `timingSafeEqual`; sin variable o con < 32 caracteres → `404`. Los
  `401` ya alimentan `recordSuspiciousEvent` y el rate limit general de
  `/api/*` aplica.
- Cursores opacos base64url de `[startedAt, id]`, validados (ISO + UUID).

## Límites y coste

~192 ticks/día CO+VE × ~10–25 intentos → ~2–5 k filas/día; a 30 días
≈ 60–150 k filas de intentos (estimado ~20–40 MB con índices). Purga por
lotes de 500, máx. 10 lotes por tick. Consultas públicas limitadas a 50
ejecuciones con agregado por estado indexado por `run_id`.

## Compatibilidad y rollback

- Respuesta `/api/runs` conserva `runs[].id/name/count` y `count`.
  Cambio aprobado: la fuente pasa de caché JSON a Postgres (los `id`
  pasan de `run_<epoch>` a UUID) y un fallo de BD devuelve `503`.
- Rollback: revertir el commit. Las tablas nuevas quedan inertes; no hay
  columnas nuevas en tablas existentes ni borrado de datos.
- Si la migración no está aplicada al desplegar el código: los ticks
  siguen guardando vacantes (OBS-007) y `/api/runs` responde `503` hasta
  aplicar `scripts/migrate.ts`.

## Pruebas

- Unitarias (`tests/validate-run-telemetry.test.ts`, offline):
  clasificación, estado de ejecución, aislamiento de señales entre
  intentos concurrentes, recorder con store que falla/cuelga, detección
  de entorno, autorización de operador, cursores.
- Integración (`tests/validate-run-observability.ts`, PostgreSQL
  desechable): migración ausente → vacantes guardadas; bloque SQL real de
  `schema.sql` aplicado dos veces; RLS y `REVOKE`; worker con adaptadores
  sintéticos por cada estado emitido (incluye `executeWithResilience` y
  `joobleAdapter` reales sin red); timeout y rezagado; reconciliación
  idempotente; retención; `/api/runs` y admin contra el servidor real;
  `503` con tabla ausente.
- No cubierto por ejecución: `run-scrape-tick.ts` y `run-browser-tick.ts`
  completos (requieren fuentes vivas / Playwright + proxy). Sus piezas se
  prueban por separado y el cableado queda cubierto por `tsc`.
