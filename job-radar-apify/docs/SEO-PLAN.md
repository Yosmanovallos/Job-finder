# Plan de SEO / indexación en Google — BuscoTrabajo.co

Estado: **Fases 0-4 implementadas** (ver sección 5). Este documento
es la referencia para ejecutar el resto del trabajo en fases (una por
sesión, cada una verificable antes de seguir con la siguiente), no un
commit de una sola vez.

## 0. Proceso de QA (aplica a todas las fases, no solo a la 1)

Regla general para todo lo de este plan, no solo para lo ya construido:
cada fase que toque código entrega **dos capas de verificación**, siguiendo
el mismo patrón que ya usa el proyecto en `docs/QA-CHECKLIST-AUTH.md`:

1. **Automatizada** (`tests/validate-*.ts`, `npm run test:*`): todo lo que
   se pueda verificar sin un navegador real ni ojos humanos — funciones
   puras (generación de slugs, forma del structured data, escapes de
   seguridad) y HTTP real contra un servidor levantado por el propio test.
2. **Checklist manual** (`docs/QA-CHECKLIST-*.md`): todo lo que sí necesita
   un navegador real, una herramienta externa de Google (Rich Results
   Test, Search Console), o revisión visual.

**Regla de seguridad no negociable, la razón de que esto importe aquí en
particular:** este proyecto no tiene una base de datos de test separada —
el mismo `DATABASE_URL` de `.env` es el mismo de producción (ver
`clearRepository()` en `job-repository.ts`). Cualquier test nuevo de SEO
debe ser **de solo lectura** contra la tabla `jobs` (leer vacantes reales
para probar, nunca `saveJobs()`/`clearRepository()`), a menos que se pida
explícitamente lo contrario. Los tests existentes que sí escriben
(`test:paywall`, `test:payment-flow`) están bloqueados detrás de
`ALLOW_TEST_DB_WIPE=true` a propósito — nunca correrlos como parte de una
verificación de SEO.

## 1. Diagnóstico (por qué 10,000+ vacantes no aparecen en Google)

Confirmado leyendo el código actual (`src/App.tsx`, `src/index.html`,
`static/sitemap.xml`, `src/db/job-repository.ts`):

1. **Ninguna vacante tiene URL propia.** Las 10,000+ viven todas detrás de
   `/dashboard`, una sola ruta. Google no puede rankear "analista de datos
   Bogotá" apuntando a una vacante específica porque esa vacante no tiene
   dirección propia — es una fila dentro de un `fetch()` de React.
2. **No hay SSR.** `index.html` se sirve como `<div id="app"></div>` vacío;
   todo el contenido (incluidos títulos/meta por ruta vía `use-page-meta.ts`)
   solo existe después de que el navegador ejecuta JS y espera el fetch.
   Googlebot puede ejecutar JS, pero es una segunda pasada lenta y no
   garantizada, y no dispara el scroll infinito.
3. **Cero `JobPosting` structured data.** `index.html` solo tiene JSON-LD de
   `Organization` y `WebSite`. No hay señal de "esto es una oferta de
   empleo" en ningún lado — la superficie de **Google for Jobs** (el
   carrusel que aparece arriba de los resultados normales) depende
   enteramente de esto y hoy no se activa.
4. **El sitemap no tiene ni una vacante.** Solo 8 páginas estáticas
   (home, dashboard, pricing, legal...).

## 2. Cómo lo resuelven otras plataformas (arquitectura de referencia)

Indeed, LinkedIn Jobs y los agregadores serios (Jooble, Trabajo.org) usan el
mismo patrón de **3 capas**, confirmado por la investigación:

| Capa | Qué es                        | Ejemplo                            | Función SEO                                        |
| ---- | ----------------------------- | ---------------------------------- | -------------------------------------------------- |
| 1    | Página individual por vacante | `/jobs/view/analista-de-datos-...` | long-tail: "analista de datos pepsico bogotá"      |
| 2    | Página de categoría/ubicación | `/jobs/bogota`, `/jobs/remote`     | volumen alto: "trabajo en bogotá", "empleo remoto" |
| 3    | Buscador interactivo          | `/dashboard` (lo que ya existe)    | producto real, no pensado para rankear por sí solo |

Puntos clave del research que cambian decisiones de diseño:

- **URLs limpias, no query strings**: `/empleos/analista-datos-bogota-<id>`,
  no `/dashboard?role=analista&city=bogota`. Los parámetros de filtro no
  deben ser indexables (explota el crawl budget en combinaciones infinitas).
- **Google for Jobs invierte la regla de "no duplicados"**: espera que la
  misma vacante aparezca en varios agregadores y le muestra al buscador
  varias opciones de dónde aplicar. Esto favorece directamente el modelo de
  este proyecto (agregador multi-fuente) — **siempre que** cada página tenga
  el structured data correcto y enlace de verdad a la fuente original.
- **Contenido delgado ("thin content") es el riesgo real**, no la
  duplicación en sí. Con miles de páginas casi idénticas (solo
  título/empresa/ubicación/fecha, sin descripción — este proyecto nunca
  inventa datos que no tiene, por diseño) Google puede empezar a tratarlas
  como _doorway pages_ de baja calidad. La mitigación estándar es enriquecer
  cada página con contenido real y variable que sí tenemos sin inventar
  nada: cuántas otras vacantes tiene esa empresa activas, vacantes similares
  en la misma ciudad/rol, badges de fuente/frescura, breadcrumbs. Nunca texto
  de relleno.
- **ISR (regeneración incremental)** es el patrón de rendimiento estándar en
  2026 para boards de miles de vacantes: cada página se renderiza en el
  servidor, se cachea, y se regenera cuando el dato cambia — no se
  re-renderiza en cada visita ni se pre-genera todo en build time (10,000+
  archivos estáticos sería inmanejable y quedaría desactualizado).

## 3. Cómo se indexan 10,000 páginas sin ir una por una

Esta es la parte que probablemente no es obvia: **nadie manda 10,000 URLs a
mano.** Los mecanismos son:

### a) Sitemap (descubrimiento masivo)

Un único archivo XML lista todas las URLs; Google lo lee una vez y descubre
todo. Límite real: **50,000 URLs / 50MB por archivo** — con 10,000 vacantes
todavía cabe en uno solo, pero se diseña de una vez como **sitemap index**
(un archivo que apunta a varios sub-sitemaps) para no tener que rehacer la
arquitectura cuando crezca:

