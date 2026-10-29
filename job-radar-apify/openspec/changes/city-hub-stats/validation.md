# Validación (2026-10-29)

- `tsc --noEmit`: 0 errores. ESLint sobre los 10 archivos tocados: limpio.
- `test:unit`: 43/43 archivos, incluido el nuevo `validate-city-hub-stats.test.ts`.
  Sus 6 casos cubren:
  - 7 días exacto o "60+";
  - empresas con conteo y sin "Confidencial";
  - cargos ≥ 2, con prefijo `/ve` para Caracas;
  - salario solo con moneda y ≥ 3;
  - hub vacío sin sección;
  - meta ≤ 160 caracteres en todas las ciudades.
  `validate-role-matching` (12 casos) sigue en verde tras `roleTitleMatcher`.
- `test:job-seo`, `test:seo` (`validate-seo-job-pages.ts`) y
  `test:agent-readiness` (enlaces del home en HTML y Markdown): en verde.
- `test:baseline`: 19 rutas, escritorio y móvil, sin errores de página.
  - En cada hub con vacantes comprueba `data-category-stats` en el HTML inicial y
    después de hidratar.
  - En Santa Marta (fixture sintético) comprueba: empresas con conteo, el enlace
    `/empleos/asesor-comercial`, "entre COP 1.600.000 y COP 2.800.000" (3 de 5;
    el texto libre "A convenir" queda fuera) y "0 son de los últimos 7 días".
  - Captura el bloque centrado (`city-stats-10-{1440,390}.png`) en el directorio
    temporal que imprime el runner. Las capturas no se versionan.
- Rendimiento:
  - Ninguna consulta nueva: las cifras salen del mismo `getJobsPage(limit 60)` en
    caché del hub.
  - `queryJobsPage` solo mapea columnas que ya seleccionaba. Claves de caché y
    warmup sin cambios.
  - `buildCategoryInsights` sobre 60 filas: mediana 0,60 ms, p95 2,0 ms (50
    ejecuciones locales). Los planes de rol se construyen una vez por proceso.
- `/api/jobs` devuelve la vacante completa. El salario llega igual cuando React
  recalcula las cifras al navegar entre hubs.

Nota: los primeros intentos de `test:job-seo`, `test:seo` y `test:agent-readiness`
dieron 500 porque el worktree nuevo no tenía `public/` (lo genera
`test:baseline`). Con el build presente, las tres pasan.
