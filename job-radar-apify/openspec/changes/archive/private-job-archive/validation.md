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

## Cierre operativo — 29-Oct, 08:31 Bogotá

El control DOM de la sesión autenticada de Supabase vuelve a funcionar en
la nueva interacción, sin usar controles nativos de Windows. Consulta
`docs/sql/job-archive-operational-audit.sql`, transacción REPEATABLE READ
READ ONLY, statement_timeout 20 s, lock_timeout 2 s, ROLLBACK final. Se
comparó el SQL completo del editor con el archivo antes de ejecutar.
Resultado guardado en `docs/seo-evidence/job-archive-operational-2026-10-29.json`:

- 22 vacantes archivadas; primer lote 08:19:37 Bogotá.
- Motivo registrado por el pipeline: source_closed (22); no se reinterpreta
  ese motivo como una auditoría nueva del estado de cada empleador.
- 0 discrepancias entre ID/hash original y la instantánea; 0 fechas originales
  ausentes; 0 hashes expirados faltantes.
- 0 filas públicas vigentes con publicación original archivada >30 días.
- RLS activo; 0 grants a PUBLIC/anon/authenticated.
- Archivo, incluidos índices: 188.416 bytes; base completa: 440.355.987 bytes.
- `transaction_read_only=on`; sin modificar vacantes, fechas ni estado de fuentes.

Correlación: [Direct Employers Tick 40880002414](https://github.com/Yosmanovallos/Job-finder/actions/runs/40880002414)
terminó success desde `2c7512209690db94e26a838d1a23e101e5f8b6f2` y reportó
22 proyecciones retiradas. No se disparó manualmente un scrape para generar
esta evidencia. El otro tick general 40881594983 seguía en curso; no se
presenta como terminado ni se atribuyen sus futuros retiros a este lote.

Muestra recién archivada, ID público `10348e51-68bf-4e10-b89a-2e7dd88a8504`:
página 410/noindex/sin JobPosting; `/api/jobs/:id` y `/api/v1/jobs/:id` 404.
No se extrajeron cuerpos de ofertas ni información de candidatos.

Revisión pública de las 08:29–08:33 Bogotá: salud, dashboard, páginas locales
y sitemaps 200. API CO/VE: 24 ofertas por país, 0 mayores de 30 días en esa
muestra. Dashboard edge MISS 406 ms. Sitemap de ofertas: 7.959 URLs (conteo
puntual, varía con ingesta). Dos retiradas históricas mantienen 410/noindex.

**Señales pendientes, sin cambios de código en esta fase:**

- Primera lectura simultánea de Bogotá/Cúcuta/alias Caracas: 9.997–10.384 ms,
  frente a ~2 s en el control anterior. Revisión secuencial posterior con URL
  distinta: Bogotá 334 ms, Cúcuta 304 ms. No se atribuye causa sin medición:
  hay que separar MISS del borde, caché del proceso, consultas y carga de
  ingesta. No declarar una mejora permanente por la segunda lectura caliente.
- El tick oficial terminó, pero Altipal y Mondelez registraron errores de
  formato. Investigar como trabajo posterior, sin ejecutar canarios nuevos ni
  cambiar el ciclo de vida o el diseño para ocultarlos.

Se cierra la fase de archivo privado. No prueba mejora de posiciones, tráfico
ni cumplimiento del objetivo de crecimiento; requiere medición SEO posterior.