```
sitemap.xml              (índice)
├── sitemap-static.xml   (páginas fijas — ya existe)
├── sitemap-jobs-1.xml   (hasta 50k vacantes)
└── sitemap-categorias.xml
```

### b) Google Indexing API — el mecanismo que sí aplica aquí

Dato importante confirmado en la documentación oficial de Google (y
reforzado por el enforcement que empezaron a aplicar en 2025): **la
Indexing API de Google está restringida oficialmente a solo dos tipos de
contenido: páginas con `JobPosting` y streams con `BroadcastEvent`.** Este
proyecto es exactamente uno de los dos casos de uso legítimos que existen.
En la práctica: cada vez que se publica o se da de baja una vacante, se
notifica a Google vía API (`URL_UPDATED` / `URL_DELETED`) y entra en una
cola de rastreo prioritaria — hablamos de horas, no de esperar el rastreo
orgánico normal. Esto es automatizable por completo desde el pipeline de
scraping que ya existe.

**Corrección tras investigar el código real (Fase 3):** la suposición
original de que la baja de una vacante pasaba por `is_active = false` era
incorrecta. `is_active` solo lo toca `scripts/migrate-dedupe.ts` (un
script manual de limpieza de duplicados, no el flujo normal de ingestión).
El mecanismo real de expiración es un **`DELETE` duro** —
`purgeOldJobs()` en `scheduler-repository.ts`, invocado en cada tick de
`scripts/run-scrape-tick.ts` (cron de GitHub Actions cada 15 min) — borra
toda fila con `created_at` de hace más de 30 días. Los dos hooks reales
de la Fase 3 son: `saveJobs()` (encola `URL_UPDATED` al insertar una
vacante nueva) y `purgeOldJobs()` (encola `URL_DELETED` con la URL de
cada fila justo antes de borrarla, vía `DELETE ... RETURNING` — la única
forma de no perder esos datos, porque una vez borrada la fila no hay
forma de reconstruir su URL).

- Cuota por defecto ~200 solicitudes/día por proyecto de Google Cloud
  (ampliable pidiéndolo, hay un formulario de solicitud de aumento). Con
  ~10,170 vacantes existentes, el backfill inicial a 200/día tarda **~51
  días** en cubrirlas todas — esto es una cola que se drena sola en el
  tiempo, no algo que haya que forzar. El volumen diario real después
  (vacantes nuevas + expiradas) es mucho menor y esa parte sí se mantiene
  al día porque se encola en tiempo real.
- Requiere: proyecto en Google Cloud, cuenta de servicio, y verificar la
  propiedad `buscotrabajo.co` como _owner_ en Search Console (para dar
  permiso a esa cuenta de servicio).

### c) Lo que NO aplica

**IndexNow no lo soporta Google** (solo Bing/Yandex/Naver/Seznam/Yep,
confirmado a 2026) — sirve para indexación rápida en Bing, no en Google.
No vale la pena implementarlo para el objetivo específico que se busca aquí
(aunque es trivial añadirlo después si se quiere tráfico de Bing gratis).

### d) Search Console (el paso manual que sí hace falta, una sola vez)

Verificar la propiedad del dominio y enviar el sitemap ahí. Si nunca se hizo,
es muy probable que Google ni siquiera esté rastreando el sitio de forma
regular — esto se puede confirmar en 5 minutos mirando el reporte de
cobertura ("Coverage") antes de construir nada más.

### e) Vencimiento — la parte que protege el resto del sitio

Google explícitamente penaliza (reduce visibilidad de _todo_ el sitio, no
solo la vacante vieja) a boards con muchas vacantes vencidas todavía
indexadas. Con 3 opciones válidas: `validThrough` en el pasado, eliminar la
página (404/410 — 410 es preferible, señala "no vuelve"), o quitar el
`JobPosting` de la página. Esto debe conectarse al `DELETE` duro de
`purgeOldJobs()` (ver corrección en la sección 3b) — hoy `/empleos/:id`
de una vacante purgada ya cae en el 404 genérico porque simplemente no se
encuentra en `getJobsCached()`; la Fase 5 es diferenciarlo de un id que
nunca existió y devolver 410 en ese caso específico.

## 4. Arquitectura propuesta (mapeada a lo que ya existe en el repo)

Todo esto es **aditivo**: nada de lo que ya funciona (`/dashboard`, `/api/jobs`,
el split-pane, los filtros) se toca. Rutas y queries nuevas, aisladas.

### 4.1 Esquema de URL

```
/empleos/<slug-titulo>-<slug-ciudad>-<id-corto>
ej: /empleos/analista-de-datos-bogota-8f3a1c
```

Requiere una columna `slug` en `jobs` (migración simple, `ALTER TABLE ... ADD
COLUMN IF NOT EXISTS`, mismo estilo que ya usa `schema.sql`). Se genera una
vez al ingestar la vacante, no en cada visita.

### 4.2 Renderizado — SSR ligero, no una reescritura a Next.js

No hace falta migrar el framework. `server.ts` ya sirve `/api/*` y el HTML
estático; se le agrega una ruta `/empleos/:slug` que:

1. Hace **una** consulta a Postgres por `id` (ya indexado, PK) — el mismo
   costo que ya paga `/api/jobs/:id`.
2. Aplica el mismo `maskLockedFields` que ya usa la API — si el paywall
   se reactiva algún día (`PAYWALL_ENABLED = true` en `config.ts`), la
   página de SEO automáticamente deja de mostrar campos que no debería, sin
   tocar este código de nuevo. Cero riesgo de cloaking.
3. Inyecta `<title>`, meta description, canonical y el JSON-LD `JobPosting`
   directamente en el HTML (no vía `useEffect` como hace hoy
   `use-page-meta.ts` — eso solo sirve para páginas que un humano ve
   después de que carga JS, no para lo que necesita leer un crawler).
4. Sirve el mismo bundle de React debajo — un visitante real que llega desde
   Google ve la vacante instantáneamente (contenido ya en el HTML) y la app
   se hidrata igual para el resto de la interacción (guardar, aplicar, etc.)

### 4.3 Cache (para no afectar rendimiento)

