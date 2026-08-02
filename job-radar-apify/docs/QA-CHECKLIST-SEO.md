# Checklist manual de QA — SEO / páginas individuales de vacante

Todo lo que `npm run test:seo` no puede cubrir porque requiere un navegador
real, ver el render visual, o validar contra herramientas externas de
Google. Repetir esta lista completa después de cualquier cambio en
`src/lib/job-seo.ts`, `src/server.ts` (rutas `/empleos/` y `/dashboard`),
`src/App.tsx`, `src/sections/JobLanding.tsx`, `src/sections/Dashboard.tsx`,
o `src/index.html`.

**Antes que nada: correr `npm run test:seo`.** Es de solo lectura (nunca
escribe en la tabla `jobs` — no hay entorno de test separado en este
proyecto, ver la nota de seguridad al final) y cubre la lógica pura y la
integración HTTP básica. Este checklist es el paso siguiente, no un
sustituto.

## 0. Regresión — lo que ya funcionaba, primero

Antes de revisar lo nuevo, confirmar que nada de lo existente se rompió
(el motivo de esta sección: evitar repetir el incidente de esta sesión
donde un cambio en el layout del dashboard rompió silenciosamente el
`position: sticky` de la barra de búsqueda).

- [ ] `/dashboard` carga, los filtros funcionan, el panel de detalle sigue
      pegado (`sticky`) al hacer scroll hasta el fondo de una lista larga.
- [ ] El buscador de arriba (`Título, empresa o palabra clave...`) y los
      selects rápidos de fecha/modalidad/ciudad siguen funcionando.
- [ ] `/`, `/login`, `/pricing`, `/legal/*` cargan sin error de consola.
- [ ] `npm run test:dashboard-filters` sigue en verde.

## 0.1 `/dashboard` — HTML crudo (vista de crawler, no lo que ves en pantalla)

Confirmado en Search Console (2026-07-29) que Google había indexado
`/dashboard` con "0 de 0 vacantes" — el contenido real solo existía
detrás de un `fetch()` del navegador que el rastreo de Google no esperó
a que terminara. Se corrigió inyectando la primera página de vacantes
directo en el HTML que entrega el servidor. Repetir esto tras cualquier
cambio a `Dashboard.tsx` o a la ruta `/dashboard` de `server.ts`:

- [ ] `curl -s http://localhost:3000/dashboard | grep 'href="/empleos/'`
      devuelve varias líneas (no vacío).
- [ ] Ese mismo HTML crudo **no** contiene el texto "No se encontraron
      vacantes".
- [ ] En un navegador real, el dashboard se ve y funciona exactamente
      igual que antes — el HTML de arriba se reemplaza casi
      instantáneamente al montar React (no debe quedar visible ni
      duplicar contenido).

## 1. Página individual de vacante (`/empleos/:id/:slug`) — vista de crawler

Usar "Ver código fuente" del navegador (Ctrl+U) o `curl`, **no** las
herramientas de desarrollador con JS ya corrido — el objetivo es ver
exactamente lo que Googlebot lee antes de ejecutar JavaScript.

- [ ] El `<title>` es el de la vacante (no el genérico de
      "BuscoTrabajo — Vacantes de Empleo..."), y aparece **una sola vez**.
- [ ] `<link rel="canonical">` apunta a `/empleos/<id>/<slug>` de esa
      vacante — no a `https://buscotrabajo.co/` (el bug obvio si alguna
      vez se vuelve a "agregar" en vez de "reemplazar" los tags de
      `index.html`). Debe aparecer **una sola vez**.
- [ ] `<meta name="description">`, `og:title`, `og:description`,
      `twitter:title`, `twitter:description` — todos actualizados, cada
      uno una sola vez.
- [ ] Hay un `<script type="application/ld+json">` con `"@type":
"JobPosting"` (además de los de Organization/WebSite que ya
      existían — esos deben seguir intactos).
