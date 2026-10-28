# Validación — 2026-10-28

Base bbc93c8. Antes del código, lint global y typecheck del app pasan.

## Estado previo de las cinco páginas

Search Console UI autenticado, inspección almacenada del 28-Oct: las cinco
URLs están en Google/indexadas; canonical del usuario = URL propia y canonical
elegido por Google = URL inspeccionada. No prueba viva ni solicitud de indexación.
Los horarios siguientes son los de la UI; su zona horaria no se confirmó.

| Página | Último rastreo almacenado | Inventario público visible previo |
|---|---|---:|
| /empleos/armenia | 9 ago 2026, 21:05:07 | 136 |
| /empleos/neiva | 9 ago 2026, 21:12:11 | 130 |
| /empleos/ibague | 14 oct 2026, 15:12:27 | 204 |
| /empleos/popayan | 9 ago 2026, 21:08:58 | 68 |
| /ve/empleos/ingeniero-civil | 24 sept 2026, 16:11:40 | 28 |

GET público previo: cinco destinos 200, CO/VE correcto, canonical propio y
contenido SSR; / y /ve 200, health 200, /api/me 401 sin sesión. Snapshot en
OS temp market-expansion-before.json. Inventario visible no equivale a aptitud
Google de cada vacante ni a verificación individual de todas las ofertas.

## Gates y publicación

Prueba roja MDE-001 reproducida: esperaba los seis destinos CO y el helper
solo entregaba Bogotá/Cúcuta. Evidencia OS temp
job-radar-test-a8ce5001133389622e25540325d7d80a-XZfqZp/results.json.
Se amplía únicamente el helper; fixture y pruebas ejercitan los cinco destinos.
Lint global posterior y typecheck pasan. Unitarias: 40 suites pasan; baseline:
18 rutas, móvil/escritorio pasan; integración: 19 suites pasan. Las capturas del
bloque CO/VE a 390/1440 px se revisaron: sin cortes/desbordes, enlaces visibles
y clic de prueba exitoso incluso con stats 503 y Por cargo seleccionado.

Evidencia local en OS temp:
- unit: job-radar-test-09a5c54bee8a4da1be2affb0c97e1ef1-scqLel/results.json.
- baseline: job-radar-test-241c2e1232b22d99217296588cef087e-DU081Y/results.json.
- integration: job-radar-test-88a2defd3d21bf6503b70ecef7c7f827-DUQi0V/results.json.

Después de estas ejecuciones se incorporó origin/main e678a09 por fast-forward:
solo cambios ATS ajenos a helper, UI, fixture y pruebas de esta entrega. Lint y
tipos se comprueban otra vez; CI debe validar el head combinado antes de merge.
## Publicación y verificación de producción

PR #71 fusionado: dafec40fa2840a654a30f0f87c804cae51e7aaec.
CI manual [40777158535](https://github.com/Yosmanovallos/Job-finder/actions/runs/40777158535)
pasa sobre head 04c2c6c exacto, antes de merge: job-render, unit, job-seo,
baseline e integración. Se disparó manualmente porque los paths automáticos
del workflow no incluyen este helper; no se cambió el workflow.

Render confirmó dafec40 como Last successfully deployed commit, servicio Starter
existente. Main incorporó además el cambio de autenticación del PR #72 mientras
corría CI; no pertenece a esta entrega. Comprobaciones públicas posteriores:

- 17 rutas: home CO/VE, cinco destinos nuevos, controles de ciudades/cargo,
  dashboards y login 200; /api/health 200 y /api/me 401 sin sesión.
- Cinco destinos conservan país, inventario positivo y canonical propio.
- Ocho enlaces esperados presentes en HTML y Markdown; Vary Accept,
  Accept-Encoding preservado. DOM real CO muestra seis enlaces; VE muestra
  Caracas e ingeniero civil con contexto de ciudades y cargos.
- Navegación real desde el bloque a Ibagué y cargo VE confirmada por URL/H1.
- En 15 páginas, comparación previa/posterior sin cambios en title, H1,
  canonical, robots, hreflang y tipos de schema. No se afirma comparar todo
  el contenido dinámico de esquemas o descripciones con conteos cambiantes.
- Dashboard con URL única/Cloudflare MISS: CO 247 ms, VE 225 ms. No se
  modificaron consultas, caché o warmup ni se subió el plan de Render.

Snapshots públicos en OS temp market-expansion-before.json,
market-expansion-after.json y market-expansion-comparison.json. Contraste local
de estas capturas pasa; fixture/build sintéticos no fueron publicados.

Fase implementada y verificada; se archiva al registrar cierre. No se atribuye
mejora de ranking, tráfico o conversión a los enlaces antes de observación
suficiente. Revisar 7/14/28 días desde 28-Oct (4/11/25-Nov); monitor existente
conservado, sin crear otro. Rollback: revertir el merge #71, sin migraciones.
