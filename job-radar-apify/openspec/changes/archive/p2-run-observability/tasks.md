# P2 — Tareas

## 0. Aprobación y baseline

- [x] Proposal revisado; diseño presentado y aprobado (token de operador,
      tick de navegador incluido, retención 30 días).
- [x] Baseline de gates en `61ec1b1` con los mismos comandos que se usarán
      al cierre: `npx tsc --noEmit -p .` (en `job-radar-apify`) y
      `npx eslint job-radar-apify -f json` (desde la raíz del worktree).

## 1. Tests que fallan primero

- [x] `tests/validate-run-telemetry.test.ts` (unit): OBS-002, OBS-003,
      OBS-004, OBS-006, OBS-007, OBS-009 (autorización), OBS-010 (entorno),
      cursores.
- [x] `tests/validate-run-observability.ts` (integración): OBS-001…OBS-012
      contra PostgreSQL desechable y servidor real.
- [x] Registrar ambos en `scripts/run-isolated-tests.ts` (suite nueva
      `observability`).

## 2. Implementación

- [x] `src/observability/run-telemetry.ts`: vocabulario, señales
      (`AsyncLocalStorage`), clasificación, `RunRecorder`, entorno, cursores.
- [x] `src/server/ops-auth.ts`: autorización de operador fail-closed.
- [x] `src/db/schema.sql`: bloque `p2-run-observability` + `REVOKE`.
- [x] `tests/fixtures/production-baseline.sql`: `role_source_runs` y
      `source_circuit_state` (espejo de producción que el worker necesita).
- [x] `src/db/run-repository.ts`: store Postgres, reconciliación, purga,
      lecturas pública/admin.
- [x] Señales en `src/engine/resilient-fetch.ts`, `scrapeJooble`
      (`src/index.ts`) y scrapers de navegador.
- [x] `src/db/job-repository.ts`: `saveJobs().validCount`; `getRuns()`
      eliminado (sin llamadores tras delegar `/api/runs` en
      `routes/runs.ts` → `listRuns()`).
- [x] `src/queue/listing-attempt.ts` + `src/queue/scrape-worker.ts`:
      intentos `listing` / `detail`.
- [x] `scripts/run-scrape-tick.ts` y `scripts/run-browser-tick.ts`: ciclo de
      ejecución, reconciliación, cierre, purga, resumen con estado.
- [x] `src/server/routes/runs.ts` + montaje en `src/server.ts`.

## 3. Validación

- [x] `npm run test:unit` — 34/34 (23 seguridad P0 + filtros + roles +
      11 P2).
- [x] `npm run test:integration` — 6 suites en verde, incluida
      `validate-run-observability.ts` (OBS-001…OBS-012).
- [x] `npm run test:baseline` — en verde.
- [x] `npm run build` — en verde.
- [x] `tsc`: 29 errores, todos heredados; 0 nuevos (diff por archivo y
      mensaje contra baseline).
- [x] `eslint`: 295 errores, todos heredados; 0 nuevos (diff por archivo y
      regla). Los 7 archivos nuevos se analizan y no aportan errores.

## 4. Cierre

- [x] Resultados por requisito en la spec.
- [x] Mover a `openspec/changes/archive/p2-run-observability/`.
- [x] Actualizar tabla, hallazgos e historial en
      `docs/PROD-IMPROVEMENTS-PLAN.md`; borrador `proposal.md` de P3.
- [x] Commit local, sin push, merge ni despliegue.

## Incidencia de sesión

Los metadatos del worktree (`Job-finder/.git/worktrees/
Job-finder-prod-improvements`) fueron podados a las 15:47 por un proceso
ajeno a esta sesión (patrón de `git worktree prune` ejecutado desde WSL,
que ve como inexistente la ruta `C:/…`). Con aprobación del usuario se
recrearon `HEAD`/`commondir`/`gitdir` y se reconstruyó solo el índice
(`git read-tree HEAD`); working tree y rama intactos.

## Publicación (fuera de esta sesión, requiere aprobación)

1. ✅ **Hecho (2026-09-15, autorizado por el usuario).** No hay entorno de
   staging: `npx tsx scripts/migrate.ts` se aplicó contra la única base
   real, dos veces (idempotente). Verificado con
   `scripts/verify-p2-observability.ts`: ambas tablas con RLS activo, 0
   grants a `anon`/`authenticated`, vacías, y corpus sin cambios.
2. ✅ **Hecho (2026-09-15, por el usuario).** `OPS_ADMIN_TOKEN` configurado
   en Render. Verificado sin conocer el valor: `/api/admin/runs` pasó de
   `404` (variable ausente) a `401` sin token y con token incorrecto.
3. ✅ **Desplegado (2026-09-15).** `main` avanzó a `5d41861`; el código
   nuevo quedó activo ~60 s después del push. `/api/runs` responde `200`
   con el contrato nuevo y ya no expone los registros de prueba que servía
   el caché JSON versionado. **Pendiente:** observar el primer tick real
   CO/VE/navegador (ver nota de cadencia abajo).
4. Confirmar que un tick cancelado aparece `interrupted` en ≤ 25 min.
5. Confirmar el tamaño real de `source_attempts` tras 7 días frente a la
   estimación (~20–40 MB a 30 días).
6. ✅ **Hecho (2026-09-15)** contra producción ya desplegada: p95 de
   `GET /api/runs` = 258 ms, mediana 151 ms (objetivo < 800 ms).
7. ✅ **Hecho por el usuario (2026-09-15):** `OPS_ADMIN_TOKEN` documentado
   en `.env.example`.

### Nota de cadencia observada al desplegar (evidencia para P3)

El tick CO está programado cada 15 min, pero las ejecuciones reales de
2026-09-15 fueron 16:54, 19:53 y 22:30 UTC — entre 1,5 y 3 h de separación.
GitHub está descartando la mayoría de las ejecuciones programadas, justo el
riesgo que documenta el plan (§P3). Consecuencia práctica: tras desplegar,
la primera ejecución registrada puede tardar horas en aparecer salvo que se
dispare el workflow a mano (`workflow_dispatch` está habilitado).
