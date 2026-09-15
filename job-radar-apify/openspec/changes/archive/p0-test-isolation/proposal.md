# P0 — Aislamiento y entorno seguro de verificación

**Estado:** archivado (implementado en `a73a85e`, registro retrospectivo).

## Problema

Las pruebas históricas podían cargar el entorno normal y conectarse a la
base de datos real; algunas escribían en `indexing_queue` o `jobs`. No
existía forma segura de verificar cambios sin arriesgar producción, ni un
baseline reproducible para comparar SEO/comportamiento.

## Qué se construyó

- Runner aislado (`scripts/run-isolated-tests.ts`): directorio temporal,
  PostgreSQL 16 desechable en Docker (imagen fijada por digest), puerto
  loopback aleatorio, fixture `tests/fixtures/production-baseline.sql`
  (120 vacantes sintéticas), entorno sanitizado sin `.env` ni credenciales
  heredadas, red TCP bloqueada en suites offline, reportes en el
  directorio temporal del SO.
- Guardas fail-closed: `require-test-environment.ts`,
  `require-isolated-database.ts`, `require-live-sources.ts` — los tests
  rechazan el entorno habitual y los canarios en vivo exigen
  `--allow-live-sources` explícito.
- Baseline local: 9 rutas públicas, capturas escritorio/móvil, metadatos
  SSR (`test:baseline`).
- Scripts: `test:unit`, `test:integration`, `test:baseline`,
  `test:canary:adapters`.

## Resultado

- 22 pruebas de seguridad del entorno, filtros/roles, paginación, SEO,
  empresas y baseline: verdes.
- Build frontend: verde.
- Gates heredados de la base `74f066b`: 35 errores de typecheck y 33 de
  lint en tests históricos, **0 nuevos** atribuibles a P0. Documentados,
  no ocultos.
