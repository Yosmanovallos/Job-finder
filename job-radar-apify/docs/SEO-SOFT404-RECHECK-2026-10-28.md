# Revalidación de Soft 404 — 2026-10-28

Fase ejecutada: primera entrega de SEO-SUSTAINABLE-STRATEGY-2026-10-28.
Código de producción/base verificada: origin/main a83f916. Se verifica la
reparación job-render-seo existente; no hay cambios nuevos de aplicación,
estilos, base de datos, caché, warmup, Render ni política de 30 días.

## Resultado de la muestra

Fuente: UI autenticada de Google Search Console, sc-domain:buscotrabajo.co,
inspección almacenada frente a prueba en vivo del 28-Oct. Cinco URLs del
informe Soft 404, muestra dirigida, no aleatoria: tres de Bogotá, una de
Cúcuta y una de Maracaibo. No extrapolar la tasa de recuperación al conjunto.

| Oferta / id | Rastreo almacenado, Soft 404 | Prueba en vivo, hora UI | Resultado |
|---|---|---|---|
| Inside sale, 80a79169-1999-4e16-abe7-ab4f22102c7c | 24-Oct 05:35:59 | 28-Oct 17:32, diagnóstico previo | Disponible/indexable; 1 JobPosting válido |
| KAE Institucional, 7ede46f0-e9a3-4a1a-bd46-3011c37d86ff | 24-Oct 03:07:28 | 28-Oct 17:52 | Disponible/indexable; 1 JobPosting válido |
| Desarrollador Full Stack, a06313e1-e3d6-40b9-ac99-bba6d93d60aa | 23-Oct 21:49:04 | 28-Oct 17:54 | Disponible/indexable; 1 JobPosting válido |
| Administrador Maracaibo, fcc4593b-336e-4723-974a-4597916e3277 | 23-Oct 20:41:08 | 28-Oct 17:52 | Disponible/indexable; 1 JobPosting válido |
| Trabajo social Cúcuta, 2d02220b-8a37-4464-9407-840fb1bb62ec | 21-Oct 19:35:33 | 28-Oct 17:53 | Disponible/indexable; 1 JobPosting válido |

Cuatro nuevas pruebas en vivo esta sesión; se reutiliza la primera del
diagnóstico inmediatamente anterior. Wizard no permite leer cuota por su
suscripción; no se usa API/bulk ni se estima su saldo. La UI permitió las
pruebas, sin rechazo de cuota. No hay bucles de inspección ni canarios de
adaptadores/fuentes externas.

Cinco GET públicos, concurrencia máxima dos, timeout 20 s: todos 200,
canonical propio, un JobPosting, payload SSR presente. Sin meta robots noindex
detectado por esa lectura. No se archivan cuerpos HTML ni datos de usuarios.
El estado HTTP y el marcado no prueban disponibilidad actual en el empleador.

Googlebot smartphone renderiza la oferta de Cúcuta con título, empresa,
descripción y botón hacia LinkedIn, conservando el diseño existente.
Captura local fuera del repositorio: visualizations/.../seo-soft404/
cucuta-google-live.jpg. La oferta Inside sale también había mostrado contenido
real en la captura del diagnóstico previo.

La validación anterior de Search Console comenzó 9-Aug y falló 10-Aug.
Sus dos contadores 239 pendientes / 2.439 error pertenecen a aquella corrida;
no son resultados de la nueva revisión. El informe general indica actualización
22-Oct y ejemplos con rastreos hasta 24-Oct: no es estado de render en vivo.

Dos ejemplos de aquella validación antigua responden **410** hoy:

- a32a9ac6-3bdf-41ce-a477-9ffaceb58264, Field sales supervisor Barranquilla.
- bdafa3cf-7622-4fcf-a86f-a687eef84c38, Analista de captación Zulia.

Se clasifican como URLs retiradas por la aplicación, no como fallo actual
de renderizado de oferta activa. No se comprobó cierre real en sus fuentes:
no atribuir el retiro a cierre confirmado en lugar de la política de edad.
No se restauran como 200 para quitar errores de Search Console.

## Acción en Search Console

Tras comprobar la muestra se pulsó «INICIAR NUEVA VALIDACIÓN» del grupo
Soft 404. Google aceptó la petición: «iniciada», fecha 28/10/26, 2.678
pendientes y 0 errores de la corrida nueva. El 29-Oct conserva ese estado.
El cero inicial no significa que se hayan corregido todas: aún no han sido
evaluadas. No equivale a indexación ni primeras posiciones.

## Pruebas y diseño

- pnpm lint y pnpm typecheck: pasan.
- TypeScript de job-radar-apify: pasa.
- test:job-render: 10/10, cliente compilado real, bloqueo de API en 390/1440,
  SSR matching id, navegación obsoleta, 404/410, 503, reintento, serialización
  y exclusión de campos privados. Sin llamadas reales de registro/postulación.
- test:integration: 19 suites pasan con PostgreSQL desechable; incluye páginas
  SEO, payload SSR, canonical, 404 real y coherencia sitemap/JobPosting.
- test:baseline: 18 rutas pasan con capturas escritorio/móvil e inventario
  sintético. No se usa su build de public/ para desplegar.
- Unitarias offline y monorepo 214 tests pasaron en el diagnóstico
  anterior sobre el mismo código a83f916; no se presentan como reejecutadas.

Evidencia temporal de los runners:

- job-radar-test-cd1221e195565ecccc7a450e9f7b81a1-Auzpq3/results.json
- job-radar-test-085f106d4f7d328373473b77a29eece7-BqLSfH/results.json
- job-radar-test-c1f8e1720d886d32c18e7f795c6713a2-0NLXdl/results.json

Las dos pruebas con build se lanzaron inicialmente de forma concurrente en
public/ compartido. Se repitió render secuencialmente: 10/10 pasan con su
propio build; evidencia definitiva:
job-radar-test-32b6419b6c922d951e57b2c30b6e14ca-cxKE62/results.json,
capturada 2026-10-28T22:56:59Z. Commit local 8c86d36 antes del rebase;
el mismo diagnóstico documental ahora es 8b5c89b. No cambió código.
Capturas sintéticas de render: se revisaron 390/1440; logo/fuentes externos
no cargan porque esa prueba intercepta toda la red y solo sirve assets locales.
La captura real de Google sí muestra el logo. No es una regresión visual.

## Criterio y siguiente paso

En esta muestra no se reproduce el fallo antiguo; no se justifica otra
reparación a ciegas. Google aún debe rastrear y decidir indexar. No se declaran
recuperadas las 2.678 URLs, ni una mejora de ranking o registros por esta acción.

En la revisión siguiente comprobar estado de la nueva validación, fechas de
rastreo y cambios del informe. Mantener los 410 legítimos. Si la validación
falla, clasificar sus nuevos ejemplos activos/retirados y reproducir antes de
editar. La medición de conversiones y la política de retención son fases
posteriores; no se implementan en esta sesión.

Continuación 29-Oct: se inspeccionaron las notificaciones de Search Console.
La validación sigue iniciada; no se reinicia ni se envían URLs masivamente.
Clasificación completa de avisos técnicos y contraste con producción en
SEO-ALERTS-TRIAGE-2026-10-29.md. Producción a964fce incorpora solo una
actualización documental ATS respecto a a83f916; mismo código de aplicación.