Las vacantes no cambian a cada segundo. Cache en memoria (LRU simple, sin
necesidad de Redis a este volumen) con TTL corto, invalidado cuando el
pipeline de ingesta actualiza esa fila. Evita pegarle a Postgres en cada
visita de un crawler.

### 4.4 Páginas de categoría (capa 2)

`/empleos/bogota`, `/empleos/remoto`, `/empleos/analista-de-datos` — se
generan reutilizando la taxonomía que **ya existe** en
`FilterBar.tsx` (`CITY_OPTIONS`, `DEFAULT_ROLES_200`), sin tabla nueva.
Cada página lista las vacantes reales de esa categoría (misma query que
`/api/jobs`, capada a ~50-100) + enlaza a las páginas individuales. Esto es
lo que compite por volumen ("trabajo en Bogotá"), no las páginas
individuales.

### 4.5 Sitemap dinámico

Job programado (mismo patrón que el cron ya existente vía `ENABLE_CRON`)
que regenera `sitemap-jobs-N.xml` cada pocas horas a partir de `jobs WHERE
is_active = TRUE`, y un `sitemap.xml` índice que los referencia junto al
sitemap estático actual.

### 4.6 robots.txt

Agregar `Allow: /empleos/` explícito (ya permitido por el `Allow: /`
genérico, pero se documenta) y considerar bloquear parámetros de filtro
del dashboard (`?search=`, `?modality=`, etc.) para no gastar crawl budget
en combinaciones infinitas de la misma data que ya vive en `/empleos/`.

## 5. Fases sugeridas (una por sesión, cada una con criterio de salida)

| Fase  | Qué entrega                                                                                                       | Cómo se verifica                                                                                   | Estado                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **0** | Auditoría: robots.txt/sitemap sanos, sin `noindex`, confirmar qué tiene Google indexado hoy                       | Ver sección 5.1                                                                                    | ✅ Hecho                                        |
| **1** | Ruta `/empleos/:id/:slug` con SSR + JSON-LD `JobPosting` + meta tags, página cliente equivalente                  | `npm run test:seo` + `docs/QA-CHECKLIST-SEO.md`                                                    | ✅ Hecho                                        |
| **2** | Sitemap dinámico (índice + jobs) + robots.txt actualizado                                                         | `curl` al sitemap, validación XML, envío manual una vez en Search Console                          | ✅ Hecho                                        |
| **3** | Integración con Google Indexing API (cuenta de servicio + hook en `saveJobs()`/`purgeOldJobs()`, ver sección 5.5) | Log de submits exitosos; una vacante nueva aparece en el reporte de cobertura en horas, no semanas | ✅ Hecho — verificado en producción (2026-07-30): 106/106 notificaciones reales enviadas en la primera corrida |
| **4** | Páginas de categoría (`/empleos/<ciudad>`, `/empleos/<rol>`)                                                      | Igual que fase 1, sobre una categoría                                                              | ✅ Hecho                                        |
| **5** | Manejo de vencimiento (410 / `validThrough`) atado al `DELETE` duro de `purgeOldJobs()`                           | Vacante purgada devuelve 410 en vez de 404 genérico; JSON-LD deja de emitirse                      | ✅ Hecho                                        |
| **6** | Extensión a Venezuela: sitemap con `/ve`, páginas de categoría por país (ver sección 5.7)                        | `npm run test:seo` (79 URLs en `sitemap-categories.xml`) + verificación manual con datos reales     | ✅ Hecho                                        |

### 5.1 Resultado de la Fase 0 (corregido — ver nota abajo)

- `https://buscotrabajo.co/robots.txt` — correcto, sin bloquear nada
  relevante, referencia al sitemap presente.
- `https://buscotrabajo.co/sitemap.xml` — XML válido, 10 URLs (todas
  páginas estáticas, ninguna vacante — esperado, es lo que la Fase 2 va a
  resolver).
- La home responde `HTTP 200` (vía Render + Cloudflare), sin
  `X-Robots-Tag` ni `<meta name="robots" content="noindex">` bloqueando
  nada.
- ~~`site:buscotrabajo.co` en Google no devuelve ningún resultado —
  conclusión: Google nunca ha rastreado el dominio~~ — **descartado**: el
  operador `site:` no es un indicador confiable de indexación real: la
  propiedad de dominio ya estaba verificada en Search Console desde el
  registro original (autenticada vía GoDaddy, no Cloudflare), con el
  sitemap ya enviado y `/` + `/dashboard` ya con indexación solicitada
  manualmente. Search Console ya muestra tráfico real (pequeño, pero
  real) — la propiedad no partía de cero como se pensó inicialmente.

**Lo que sigue pendiente de verdad** (esto no cambió): el sitemap enviado
solo tiene páginas estáticas — cero vacantes, porque `/empleos/:id/:slug`
no existía hasta la Fase 1. Acción para la próxima vez que se entre a
Search Console (ya verificado, sin pasos de DNS/Cloudflare pendientes):

1. **Indexación → Páginas**: revisar cuántas páginas están indexadas hoy
   y por qué motivo las demás quedaron excluidas — este reporte es la
   fuente de verdad real, no `site:`.
2. Una vez la Fase 2 genere `sitemap-jobs-N.xml`: Sitemaps → enviarlo ahí
   mismo (la propiedad ya está verificada, no hace falta repetir eso).
3. Opcional para arrancar más rápido: Inspección de URLs → pegar una
   URL de `/empleos/...` real → "Solicitar indexación" en un puñado de
   vacantes de prueba, en vez de esperar el rastreo orgánico del sitemap.

### 5.2 Resultado de la Fase 1

Implementado sin migración de esquema (el `:slug` de la URL es
cosmético, el matching es por `jobId`):

- `src/lib/job-seo.ts` — funciones puras compartidas entre servidor y
  cliente (`slugify`, `buildJobPosting`, `buildJobMeta`,
  `escapeHtml`/`escapeJsonForScriptTag` para texto scrapeado/adversarial).
- `src/server.ts` — ruta `GET /empleos/:id/:slug`: reusa
  `getJobsCached()` + `maskLockedFields()` (cero queries nuevas a
  Postgres), **reemplaza** (no agrega) los 7 tags de `<head>` que ya trae
  `index.html`, inyecta el JSON-LD, 404 real para ids inexistentes,
  `noindex` sin JobPosting para vacantes bloqueadas.