- [ ] Copiar ese bloque JSON-LD y pegarlo en
      [Google Rich Results Test](https://search.google.com/test/rich-results)
      — debe validar sin errores (warnings de campos opcionales como
      `employmentType` son aceptables, no hay esa data y no se inventa).
- [ ] Probar con una vacante cuyo título tenga tildes, paréntesis o
      símbolos raros (`Ingeniero(a) — Bogotá`) — la URL generada no debe
      romperse ni el JSON-LD debe corromperse.
- [ ] Un id que no existe (`/empleos/00000000-0000-0000-0000-000000000000/x`)
      responde 404 real (ver el código de estado, no solo el mensaje en
      pantalla).

## 2. Página individual — vista de usuario real (después de que carga JS)

- [ ] Entrar a la URL de una vacante real directamente (pegarla en la
      barra de direcciones, no navegar desde dentro de la app) — carga,
      muestra la vacante, el título de la pestaña coincide con el de la
      vacante.
- [ ] El link "← Ver todas las vacantes" vuelve a `/dashboard`.
- [ ] Botón "Aplicar en `<fuente>`" abre la URL externa real en una pestaña
      nueva.
- [ ] Estando deslogueado, hacer clic en "Aplicar" abre el modal de
      registro (`ApplyGateModal`), igual que en el dashboard.
- [ ] Vacante con `isLocked = true` (si el paywall llega a reactivarse,
      `PAYWALL_ENABLED = true` en `config.ts`) muestra el `PaywallCard`,
      no el detalle completo — y su versión servida al crawler debe tener
      `<meta name="robots" content="noindex">` y **ningún** JSON-LD de
      JobPosting (confirmarlo con "Ver código fuente", no solo en pantalla).

## 3. Que nada de esto afecte el resto del sitio

- [ ] El peso de la página de inicio/dashboard (Lighthouse o simplemente
      "cuánto tarda en cargar") no cambió — las rutas nuevas son aditivas,
      no deberían tocar el bundle que ya se carga en esas páginas.
- [ ] `robots.txt` sigue permitiendo `/empleos/` (no hace falta agregarlo
      explícitamente — el `Allow: /` genérico ya lo cubre — pero confirmar
      que no hay un `Disallow` que lo bloquee por accidente).

## 4. Sitemap (Fase 2)

- [ ] `https://buscotrabajo.co/sitemap.xml` abre y es un `<sitemapindex>`
      con dos entradas (`sitemap-pages.xml`, `sitemap-jobs.xml`) — no una
      lista plana de URLs como antes.
- [ ] `https://buscotrabajo.co/sitemap-jobs.xml` abre, tiene miles de
      `<url>` con `/empleos/...` reales, y el navegador no marca error de
      XML mal formado.
- [ ] Tomar 2-3 URLs al azar de ese sitemap y pegarlas directo en el
      navegador — deben cargar la vacante (200), no un 404.
- [ ] En Search Console → Sitemaps: reemplazar/reenviar
      `https://buscotrabajo.co/sitemap.xml` (la propiedad ya está
      verificada desde antes, este paso no necesita nada de DNS).
- [ ] Unos días después: revisar Indexación → Páginas para ver si
      empiezan a aparecer vacantes indexadas (no solo `/` y `/dashboard`).

## 5. Google Indexing API (Fase 3)

Repetir tras cualquier cambio en `src/lib/google-indexing.ts`,
`src/db/indexing-repository.ts`, los hooks en `saveJobs()`/`purgeOldJobs()`,
o `scripts/run-indexing-tick.ts`.

- [ ] `npm run test:seo` en verde, incluida la Parte 3 (firma JWT +
      round-trip de `indexing_queue`) — cubre todo lo que no necesita las
      credenciales reales de Google.
- [ ] `npm run indexing:tick` con `.env` **sin** `GOOGLE_INDEXING_CLIENT_EMAIL`/
      `GOOGLE_INDEXING_PRIVATE_KEY` configuradas: debe salir con "skipping,
      queue left pending" y código 0 — nunca debe marcar filas como
      `failed` solo porque las credenciales no están puestas todavía.
- [ ] Insertar una vacante de prueba real (o esperar al próximo tick de
      scraping) y confirmar con `SELECT * FROM indexing_queue ORDER BY
created_at DESC LIMIT 5` que aparece una fila `URL_UPDATED` `pending`
      con la URL correcta de `/empleos/...`.
- [ ] Después de configurar las credenciales reales (ver
      `docs/SEO-PLAN.md` sección 7.2): correr `npm run indexing:tick` una
      vez a mano y confirmar que al menos una fila pasa a `sent` con
      `sent_at` reciente — si falla, revisar `error` en esa fila (403 casi
      siempre significa que la cuenta de servicio no tiene permiso de
      **Propietario** en Search Console, no "Completo").
- [ ] `getIndexingBudgetRemaining()` nunca debe permitir que
      `run-indexing-tick.ts` envíe más de 200 en 24 horas reales, sin
      importar cuántas veces corra el cron en ese período — confirmar
      contando `SELECT COUNT(*) FROM indexing_queue WHERE status='sent'
AND sent_at > NOW() - INTERVAL '24 hours'` no supera 200 después de
      varias corridas seguidas.

## 6. Páginas de categoría (Fase 4) — `/empleos/<slug-ciudad-o-rol>`

Repetir tras cualquier cambio en `resolveCategorySlug`/`buildCategoryMeta`/
`buildCategoriesSitemapXml` (`src/lib/job-seo.ts`), la rama de categoría
dentro de `pathname.startsWith("/empleos/")` en `src/server.ts`,
`src/sections/EmpleosRoute.tsx`, `src/sections/CategoryLanding.tsx`, o
`src/components/CategoryJobRow.tsx`. Mismo esquema de URL que las vacantes
individuales (`/empleos/<slug>`, sin prefijo nuevo) — el `id` se distingue
por ser o no un UUID, ver `isUuid()`/`resolveCategorySlug()`.

- [ ] `curl http://localhost:3000/empleos/bogota` (o cualquier ciudad de
      `CITY_OPTIONS`) responde 200 y trae exactamente un `<title>` y un
      `<link rel="canonical">` apuntando a esa misma URL de categoría, no a
      la home.
- [ ] El `<meta name="description">` incluye el conteo real de vacantes de
      esa categoría (nunca un número inventado — comparar contra
      `curl .../api/jobs?cities=Bogotá` para confirmar que coincide).
- [ ] El HTML crudo (`curl`, no dev tools con JS corrido) contiene varios
      `href="/empleos/<uuid>/..."` — links reales a páginas de vacante
      individual, no solo a `/dashboard`. Este es el "hub → item" que le da
      sentido SEO a la página.
- [ ] Repetir con un rol real de `DEFAULT_ROLES_200` (ej.
      `/empleos/project-manager`) — mismos checks.
- [ ] Un slug inventado (`/empleos/esto-no-existe-de-verdad`) responde 404
      real (código de estado, no solo el mensaje en pantalla).
- [ ] Una categoría con 0 vacantes reales hoy (buscar una con
      `curl .../api/jobs?roles=<rol>&limit=1` → `"total":0`) responde 200,
      con copy honesto ("No hay vacantes en esta categoría por ahora") y
      `<meta name="robots" content="noindex">` — nunca se indexa una
      categoría vacía como si tuviera contenido real.
- [ ] En un navegador real: entrar directo a la URL de una categoría
      (pegarla en la barra de direcciones) — carga, muestra el listado, el
      link "← Ver todas las vacantes" vuelve a `/dashboard`, y cada card
      lleva a la página interna de la vacante (`/empleos/:id/:slug`), nunca
      directo a la URL externa de aplicar.
- [ ] Regresión: una página de vacante individual (`/empleos/:id/:slug`)
      real sigue funcionando exactamente igual que antes de la Fase 4 (el
      dispatcher `EmpleosRoute.tsx` no debe cambiar su comportamiento).
- [ ] `https://buscotrabajo.co/sitemap-categories.xml` abre, es un
      `<urlset>` válido, con tantas `<url>` como
      `CITY_OPTIONS.length + COUNTRIES.VE.cities.length + DEFAULT_ROLES_200.length * 2`
      (79 al momento de escribir esto — 9 ciudades CO + 6 ciudades VE + 32
      roles CO + 32 roles VE — ver sección 8, Fase 6).
- [ ] `https://buscotrabajo.co/sitemap.xml` (índice) ahora lista 3 entradas:
      `sitemap-pages.xml`, `sitemap-jobs.xml`, `sitemap-categories.xml`. En
      Search Console → Sitemaps: no hace falta reenviar nada aparte (el
      índice ya apunta a la nueva URL automáticamente en el próximo rastreo).

## 7. Vencimiento (Fase 5) — 410 para vacantes purgadas

Repetir tras cualquier cambio en `wasJobPurged()`/`buildJobUrlPrefix()`
(`src/db/indexing-repository.ts`/`src/lib/job-seo.ts`), el bloque
`if (!id || !job)` de la ruta `/empleos/` en `src/server.ts`, o
`scripts/migrate-indexing-queue.ts`.

- [ ] `npm run test:seo` en verde — cubre el caso end-to-end (fila
      `URL_DELETED` de prueba → 410) sin necesidad de esperar a que una
      vacante real venza.
- [ ] Confirmar que `idx_indexing_queue_url_prefix` existe: correr
      `npx tsx scripts/migrate-indexing-queue.ts` una vez (idempotente,
      aditivo, seguro de re-correr).
- [ ] Un `/empleos/<uuid-al-azar-nunca-visto>/x` sigue respondiendo 404
      (no 410) — regresión: sin este check, un bug podría marcar cualquier
      id inexistente como "vencido".
- [ ] Una vacante real (`/empleos/:id/:slug` de una vacante activa) sigue
      respondiendo 200 sin cambios.
- [ ] El HTML del 410 trae `<meta name="robots" content="noindex">` y
      **ningún** bloque `application/ld+json` — un 410 nunca debe llevar
      JobPosting.
- [ ] En Search Console, para una URL que ya se sabe purgada (o simulando
      con Inspección de URLs): confirmar que Google eventualmente la marca
      como removida en el reporte de cobertura — esto tarda días, no es
      instantáneo, solo verificar que no quede "atascada" como indexada
      semanas después.

## 8. Extensión Venezuela (Fase 6) — ver `docs/SEO-PLAN.md` §5.7

Repetir tras cualquier cambio en `resolveCategorySlug`/`buildCategoryPath`/
`buildCategoryMeta`/`buildCategoriesSitemapXml` (`src/lib/job-seo.ts`), la
rama `/ve/empleos/` en `src/server.ts`, o `countries/index.ts`'s
`COUNTRIES.VE.cities`.

- [ ] `curl https://buscotrabajo.co/ve` y `.../ve/dashboard` responden 200
      y ambas aparecen en `https://buscotrabajo.co/sitemap.xml`
      (`sitemap-pages.xml`, no un sub-sitemap nuevo).
- [ ] `curl .../empleos/caracas` (o cualquier ciudad de
      `COUNTRIES.VE.cities`) responde 200, **sin** prefijo `/ve` en la URL,
      y el conteo de vacantes en el `<meta name="description">` coincide
      con `curl .../api/jobs?cities=Caracas&country=VE`.
- [ ] `curl .../empleos/<un-rol-real>` (Colombia) y
      `.../ve/empleos/<el-mismo-rol>` (Venezuela) responden 200 en dos URLs
      DISTINTAS, con conteos distintos, y cada `<h1>` dice el país correcto
      (nunca "en Colombia" en la página que en realidad lista Venezuela, o
      viceversa).
- [ ] `curl .../ve/empleos/<uuid-al-azar>` responde 404 real — las páginas
      de vacante individual nunca llevan el prefijo `/ve` (ver
      `buildJobPath` en `job-seo.ts`, sin cambios por esta fase).
- [ ] `https://buscotrabajo.co/sitemap-categories.xml` lista tanto ciudades
      venezolanas (sin prefijo) como roles venezolanos (con `/ve`) junto a
      sus equivalentes de Colombia — 79 URLs en total al momento de
      escribir esto.
- [ ] En Search Console, después de que pase suficiente tiempo de rastreo:
      revisar si `/ve` aparece indexada por separado de `/` o si Google la
      está consolidando como duplicada (riesgo conocido, ver
      `docs/SEO-PLAN.md` §5.7 — contenido informativo casi idéntico entre
      ambas landing pages).

## Nota de seguridad sobre este checklist y los tests automatizados

Este proyecto **no tiene una base de datos de test separada** — el mismo
`DATABASE_URL` de `.env` es el mismo que usa producción (ver
`docs/BACKLOG.md` / el comentario de `clearRepository()` en
`job-repository.ts`). Por eso:

- `npm run test:seo` es **de solo lectura**: nunca llama a `saveJobs()` ni
  `clearRepository()`, solo lee vacantes que ya existen para probar contra
  ellas. Es seguro correrlo en cualquier momento.
- Otros tests de este proyecto (`test:paywall`, `test:payment-flow`) **sí**
  usan `clearRepository()` y **borran vacantes reales** — requieren
  `ALLOW_TEST_DB_WIPE=true` a propósito para que nadie los corra sin
  querer. No correr esos como parte de la verificación de SEO.
