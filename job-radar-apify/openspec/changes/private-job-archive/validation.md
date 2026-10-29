# Validación — 2026-10-29

Base actualizada a producción `716e9ae` antes de cerrar gates. Los cuatro
commits previos contienen diagnóstico/documentación, sin cambios de aplicación.

- `pnpm lint`, `pnpm typecheck`: PASS.
- `pnpm test`: 214 PASS, 8 integración del monorepo omitidas por configuración.
- Aplicación `npx tsc --noEmit`: PASS.
- `npm run test:unit`: PASS (41 suites, entorno sanitizado y TCP bloqueado).
- `npm run test:integration`: PASS (19 suites, PostgreSQL 16 desechable).
  La primera ejecución detectó un tipo ambiguo UUID/text en una nueva fixture;
  se corrigió el parámetro y la segunda ejecución completa pasó.
- `npm run test:baseline`: PASS, 18 rutas, escritorio y móvil. Sin cambios
  en componentes, CSS, consultas calientes, warmup ni caché del dashboard.
  Imágenes dashboard móvil/escritorio inspeccionadas; se mantiene el diseño.

Evidencia local en directorios temporales de Windows:

- unit: `job-radar-test-cf969cf8bfa07c211d6052fc462d2401-UzbH8z/results.json`
- integration: `job-radar-test-967714437cab7eb7f922a5a6b4d44bce-oYJ6Op/results.json`
- baseline: `job-radar-test-672e423e3f8940d87a03eba691ff0716-rhJPLl/`

Verificado: conservación de hechos/ID/causa, cierre temprano, fallo de archivo
revierte retiro, idempotencia, dry-run, RLS y grants, hash guard independiente
del registro legado, límite de poda, 410/noindex sin cola, API sin archivo,
regresión de sitemap y proyección oficial sin renovar el plazo de 30 días.

Docker inicialmente falló por un socket temporal; se rechazó automáticamente
la limpieza local propuesta. No se eludió el bloqueo. El usuario inició Docker
y la integración se ejecutó después con normalidad.

## Producción

Migración aditiva aplicada desde Supabase SQL Editor autenticado, transacción
con lock_timeout 2 s y statement_timeout 30 s. SQL comparado íntegro antes de
Run. Resultado: archive_exists=true, rls=true, public_grants=0, archived_rows=0.
No se movió ni eliminó ninguna vacante al aplicar la migración.

Pendiente: despliegue de código y comprobación pública posterior.