- `src/sections/JobLanding.tsx` + ruta en `App.tsx` — lo que ve un
  visitante real después de que carga JS (reusa `JobDetailPanel`,
  `PaywallCard`, `ApplyGateModal` ya existentes).
- `tests/validate-seo-job-pages.ts` (`npm run test:seo`) — funciones puras
  - HTTP real contra un servidor de prueba, **de solo lectura** contra la
    BD real (ver sección 0).
- `docs/QA-CHECKLIST-SEO.md` — checklist manual (Rich Results Test,
  revisión visual, casos que el automatizado no cubre).

**Verificado en esta sesión** contra vacantes reales de la BD: título
único, canonical único apuntando a la URL de la vacante (no a la home),
JSON-LD válido con los campos que Google exige, título con tildes/paréntesis
sin romperse, id inexistente devuelve 404 real, cero regresión en
`/`, `/dashboard`, `/api/jobs`, `/api/health` y en el `sticky` del panel de
detalle.

**Limitación conocida, no resuelta — decirlo explícitamente en vez de que
un "todo en verde" se confunda con "ya debería rankear":** el campo
`description` del JobPosting es la misma frase con `{title}`/`{company}`/
`{source}` intercambiados en las ~10,000 vacantes, porque no hay
descripciones reales en el esquema (nunca se inventan). Esto va a validar
sin errores en Rich Results Test y aun así es exactamente el patrón de
"listados finos y duplicados" que la investigación de la sección 2
identifica como el que menos rankea. La mitigación real (no solo pasar la
validación) es ampliar la variedad con datos reales que ya existen —
modalidad, otras fuentes donde aparece, rol de origen — que ya se usó
parcialmente en `buildJobDescription()`. El arreglo durable de fondo sería
capturar descripción real donde una fuente la dé legítimamente, que hoy no
se hace en ningún adaptador de este proyecto.

**Nota para la Fase 2**, dejada aquí para que no se pierda: `getJobs()`
(el query que alimenta `getJobsCached()`, el mismo que usa la ruta
`/empleos/:id`) hace `DISTINCT ON (title, company, location)` — un
sitemap generado directamente contra `SELECT id FROM jobs WHERE is_active
= TRUE` va a incluir ids que `/empleos/:id` nunca resuelve (fueron
descartados por el `DISTINCT ON`), lo cual es exactamente un generador de
soft-404s a escala. El sitemap de la Fase 2 debe construirse contra el
mismo `getJobs()`/`getJobsCached()`, no contra la tabla cruda.

Recomendación para la siguiente sesión: **Fase 2** (sitemap dinámico),
ya que la Fase 0 quedó bloqueada en un paso manual (verificación de
dominio) que solo el usuario puede hacer, y en paralelo no hay razón para
esperar antes de construir el sitemap.

### 5.3 Evidencia real, post-implementación: `/dashboard` se indexa vacío

Revisando Search Console con el usuario (2026-07-29) — sin este paso
habría quedado sin detectar:

- `https://buscotrabajo.co/` y `https://buscotrabajo.co/dashboard` **sí
  están indexadas** (contradice la primera lectura de la Fase 0 basada en
  `site:` — la propiedad ya existía de antes, verificada vía GoDaddy,
  con sitemap ya enviado e indexación de ambas URLs ya solicitada
  manualmente en su momento).
- Pero el HTML que Google capturó y tiene indexado para `/dashboard`
  (pestaña "Índice de Google" → "Ver página rastreada") termina en:
  `<strong>0</strong> de 0 vacantes` / `No se encontraron vacantes con
los filtros seleccionados`. **Google indexó el dashboard con cero
  vacantes reales.**
- Descartado que sea cold-start de Render (el proyecto corre en el plan
  Starter de $7, siempre activo) — confirmado en vivo: HTML de
  `/dashboard` responde en ~0.34s, pero `/api/jobs` tarda ~1.3s. Sumado a
  la descarga/ejecución del bundle de JS (el robot de Google rastrea
  como smartphone, con CPU limitada), el tiempo total hasta que aparecen
  las vacantes reales probablemente supera lo que Google espera antes de
  tomar la foto de la página.
