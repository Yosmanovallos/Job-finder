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
Verificación posterior de producción pendiente. No se atribuye mejora de ranking,
tráfico o conversión a los enlaces antes de disponer de observación suficiente.
