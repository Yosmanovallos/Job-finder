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

PR de implementación: https://github.com/Yosmanovallos/Job-finder/pull/77
Ambos checks de GitHub PASS (2m42s y 4m05s), fusionado el 29-Oct 12:56:15 UTC.
`origin/main`: `3ae484f29909803f24b42a5513683ae2366de5fd`.

A las 12:57 UTC, después de integrar, el proceso público tenía 25 s de uptime
(antes: 1.847 s). Señal de reinicio compatible con el despliegue automático;
el endpoint no expone SHA, por lo que no certifica por sí solo la revisión
exacta de Render. No se accedió al panel de Render en esta comprobación.

Comprobación HTTP posterior desde proceso nuevo, sin caché de navegador:

| Superficie | Resultado |
|---|---|
| /api/health | 200, status ok, RSS 112.7 MB |
| /dashboard?archive-check=after-20261029 | 200, edge MISS, 377 ms (antes: 380 ms) |
| /empleos/bogota | 200, canonical propio, sin noindex, MISS |
| /empleos/cucuta | 200, canonical propio, sin noindex, MISS |
| /empleos/caracas | 200; alias /ve/empleos/caracas canoniza al mismo destino por contrato existente |
| /sitemap.xml y /sitemap-categories.xml | 200 |
| /sitemap-jobs.xml | 200, 7.903 URLs, 4.714 ms |
| API CO y VE, 24 filas por país | 200; ninguna >30 días en la muestra |
| Dos IDs retirados del diagnóstico anterior | 410, noindex, sin JobPosting |

Los controles HTTP no garantizan ausencia de cualquier fallo ni prueban que
el próximo worker haya archivado filas en producción. La nueva transición
se verificó en integración aislada; la tabla de producción estaba vacía al
migrar, y la ejecutará el siguiente tick normal desde main. No se forzó un
scrape completo ni se alteraron fechas para fabricar evidencia.

El navegador confirmó el resultado de migración antes de fallar la captura.
Después se detuvo el control de Windows al no poder verificar la URL de la
ventana. No se usó otra vía para eludir ese bloqueo; los controles posteriores
son HTTP público/CLI de GitHub. No hay captura de Supabase guardada.