- Esto es evidencia directa (no ya solo teórica) de exactamente el
  problema de fondo de la sección 1 ("no hay SSR, el contenido depende
  de un fetch en el navegador") — aplicado esta vez al propio
  `/dashboard`, no solo a las vacantes individuales. Las páginas
  `/empleos/:id/:slug` de la Fase 1 no tienen este riesgo: sus datos van
  ya en el HTML que entrega el servidor, sin depender de que ningún
  fetch termine a tiempo.

**Resuelto (2026-07-29)**: se aplicó a `/dashboard` el mismo patrón de
"datos ya en el HTML" que usan las páginas de vacante. La ruta
`GET /dashboard` en `server.ts` ahora reusa `getJobsCached()` +
`maskLockedFields()` + `applyJobFilters()` (sin filtros — la misma
primera página que devolvería `/api/jobs` sin query params) e inyecta un
`<nav><ul>` con links reales a `/empleos/:id/:slug` dentro de
`<div id="app">`, en vez de dejarlo vacío. Beneficio doble: Google ya no
indexa un dashboard vacío, y de paso crea enlazado interno real hacia las
páginas individuales (el patrón de 3 capas de la sección 2 — hub → item
— en vez de depender solo del sitemap para que se descubran).

Como `index.tsx` monta con `ReactDOM.createRoot(...).render(...)` (no
`hydrateRoot`), React reemplaza ese contenido por completo en cuanto el
bundle ejecuta — no hay advertencias de mismatch de hidratación porque
nunca intenta reconciliar, solo lo descarta. Verificado con Playwright:
cero errores de consola, cero cambio visual para un usuario real, y el
`sticky` del panel de detalle sigue funcionando igual tras el scroll.
`npm run test:seo` ahora también falla explícitamente si esto se
rompe (busca links `/empleos/` reales y la ausencia del texto "No se
encontraron vacantes" en el HTML crudo de `/dashboard`).

### 5.4 Optimización: el cliente ya no re-pide lo que el servidor le dio

El HTML de `/dashboard` también embebe `window.__SSR_JOBS__` (los mismos
`jobs`/`total`/`hasMore` de arriba, como JSON). `Dashboard.tsx` lo lee en
su primer render y, si aplica, se salta por completo el `fetch()` a
`/api/jobs` — un visitante anónimo con filtros sin tocar ya no hace ese
round-trip.

Con guardas deliberadas para no romper nada del paywall si se reactiva
algún día: `verifySession()` lee el header `Authorization`, que una
navegación de página normal nunca envía — así que el `tier` resuelto en
el servidor para este HTML es siempre "free", sin importar quién esté
visitando realmente. Por eso el cliente solo confía en
`window.__SSR_JOBS__` cuando **no** hay `accessToken` todavía y los
filtros son exactamente los de por defecto; en cualquier otro caso (usuario
con sesión, o que llegó con `?search=`/`?modality=` desde la landing) hace
el fetch real de siempre. El dato se borra (`delete
window.__SSR_JOBS__`) apenas se usa una vez, para que ni un cambio de
filtro ni la resolución tardía de la sesión de Supabase lo reutilicen por
error.

Medido: el HTML de `/dashboard` pasa de 1.2 KB a 3.3 KB comprimido (gzip)
— +2 KB, contra los 152 KB comprimidos que ya pesa el bundle de JS que
carga de todas formas. No escala con el tamaño de la tabla `jobs`: siempre
son las mismas 24 vacantes de la primera página, nunca las 10,000+.
Verificado con Playwright: 0 llamadas a `/api/jobs` en una carga anónima
con filtros por defecto, 1+ llamada si se llega con un filtro en la URL,
y el flujo normal de scroll/cambio de filtro sigue disparando fetches
como antes. `npm run test:seo` verifica que `window.__SSR_JOBS__` esté
presente y sea JSON válido con vacantes reales.

### 5.5 Resultado de la Fase 4

Implementado sin ruta nueva ni prefijo (`/empleos/ciudad/...`,
`/empleos/rol/...`): se reutilizó exactamente el esquema plano de §4.1
(`/empleos/<slug>`), el mismo que ya usaba `/empleos/:id/:slug?` de la
Fase 1. La colisión aparente (un slug de ciudad/rol cabe en el mismo hueco
que un `:id`) se resuelve con `isUuid()` — un `jobId` siempre es un
`gen_random_uuid()` (§3b), un slug de categoría nunca tiene esa forma, así
que ambos lados (servidor y cliente) despachan por esa única señal, sin
necesidad de una ruta separada ni de tocar la Fase 1 en absoluto.

**Corrección sobre el nombre `DEFAULT_ROLES_200`**: pese al nombre, hoy
tiene **32 roles reales**, no 200 (aspiracional/histórico — ver
[[product-vision-scaling]] en memoria: "soportar 200+ roles" sigue siendo
una meta de escala, no algo ya alcanzado). Total real de páginas de
categoría hoy: **41** (9 ciudades de `CITY_OPTIONS` + 32 roles de
`DEFAULT_ROLES_200`), verificado sin overlaps de slug entre ambas listas.

Construido:

- `src/lib/job-filters.ts` — `CITY_OPTIONS` se movió aquí desde
  `FilterBar.tsx` (que ahora lo importa) para que `server.ts`, que corre en
  Node puro, no arrastre imports de React/Radix.
- `src/lib/job-seo.ts` — `isUuid`, `resolveCategorySlug` (busca el slug
  contra `CITY_OPTIONS ∪ DEFAULT_ROLES_200`, `null` si no matchea ninguna →
  404 real, nunca una doorway page), `buildCategoryPath`/`buildCategoryUrl`,
  `buildCategoryMeta` (título/descripción/canonical con el **conteo real**
  de vacantes, nunca inventado — una categoría vacía dice literalmente "0
  vacantes"), `buildCategoriesSitemapXml`.
- `src/server.ts` — dentro del bloque `/empleos/` ya existente: si el
  primer segmento no es UUID, rama nueva que reutiliza
  `getJobsCached()` + `maskLockedFields()` + `applyJobFilters()` (los
  mismos filtros `cities`/`roles` que ya usa `/api/jobs`, cero lógica de
  matching nueva) y aplica el mismo patrón "datos ya en el HTML" que
  `/dashboard` (Fase 1, §5.3) — hasta 60 vacantes reales embebidas como
  `<nav><ul>` con links a `/empleos/:id/:slug`, no a la URL externa. Rutas
  nuevas `GET /sitemap-categories.xml` y el índice `/sitemap.xml` ahora
  lista 3 sub-sitemaps en vez de 2.
- `src/sections/EmpleosRoute.tsx` (nuevo, despachador) — la ruta de React
  Router sigue siendo la misma `/empleos/:id/:slug?` de la Fase 1; este
  componente decide con `isUuid()` si monta `JobLanding` (sin cambios) o
  `CategoryLanding` (nuevo).
- `src/sections/CategoryLanding.tsx` + `src/components/CategoryJobRow.tsx`
  (nuevos) — vista de cliente tras hidratar. Reusa el endpoint
  `/api/jobs?cities=`/`?roles=` que ya existía (cero API nueva).
  `CategoryJobRow` es un componente chico nuevo en vez de forzar
  `JobCard`/`JobListItem`: `JobCard` enlaza directo a la URL externa
  (correcto en el dashboard, no aquí) y `JobListItem` es un botón atado al
  estado de selección del split-pane, ninguno de los dos es un link interno
  reutilizable tal cual.
- `tests/validate-seo-job-pages.ts` (`npm run test:seo`) — extendido con
  funciones puras (`isUuid`, `resolveCategorySlug`, `buildCategoryMeta`,
  incluido el caso de conteo 0) y HTTP real (ciudad real, rol real, slug
  inventado → 404, `sitemap-categories.xml`, índice con 3 entradas).
- `docs/QA-CHECKLIST-SEO.md` — nueva sección 6.

**Verificado en esta sesión**, `npm run build` y `npm run test:seo` en
verde (60 checks), más manualmente contra la base real:
`/empleos/bogota` → 5713 vacantes, `/empleos/desarrollador-node-js` → 24,
título/canonical/meta-description correctos y con conteo real en ambos,
60 links reales a `/empleos/<uuid>/...` en el HTML crudo, slug inventado →
404 real, `/sitemap-categories.xml` → 41 URLs, `/sitemap.xml` → 3 entradas.
Caso de categoría vacía confirmado con datos reales: "Data Engineer" tiene
0 matches hoy — la página responde 200 con "No hay vacantes en esta
categoría por ahora" y `noindex`, en vez de indexarse vacía. Cero regresión
en `/dashboard`, `/`, `/api/jobs`, ni en una página de vacante individual
real (mismo comportamiento que antes de esta fase).

### 5.6 Resultado de la Fase 5

Sin tabla ni columna nueva: `purgeOldJobs()` (`src/db/scheduler-repository.ts`)
ya encolaba una fila `URL_DELETED` en `indexing_queue` con la URL completa
de cada vacante justo antes de perder la fila (Fase 3, §3b) — esa tabla ya
era, sin usarse para esto, el tombstone que hacía falta para distinguir
"este id existió y venció" de "este id nunca existió".

Construido:

- `src/lib/job-seo.ts` — `buildJobUrlPrefix(jobId)`, el prefijo fijo
  (`.../empleos/<jobId>/`) que sobrevive aunque el slug (derivado del
  título) se pierda con la fila.
- `src/db/indexing-repository.ts` — `wasJobPurged(jobId)`, `SELECT 1 ...
  WHERE notification_type = 'URL_DELETED' AND url LIKE $1` (match de
  prefijo, no de substring, para poder usar índice).
- `scripts/migrate-indexing-queue.ts` — nuevo `idx_indexing_queue_url_prefix`
  (`text_pattern_ops`, el operator class que Postgres necesita para que un
  `LIKE 'prefijo%'` use el índice en vez de escanear la tabla completa, hoy
  con 15,290+ filas y creciendo). Re-corrido en esta sesión sin tocar datos
  existentes.
- `src/server.ts` — dentro del mismo bloque `if (!id || !job)` que ya
  existía: si `wasJobPurged(id)` es `true`, 410 con copy distinto
  ("Esta vacante ya no está disponible... venció") + `noindex`, en vez del
  404 genérico. Sin JSON-LD en ningún caso — el 410 por sí solo ya es la
  señal de "no indexar esto". La vacante real encontrada y el 404 genérico
  para ids nunca vistos no cambiaron.
- `tests/validate-seo-job-pages.ts` (`npm run test:seo`) — función pura
  (`buildJobUrlPrefix`), y HTTP real: inserta su propia fila `URL_DELETED`
  de prueba (limpiada en `finally`, nunca toca `jobs`) y confirma 410 +
  noindex + ausencia de JSON-LD; confirma explícitamente que un UUID nunca
  encolado sigue dando 404 (regresión, para que un bug futuro no marque
  todo como "vencido").
- `docs/QA-CHECKLIST-SEO.md` — nueva sección 7.

**Verificado en esta sesión**: `npm run build` y `npm run test:seo` en
verde (64 checks). Manualmente contra un servidor local: insertada una fila
`URL_DELETED` real para un jobId de prueba → `/empleos/<ese-id>/x` responde
**410** con el copy de vencimiento, `noindex`, sin JSON-LD; un UUID nunca
visto sigue en **404**; una vacante real y una página de categoría
(`/empleos/bogota`) siguen en **200** sin cambios — cero regresión.

Con esto, **las 6 fases del plan original de SEO están completas** (Fases
0-5). Ver §5.7 para la extensión de Venezuela (Fase 6, añadida después) y
§8 para qué sigue.

### 5.7 Resultado de la Fase 6 (extensión Venezuela)

Contexto: la expansión a Venezuela (`backlog/venezuela-expansion.md`, país
como dimensión de datos — ver AGENTS.md) construyó `/ve`, `/ve/dashboard`,
`/ve/empresas` sin tocar nada de este documento. Auditado a pedido del
usuario ("¿ya configuraste el SEO... que quede todo bien indexado sabiendo
que son dos distintas?") y se encontraron 4 gaps reales — dos ya resueltos
en esta sesión (sitemap + páginas de categoría), dos quedan como riesgo
conocido, no bloqueante:

**Ya funcionaba sin tocar nada** (porque las páginas de vacante son
agnósticas de país por diseño desde la Fase 1):

- `sitemap-jobs.xml` — ya incluía las vacantes de Venezuela automáticamente
  (`buildJobsSitemapXml()` nunca filtró por país).
- Google Indexing API — `saveJobs()` encola `URL_UPDATED` para cualquier
  vacante nueva sin distinguir país; verificado en producción encolando
  correctamente las 196 vacantes VE que entraron en la corrida manual del
  2026-08-02.
- `robots.txt` — `Allow: /` genérico ya cubre `/ve` sin bloquear nada.
- Vencimiento (410) — `wasJobPurged()` no distingue país, aplica igual.

**Gaps encontrados y resueltos en esta sesión:**

1. **`/ve` y `/ve/dashboard` no estaban en el sitemap estático.**
   Arreglado: agregadas a `static/sitemap.xml` con las mismas prioridades
   que sus equivalentes de Colombia. `/empresas`/`/ve/empresas` se dejan
   fuera a propósito, igual que `/empresas` de Colombia ya lo estaba (no es
   una página de descubrimiento SEO, es navegación desde el dashboard).
2. **Cero páginas de categoría (`/empleos/<ciudad>`, `/empleos/<rol>`) para
   Venezuela.** `CITY_OPTIONS`/la taxonomía de `resolveCategorySlug()` solo
   tenía ciudades colombianas, y las páginas de rol no filtraban por país en
   absoluto (mezclaban CO+VE bajo una URL cuyo propio `<h1>` decía
   "en Colombia" — un mismatch real, no solo un gap). Arreglado:
   - **Ciudades**: `resolveCategorySlug()` ahora también matchea las
     ciudades de `countries/index.ts`'s `COUNTRIES.VE.cities` (Caracas,
     Maracaibo, Valencia...) — sin prefijo `/ve`, porque el nombre de la
     ciudad ya es inequívoco (`/empleos/caracas` nunca podría ser Colombia).
     Devuelve `{ kind: "ciudad", label, country }` con el país inherente a
     la ciudad que matcheó, no al prefijo de la URL.
   - **Roles**: como un rol ("Project Manager") no dice nada sobre el país,
     SÍ se dividió en dos URLs distintas — `/empleos/<rol>` sigue siendo
     Colombia (ahora con `country: "CO"` explícito en el filtro, cerrando
     el mismatch de arriba) y la nueva `/ve/empleos/<rol>` es Venezuela
     (`country: "VE"`). `resolveCategorySlug(slug, requestCountry)` recibe
     el país pedido según el prefijo de la ruta.
   - `buildCategoryMeta()` ahora arma el `<h1>`/título con el país real
     (`en Venezuela` vs `en Colombia`) y no reclama fuentes sin adaptador
     VE (Elempleo/Magneto/Workana) en la descripción — mismo criterio que
     `SourcesAndProblem.tsx`'s `SOURCES_BY_COUNTRY`.
   - `server.ts`: la rama `/empleos/` ahora también matchea
     `/ve/empleos/`, con un guard explícito — un UUID bajo `/ve/empleos/`
     es 404 real, nunca resuelve como vacante (las páginas de vacante
     individual siguen siendo 100% agnósticas de país, sin excepción, para
     no romper la Fase 3/5 de Indexing API).
   - `sitemap-categories.xml` pasó de 41 URLs a **79** (9 ciudades CO + 6
     ciudades VE + 32 roles CO + 32 roles VE).
   - `tests/validate-seo-job-pages.ts` extendido con casos explícitos para
     ambos países (ciudad VE sin prefijo, rol VE con prefijo, UUID bajo
     `/ve/empleos/` → 404, conteo del sitemap de categorías).

**Verificado en esta sesión** contra datos reales de producción:
`/empleos/caracas` → 91 vacantes; `/empleos/project-manager` (Colombia) →
335; `/ve/empleos/project-manager` (Venezuela, misma etiqueta, país y URL
distintos) → 106 — tres números reales y distintos, nunca mezclados bajo
una sola URL. `npm run build`, `npm run test:seo` (79 checks),
`test:dashboard-filters` y `test:companies-search` en verde.

**Riesgos conocidos, no resueltos en esta sesión — dejados explícitos para
no confundir "en verde" con "sin pendientes":**

1. **Contenido casi duplicado entre `/` y `/ve`**: ambas comparten
   `ComparisonAndProcess`/`ProductFeaturesPricingFaq` sin cambios (solo
   `HeroDemo`/`SourcesAndProblem` varían por país) — cada una tiene su
   propio canonical (`use-page-meta.ts` usa el pathname real), pero Google
   puede igual tratarlas como duplicadas por contenido pese al canonical
   declarado. No hay `hreflang` tampoco (no aplica aquí en el sentido
   estricto — no es el mismo contenido en dos idiomas, es contenido
   parecido para dos audiencias regionales distintas — pero el riesgo de
   consolidación de Google es real de todas formas). Mitigación futura si
   esto se confirma en Search Console: diferenciar más el contenido
   informativo compartido, no solo el hero.
2. **`/` y `/ve` no tienen SSR** (a diferencia de `/dashboard`,
   `/empleos/:id` y las páginas de categoría) — mismo límite documentado en
   §5.3 para `/dashboard` antes de que se le agregara SSR, aplicado aquí a
   la landing. No es una regresión nueva de esta sesión (la home nunca tuvo
   SSR), pero ahora también cubre `/ve`. Si Google captura la página antes
   de que el bundle de React cargue el contenido dinámico, puede indexarla
   con menos señal de la real.

## 6. Riesgos y cómo se mitigan

- **Thin content / doorway pages**: mitigado con contenido real variable
  (vacantes similares, conteo por empresa) — nunca texto inventado.
- **Cloaking por el paywall**: mitigado reusando `maskLockedFields` — el
  crawler nunca ve algo distinto de un usuario anónimo real.
- **Sitemap generando soft-404s**: mitigado construyendo `sitemap-jobs.xml`
  contra el mismo `getJobsCached()` deduplicado que usa `/empleos/:id`
  (nunca contra la tabla `jobs` cruda) — verificado con `npm run test:seo`,
  que toma una URL real del sitemap y confirma que resuelve 200.
- **Rendimiento**: todo aditivo salvo `/dashboard` (fase 1, sección 5.3),
  que sí se tocó a propósito — medido antes/después (sección 5.4), el
  costo real es de ~2 KB comprimidos y cero queries nuevas, no escala con
  el tamaño de la tabla `jobs`. `/api/jobs` en sí nunca se tocó.
- **Vacantes vencidas indexadas** (penaliza todo el sitio): resuelto en
  fase 5, conectado al `DELETE` duro de `purgeOldJobs()` (no a `is_active`
  — ver corrección en la sección 3b).
- **Cuota de Indexing API agotada por un pico de scraping**: mitigado —
  el presupuesto diario se calcula contra `indexing_queue` (filas `sent`
  en las últimas 24h reales), no un contador en memoria que un cron de
  15 min reiniciaría en cada corrida; ver `indexing-repository.ts`.

## 7. Detalle de implementación de la Fase 3 (Google Indexing API)

Sección histórica — la Fase 3 ya está terminada y verificada en producción
(§5, tabla de fases). Se deja el detalle completo porque documenta el setup
real de Google Cloud/Search Console que no hay que repetir.

### 7.1 Qué se construyó

- `src/lib/google-indexing.ts` — cliente hecho a mano (JWT RS256 firmado
  con `crypto` de Node + intercambio OAuth), sin dependencia nueva
  (`googleapis`/`google-auth-library`), mismo estilo sin framework que el
  resto del repo.
- `src/db/indexing-repository.ts` + tabla `indexing_queue` (migración:
  `scripts/migrate-indexing-queue.ts`) — cola persistente; el presupuesto
  diario se calcula contra filas `sent` reales de las últimas 24h, no un
  contador en memoria.
- Hooks: `saveJobs()` encola `URL_UPDATED` para cada vacante nueva
  (batched, una sola query extra por tick, no por vacante);
  `purgeOldJobs()` encola `URL_DELETED` con `DELETE ... RETURNING` antes
  de perder la fila.
- `scripts/run-indexing-tick.ts` — drena la cola respetando el
  presupuesto diario; pensado para un workflow de GitHub Actions aparte
  (`indexing-tick.yml`), no metido dentro del tick de scraping existente.
- `scripts/backfill-indexing-queue.ts` — encola `URL_UPDATED` una sola
  vez para las ~10,170 vacantes que ya existían antes de este sistema
  (los hooks de arriba solo cubren lo que pasa de ahora en adelante).

### 7.2 Lo que falta y depende del usuario

1. Crear proyecto en Google Cloud (o reusar uno existente) → habilitar
   "Web Search Indexing API".
2. IAM → crear cuenta de servicio → generar clave JSON.
3. Search Console → propiedad `buscotrabajo.co` (ya verificada, sección
   5.1) → Configuración → Usuarios y permisos → agregar el email de la
   cuenta de servicio con permiso **Propietario** (no "Completo" — con
   "Completo" el publish falla con 403 silencioso).
4. Agregar a `.env` (nunca pegar los valores en el chat, por lo mismo que
   pasó con la contraseña de Google en esta sesión):
   - `GOOGLE_INDEXING_CLIENT_EMAIL`
   - `GOOGLE_INDEXING_PRIVATE_KEY` (con `\n` literales, no saltos de
     línea reales — así es como un valor multilínea sobrevive en `.env`)
5. Mismos dos secrets en GitHub Actions (Settings → Secrets) para que
   `indexing-tick.yml` pueda correr.
6. Correr `npx tsx scripts/migrate-indexing-queue.ts` una vez (aditivo,
   no toca `jobs`).

### 7.3 Lo que se pudo verificar sin credenciales reales, y lo que no

Verificado (`npm run test:seo`, sin red): la firma del JWT es
estructuralmente correcta — generado un keypair RSA descartable,
firmado, y verificado con `crypto.createVerify` que el header/claims
(`iss`, `scope`, `aud`, `exp`) tienen la forma que Google espera.

**Actualización 2026-07-30 — verificado de punta a punta con credenciales
reales.** El usuario completó el setup de GCP (cuenta de servicio
`indexing-bot@job-finder-503421.iam.gserviceaccount.com`, permiso
Propietario en Search Console, secrets en GitHub Actions). La primera
corrida manual (`gh workflow run indexing-tick.yml`) falló con
`error:1E08010C:DECODER routines::unsupported` — el circuit-breaker de 5
fallos consecutivos cortó la corrida antes de gastar las 53 solicitudes
pendientes (funcionó como estaba pensado: es exactamente el escenario de
"cuenta mal configurada" que ese breaker existe para atajar). Diagnosticado
con un script temporal (`scripts/diag-indexing-key.ts`, ya borrado) que
solo reporta hechos estructurales de la clave (longitud, presencia de
marcadores PEM, etc.) sin loguear nunca el contenido — la clave privada
en el secret de GitHub tenía las comillas del JSON del service account
pegadas junto con el valor (`"private_key": "-----BEGIN..."` copiado
completo, comillas incluidas). Arreglado en `google-indexing.ts`
(`readCredentials()` ahora quita un par de comillas envolventes antes de
desescapar) — no fue necesario que el usuario tocara el secret de nuevo.
Segunda corrida: **106/106 notificaciones reales enviadas exitosamente**
(`Sent: 106, Failed: 0`).

### 7.4 Cuota — expectativa realista

200 solicitudes/día por defecto. El backfill de las ~10,170 vacantes
existentes tarda **~51 días** en drenarse a ese ritmo — es una cola que
se vacía sola, no algo urgente de forzar. Después del backfill, el
volumen diario real (vacantes nuevas + expiradas) es mucho menor y se
mantiene al día en tiempo real.

**Un detalle que puede hacer que el backfill parezca estancado:** una
vacante que sigue viva el día 31 se purga (`URL_DELETED`) y en el
siguiente tick de scraping se vuelve a insertar como fila nueva —
`gen_random_uuid()` nuevo, URL nueva, `URL_UPDATED` — porque
`purgeOldJobs()` no sabe que "es la misma vacante", solo ve una fila
vieja. Es la misma oferta real, pero cuesta 2 unidades de cuota (una
`URL_DELETED` + una `URL_UPDATED`) en vez de 0. Con suficiente volumen de
vacantes de larga duración, este churn puede terminar dominando el
presupuesto diario de 200 — si el backfill parece no avanzar, revisar
cuánto de la cuota diaria se está yendo en este flip-flop antes de asumir
que algo está roto. Es también el argumento más fuerte para pedir un
aumento de cuota temprano en vez de esperar a necesitarlo.

## 8. Próximo paso

Las 7 fases (0-6, la 6 siendo la extensión de Venezuela, §5.7) están
completas y verificadas en producción — no queda ningún ítem de código
pendiente de este documento.

Lo que sigue de aquí en adelante es monitoreo, no construcción:

1. **Search Console**: confirmar que `sitemap-categories.xml` (ahora 79
   URLs, CO+VE) se lee correctamente, y seguir revisando
   "Indexación → Páginas" hasta que empiecen a aparecer vacantes y
   categorías indexadas de AMBOS países (no solo `/` y `/dashboard`) —
   cuestión de tiempo de rastreo en un dominio nuevo/rutas nuevas, no de
   código. Prestar atención particular a si `/ve` empieza a aparecer o si
   Google la consolida con `/` por el riesgo de contenido casi duplicado
   ya anotado en §5.7.
2. **Descripciones reales por vacante**: limitación conocida desde la Fase 1
   (§5.2) — el `description` del JSON-LD sigue siendo plantilla, ningún
   adaptador captura descripción real de la fuente hoy. Evaluado y
   deliberadamente no perseguido por ahora: requeriría una petición HTTP
   extra por vacante encontrada en cada una de las 13 fuentes, lo que sube
   el riesgo de bloqueo justo donde ya hay fricción (Indeed/Glassdoor).
   Si se retoma, es su propia investigación fuente por fuente, no un ajuste
   rápido.
3. **Contenido casi duplicado `/` vs `/ve`** (§5.7, riesgo 1): si Search
   Console muestra que Google está consolidando ambas bajo una sola URL
   canónica, la mitigación es diferenciar más el contenido informativo
   compartido (`ComparisonAndProcess`/`ProductFeaturesPricingFaq`), no solo
   el hero — su propio diagnóstico, no un ajuste de una sesión.

Cualquier trabajo nuevo de SEO a partir de aquí (backlinks, contenido
adicional, más fuentes, un tercer país) es exploratorio y necesitaría su
propio diagnóstico — no hay una "Fase 7" ya definida en este documento.
