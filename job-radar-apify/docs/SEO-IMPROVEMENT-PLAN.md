# Plan de mejora SEO con claude-seo — BuscoTrabajo.co

Estado: **plan activo, fases 0-1 hechas**. Este documento es la
continuación operativa de `docs/SEO-PLAN.md` (que queda como el registro
histórico del diagnóstico y de lo ya arreglado — secciones §9 y §10) una
vez instalado el plugin [claude-seo](https://github.com/AgriciDaniel/claude-seo)
(25 skills, 18 agentes, `/seo <comando>`, scope `local`, no comprometido
al repo).

## 0. Cómo usar este documento (léelo primero, siempre)

**Regla no negociable:** antes de tocar cualquier cosa relacionada con
SEO en este proyecto (rutas de `server.ts`, `job-seo.ts`, sitemap,
schema, robots.txt, hreflang, contenido de vacantes, etc.), leer este
archivo completo. Después de terminar un cambio, actualizar la tabla de
fases (sección 3) con el resultado — mismo patrón que ya usa
`docs/SEO-PLAN.md`.

**Regla de seguridad, la razón de que "no dañar nada" sea posible de
verificar y no solo una intención:** correr `/seo drift compare` (sección 2) contra las URLs de baseline **antes y después** de cualquier cambio
que toque una página pública. Si `/seo drift compare` marca algo
`CRITICAL` que el cambio no explica intencionalmente, parar y revisar
antes de seguir — no asumir que "los tests pasan" es suficiente, `test:seo`
verifica forma/regresión funcional, no señales de SEO que Google
realmente lee (título, canonical, hreflang, schema, CWV).

**Los no-negociables de siempre siguen aplicando, sin excepción:**

1. **Nunca inventar datos** (AGENTS.md #5) — ni un salario, ni una
   descripción, ni un volumen de búsqueda de keywords. Si claude-seo o
   cualquier fuente externa no da un dato real y verificable, se omite o
   se pide al usuario — nunca se rellena con una estimación disfrazada de
   hecho.
2. **Solo lectura por defecto.** `test:seo` es de solo lectura contra la
   BD real (no hay BD de test separada, ver `docs/SEO-PLAN.md` §0). Los
   scripts del plugin (`content_quality.py`, `sitemap_discovery.py`, etc.)
   son de solo lectura salvo que se pida explícitamente lo contrario
   (`indexnow_submit.py`, `indexing_notify.py` escriben hacia afuera —
   confirmar antes de correrlos).
3. **Migraciones de esquema, siempre aditivas** (`ALTER TABLE ... ADD
COLUMN IF NOT EXISTS`, mismo estilo que
   `scripts/migrate-last-seen-at.ts`/`scripts/migrate-indexing-queue.ts`)
   y corridas explícitamente, nunca automáticas.
4. **Una fase por sesión**, verificable antes de seguir con la siguiente
   — no encadenar varias fases de la tabla de la sección 3 en una sola
   sesión solo porque el presupuesto de contexto alcance.
5. **Verificación propia antes de decir "listo"**: `npx tsc --noEmit`,
   `npm run build`, `npm run test:seo` (+ `test:dashboard-filters` /
   `test:companies-search` si se tocó `server.ts`), y `/seo drift
compare` contra el baseline — nunca delegar esa verificación al
   usuario como si fuera un gate pendiente.
6. **`/seo setup` para dependencias, nunca un `pip install` manual** — el
   plugin usa su propio venv aislado (`~/.claude/skills/seo/.venv/` o el
   equivalente de plugin data), igual que el resto de este proyecto nunca
   instala nada global sin necesidad.

## 1. Qué ya está hecho (no repetir)

Ver `docs/SEO-PLAN.md` §9 (diagnóstico completo, 2026-08-04) y §10 (fixes
aplicados, mismo día): bug de churn de URL (`last_seen_at`, migrado en
producción), hreflang + canonical real entre `/` y `/ve`, descripción del
JobPosting enriquecida y medida con `content_quality.py` (69→83
`overall_quality`). Los tres verificados con `tsc`, `build`, `test:seo`,
`test:dashboard-filters`, `test:companies-search` en verde.

**Bloqueante real que ningún paso de este plan reemplaza:** el desglose
de Search Console → Indexación → Páginas (motivos de exclusión + conteos
reales). Solo el usuario puede sacarlo (UI, sin equivalente en la API).
Decide si la Fase 3 (crawl budget / autoridad) o la Fase 4 (calidad de
contenido) importa más a partir de aquí — no bloquea empezar ninguna de
las dos, pero sí decide en cuál invertir más tiempo primero.

### 1.1 Batch ad hoc — H1 faltante + canonical/título de `/dashboard` (2026-08-04)

Encontrado revisando el código fuente a partir de lo que el baseline de la
Fase 2 mostró (`h1: null` en 4 de las 6 URLs de muestra, `/dashboard` con
el `title`/`canonical` de la home). Implementado, no una fase numerada de
la tabla — surgió directo de la evidencia del baseline, mismo criterio de
"nunca inventar, siempre evidenciar primero":

- **`/empleos/:id/:slug` (~22k páginas, el patrón de mayor volumen del
  sitio):** el HTML crudo nunca tuvo contenido visible en `<div id="app">`
  — solo `<head>` + JSON-LD. Un crawler que lee HTML sin ejecutar JS veía
  una página titulada pero vacía, sin `<h1>`. Se agregó un `<h1>{título}</h1>`
  + un `<p>` con el mismo `buildJobDescription()` que ya alimenta el
  JobPosting JSON-LD (nunca un texto distinto o inventado).
- **`/dashboard` y `/ve/dashboard`:** `/ve/dashboard` no tenía ninguna rama
  SSR (cae al fallback estático) — su `<title>`/canonical crudos eran los
  de Colombia. `/dashboard` sí tenía rama SSR pero solo para el listado, no
  para `<head>` — su `<title>`/canonical crudos eran los de la home ("/").
  Se agregó reescritura de `<head>` (title/description/canonical/og/twitter)
  con los mismos datos reales que `Dashboard.tsx`'s `usePageMeta()` ya
  calculaba client-side, más `<h1>Vacantes de Empleo en {país}</h1>`, más el
  trío hreflang recíproco (`es-CO`/`es-VE`/`x-default`) que ya llevan `/` y
  `/ve` — necesario porque, al darle a `/ve/dashboard` su propio canonical
  por primera vez (antes canonicalizaba a `/`, así que nunca competía),
  ahora sí es un near-duplicate real de `/dashboard` sin nada que los
  declare regionales entre sí (mismo riesgo que §5.7 riesgo 1).
  **Client-side:** `Dashboard.tsx` embebía `window.__SSR_JOBS__` con datos
  reales de Venezuela para `/ve/dashboard`, pero el gate que lo consume
  seguía hardcodeado a `country === "CO"` (así estaba desde que
  `/ve/dashboard` no tenía SSR) — el payload real se generaba y se
  descartaba sin usarse, el cliente seguía haciendo el fetch redundante.
  Primer intento (`country === "CO" || country === "VE"`) fue corregido de
  nuevo tras una segunda revisión: el pathname que sirvió el HTML no
  garantiza el `country` con el que `Dashboard` termina montado (un
  visitante con preferencia VE puede entrar por `/dashboard` puro — App.tsx
  lo rebota a `/ve/dashboard` client-side, sin segundo round-trip HTTP — y
  montar ahí con el payload de Colombia todavía en `window`), así que el
  payload ahora se auto-describe: `server.ts` estampa `country` junto a
  `jobs`/`total`/`hasMore`, y el gate compara `ssrJobs.country === country`
  en vez de asumir nada por ruta. De paso, `og:locale` en esta rama pasó de
  heredar siempre `es_CO` del shell estático a reflejar el país real (mismo
  patrón que `/` y `/ve` ya tenían). Contenido crudo verificado con datos
  reales de producción: `/ve/dashboard` trae 24 links reales a vacantes
  venezolanas (Apure, Zulia, Nueva Esparta, Caracas), `country: "VE"` y
  `total: 4280` en el payload, `/dashboard` con `country: "CO"` y `total:
  21302` — capturado también en pantalla sin regresión visual.
- **`/` y `/ve`:** sin `<h1>` en el HTML crudo (límite ya documentado en
  `SEO-PLAN.md` §5.7 riesgo 2). No se intentó el SSR completo de la landing
  que ese riesgo señala como pendiente — solo se agregó el mismo `<h1>` real
  que `HeroDemo.tsx` ya renderiza client-side, verbatim.
- **Cliente:** `JobDetailPanel.tsx` renderizaba el título de la vacante como
  `<h2>` incluso en `/empleos/:id` (su único uso como página dedicada) — se
  agregó un prop `headingLevel` (`"h1"` solo desde `JobLanding.tsx`, sigue
  `"h2"` en el panel lateral del dashboard). `Dashboard.tsx` no tenía ningún
  `<h1>` en el DOM ni antes ni después de hidratar — se agregó uno
  `sr-only` con el mismo texto que la rama SSR.

### 1.2 Batch ad hoc — JobPosting inválido para vacantes 100% remotas (2026-08-04)

Encontrado durante Fase 6 (`seo-schema`) contra una vacante real
(`analista-de-observabilidad-y-operaciones-ti-remoto`): cuando
`job.location` es literalmente `"Remoto"` (sin ciudad), `buildJobPosting()`
emitía `jobLocation.address.addressLocality: "Remoto"` — no es una
localidad real, invalida el `PostalAddress` según la guía de Google para
JobPosting remoto. Arreglado en `job-seo.ts`: `isBareRemoteLocation()`
detecta el caso (`location` es exactamente "Remoto"/"Remote", no
"Remoto - Bogotá" ni similar, esos casos SÍ tienen ciudad real y no
cambian) y emite `jobLocationType: "TELECOMMUTE"` +
`applicantLocationRequirements` (país real vía `getCountryConfig`) en vez
de `jobLocation`. Verificado contra una vacante real de producción
(`5021d6f6-...`, servida localmente contra el mismo `DATABASE_URL`).
Confirmado por consulta directa a la tabla `jobs`: 2475 filas con
`location='remoto'` + 20 con `'remote'` (afectadas, corregidas), 0 filas
`'híbrido'`/`'hibrido'` bare (mismo bug potencial, no existe en los datos
reales — no requiere el mismo fix). Casos agregados a
`tests/validate-seo-job-pages.ts` (bare-remote → TELECOMMUTE,
`"Remoto - Bogotá"` → jobLocation normal sin cambios).

**Verificado (los tres batches, 1.1, 1.2 y 1.3):** `tsc --noEmit`, `build`,
`test:seo` (incluye los 2 casos nuevos de TELECOMMUTE + los 7 de
`/ve/dashboard`), `test:dashboard-filters`, `test:companies-search` en
verde + captura de pantalla de `/dashboard`, `/ve/dashboard`, `/empleos/:id`
y `/` sin regresión visual (el `sr-only` es invisible, el cambio `h2`→`h1`
no cambia estilos).

**No desplegado, ninguno de los tres batches:** producción corre en Render
desde este repo de GitHub — el cambio existe solo local hasta que el
usuario decida hacer commit/push. `/seo drift compare` contra el baseline
de la Fase 2 (que es contra `buscotrabajo.co`, producción) no aplica
todavía por la misma razón; se verificó equivalentemente contra un servidor
local en `:3000` con `curl` + capturas. **Una sesión futura no debe asumir
que esto ya está verificado en vivo** — re-confirmar `git log`/`git status`
antes de dar cualquiera de los tres batches por aplicado en producción.

### 1.3 Batch ad hoc — hreflang para páginas de rol CO↔VE (2026-08-04)

Encontrado en la misma revisión: `/empleos/<rol>` y `/ve/empleos/<rol>`
(32 roles × 2 = 64 URLs en `sitemap-categories.xml`) eran el mismo caso de
canonical-sin-pareja ya arreglado dos veces arriba, pero preexistente desde
Fase 6 (no introducido por este batch). Arreglado con el mismo trío
recíproco (`es-CO`/`es-VE`/`x-default`), **gateado a `category.kind ===
"rol"`** — las páginas de ciudad (`/empleos/bogota`, `/empleos/caracas`,
etc.) no tienen URL hermana (`buildCategoryPath`: una ciudad nunca lleva
prefijo `/ve`), así que emitirles hreflang habría sido un set unidireccional
— exactamente lo que `seo-hreflang` marca como Critical. Verificado con
`curl` local: `/empleos/project-manager` ↔ `/ve/empleos/project-manager`
recíproco correcto; `/empleos/bogota` sigue con cero tags `hreflang`.

Tests agregados a `tests/validate-seo-job-pages.ts` para `/ve/dashboard`
(7 casos: 200, links reales, canonical propio, título propio, hreflang
recíproco, `og:locale`, `window.__SSR_JOBS__.country === "VE"` — este
último específicamente para blindar contra que el payload de Colombia se
sirva por error en la ruta de Venezuela, el riesgo real que tuvo la
primera versión del fix de `/dashboard` antes de estamparle `country`).

**Diffs esperados en `/seo drift compare` una vez desplegado** (para no
confundirlos con una regresión real):
- `/` y `/ve`: `h1` aparece (antes null).
- `/dashboard`: `title` cambia de "BuscoTrabajo — Vacantes de Empleo en
  Colombia, Todas en un Solo Lugar" a "Vacantes de Empleo en Colombia |
  BuscoTrabajo"; `canonical` cambia de `https://buscotrabajo.co/` a
  `https://buscotrabajo.co/dashboard`; `h1` aparece; hreflang aparece.
- `/empleos/:id/:slug` (no hay baseline individual, pero aplica a las
  ~22k páginas del patrón): `h1` aparece; `html_hash` cambia (contenido
  real agregado a `<div id="app">`); JobPosting de vacantes 100% remotas
  gana `jobLocationType`/`applicantLocationRequirements` y pierde
  `jobLocation` — solo para las ~2500 vacantes con `location` bare-remote.
- No hay baseline capturado para `/ve/dashboard`, `/empleos/project-manager`
  ni `/ve/empleos/project-manager` (no estaban en la muestra de la Fase 2)
  — considerar agregarlos en una futura sesión de baseline si se quiere
  drift-tracking sobre ellos también.

### 1.4 Deploy confirmado + drift compare post-deploy (2026-08-04)

Commit `e487090` desplegado a Render (push a `main`), confirmado vivo con
`curl` contra producción (`/dashboard` y `/ve/dashboard` sirven su propio
title/canonical/h1). `/seo drift compare` corrido contra las 6 URLs de
baseline de la Fase 2: **cero hallazgos CRITICAL sin explicar** — el único
CRITICAL (`canonical_changed` en `/dashboard`) es exactamente el cambio
intencional documentado en §1.1. Los demás triggered findings son o bien
los cambios esperados (`content_hash_changed` INFO en las 4 páginas con H1
nuevo, `title_changed`/`meta_description_changed` WARNING en `/dashboard`)
o cambios reales de datos ajenos a esta sesión (`/ve/empleos/project-manager`
pasó de 189 a 190 vacantes — el corpus se sigue actualizando en vivo).

### 1.5 Investigación: "llevo 2 semanas sin indexar, favicon no aparece"

El usuario reportó (2026-08-04) que Search Console → Indexación → Páginas
lleva ~2 semanas atascado en "procesando datos" y que el favicon nunca
apareció en resultados de Google. Investigación de solo lectura, sin tocar
código:

**Hipótesis inicial descartada con evidencia real:** el bug de churn de
URL (§9.2 de `SEO-PLAN.md`, arreglado hoy en `7139378`) parecía el
candidato obvio, pero una consulta directa a la tabla `jobs` en producción
lo descarta como causa del síntoma actual: `created_at` más antiguo en la
base es `2026-07-25`, ningún job supera los 30 días, y la consulta
`created_at < 30 días AND last_seen_at >= 30 días` (los jobs que el bug
viejo habría borrado-y-recreado hoy) devuelve **0 filas**. El primer commit
de `server.ts` es del `2026-07-20`. El bug era real y el fix era necesario
— la primera purga bajo el ciclo de 30 días cae ~2026-08-24 — pero no
explica nada de lo que ya pasó, porque nunca llegó a dispararse.

**Lo que sí confirma el patrón real:**
- El sitio tiene entre 10 y 15 días de vida en producción real (no
  semanas/meses) — coincide casi exactamente con "llevo 2 semanas" del
  usuario: esas 2 semanas SON la vida entera del sitio, no un periodo de
  sitio roto.
- Search Console → Rendimiento (captura del usuario, últimos 3 meses):
  solo 4 páginas generaron alguna impresión — `/`, `/dashboard`,
  `/legal/cookies`, `/preguntas` — las 4 son páginas estáticas de
  `sitemap-pages.xml` (12 URLs). **Cero impresiones de las 21,969 URLs de
  vacantes/categorías** de `sitemap-jobs.xml`/`sitemap-categories.xml`.
- `site:buscotrabajo.co` (vía WebSearch) no devuelve ni una sola URL real
  del dominio — ni siquiera la home — consistente con indexación
  prácticamente nula todavía, no con un bug puntual.
- El favicon es técnicamente correcto: `/favicon.png` 64×64 PNG RGBA
  válido, declarado con `<link rel="icon">`, no bloqueado por
  `robots.txt`. `/favicon.ico` da 404, pero eso no es la causa — Google
  usa el `<link>` declarado cuando existe. No se tocó nada aquí porque no
  hay nada roto que arreglar: Google solo empieza a mostrar favicon
  personalizado cuando ya estableció indexación estable de un dominio, y
  eso todavía no pasó.
- El estado "procesando datos" del reporte de Páginas es consistente con
  una propiedad de ~10 días con ~8 días de datos reales (el gráfico de
  Rendimiento del usuario arranca el 26/7) — no hay suficiente volumen
  todavía para que el pipeline de clasificación de Google cierre el
  reporte, es el comportamiento esperado a esta antigüedad, no una señal
  de que algo esté roto.

**Confirmado con 3 capturas adicionales del usuario (mismo día):**
- **Acciones manuales: "No se ha detectado ningún problema"** — descarta
  la única alternativa que habría invalidado todo el diagnóstico de abajo.
- **Enlaces externos: Total 0** — cero backlinks reales todavía, confirma
  independientemente la parte de "dominio sin autoridad" de la teoría.
- **Ajustes → Acerca de: propiedad verificada el 27 de julio de 2026** —
  confirma, desde el propio registro de Search Console (no solo inferido
  de `created_at`/git), que el sitio tiene ~9 días en Search Console.
- **Estadísticas de rastreo: 5.77 mil solicitudes en 90 días** (en la
  práctica, en ~9 días reales — la propiedad no tiene más historia) — Google
  SÍ está rastreando activamente y fuerte (~640 rastreos/día), lo cual
  matiza la teoría: no es que Google esté ignorando el sitio por falta de
  presupuesto de rastreo, sino que rastrea mucho y aun así decide no
  indexar casi nada todavía — más consistente con cautela de dominio nuevo
  sin autoridad + el riesgo de contenido casi-duplicado a escala (§9.3) que
  con un problema de descubrimiento.

**Conclusión (con la máxima certeza posible sin el desglose exacto de
Indexación → Páginas, que sigue bloqueado por §9.4):** el patrón completo
es el de una ronda de indexación normal para un dominio nuevo con ~22k
páginas y cero backlinks — el peor caso posible de velocidad de indexación,
pero no un caso de "algo está roto", y ya se descartó explícitamente que
sea una penalización. Google rastrea activamente pero posterga la decisión
de indexar el set caro (22k páginas programáticas) hasta ganar más
confianza en el dominio; eso toma semanas a meses documentado por Google,
no días. No se implementó ningún fix en respuesta a esto — no hay nada
identificado que arreglar en código; lo que ayuda de verdad (backlinks
reales, tiempo, o menos páginas más diferenciadas si se confirma que el
contenido casi-duplicado es un factor) es una decisión de estrategia del
usuario, no una tarea de código para esta sesión.

### 1.6 Fase 4 — Auditoría de contenido programático a escala (2026-08-04)

Muestra real de 15 páginas de vacante (URLs aleatorias del sitemap en
producción, post-deploy de 1.1-1.3). Dos mediciones independientes:

**Unicidad por palabra** (definición de `seo-programmatic`: palabras no
compartidas con el "vocabulario boilerplate" — las palabras presentes en
las 15 descripciones a la vez): **61.3% promedio** (rango 52.0%-66.7%).
Pasa cómodo el umbral WARNING (<40%) y el HARD STOP (<30%) que el skill
define para riesgo de "scaled content abuse". El vocabulario boilerplate
real detectado: `Aplica`, `Modalidad:`, `Vacante`, `agregada`, `de`,
`directamente`, `en`, `la`, `página` — 9 palabras fijas de ~30-37 por
página.

**`content_quality.py` (QRG-aligned) sobre las mismas 15 páginas: 82/100
promedio** (rango 74-90), cero `filler_score`/`ai_pattern_score` en todas.
Consistente con — y mejor que — el 69→83 medido en una sola página tras el
enriquecimiento de Fase 9 de `SEO-PLAN.md` (esa muestra ahora también se
beneficia del `<h1>`+`<p>` agregado hoy en 1.1, que antes no existía en el
HTML crudo que este script lee).

**El hallazgo real no es unicidad, es longitud absoluta:** el contenido
visible total en `<div id="app">` (HTML crudo, antes de hidratar) es de
**37 palabras en promedio** (rango 29-45) — muy por debajo del umbral de
aviso del skill (`<300 palabras → flag for review`). No es un bug: es un
límite de datos real y ya documentado — `JobDetailPanel.tsx` deja explícito
que esta app nunca scrapea la descripción completa de la vacante (solo
título/empresa/ubicación/fuente/conteo), porque inventar una violaría la
regla #5 de AGENTS.md. No hay más texto real que agregar sin scrapear más
de cada fuente.

**Esto es exactamente la decisión que la Fase 4 del plan viejo (`SEO-PLAN.md`
§9.6) dejó pendiente, ahora con números reales para decidirla:** conseguir
descripciones completas reales requeriría trabajo de scraping nuevo por
fuente (Elempleo, LinkedIn, Computrabajo, etc. — cada uno con su propio
ToS/estructura, un proyecto de adaptador nuevo, no un fix de esta sesión) o
aceptar el modelo actual de agregador (título + hechos reales + JSON-LD,
sin prosa larga) como lo que es — un compromiso deliberado, no un defecto
accidental. No se implementó nada en código en respuesta a esto: es una
decisión de producto/roadmap del usuario, no una corrección técnica.

### 1.7 Fase 5 — Auditoría técnica completa, 9 categorías (2026-08-04)

Verificado en vivo contra producción, categoría por categoría del checklist
de `seo-technical`. **Cero hallazgos CRITICAL.**

- **Crawlability**: `robots.txt` válido (confirmado también por la propia
  Search Console del usuario: "Todos los archivos son válidos");
  `sitemap.xml` es un `sitemapindex` válido, 3 sub-sitemaps, los 3
  "Correcto" en Search Console. Profundidad de rastreo: home → dashboard →
  vacante = 2 clics, dentro del límite de 3.
- **Indexability**: canonical self-referencing confirmado en las 6 URLs de
  baseline + roles + `/dashboard`/`/ve/dashboard` (fixes de esta sesión);
  `<meta name="robots">` ausente (indexable) en `/`, `/dashboard`,
  `/empleos/bogota` y una vacante real — presente únicamente donde debe
  (categoría vacía, vacante bloqueada, 404, 410), verificado con
  `test:seo`.
- **Seguridad**: HTTPS forzado end-to-end — `http://` → `https://` en 1
  salto, `www.` → apex en 1 salto, cero contenido mixto en la home. **Ya
  anotado en sesión anterior y sigue sin implementarse a propósito**:
  headers de seguridad ausentes (HSTS, CSP, X-Frame-Options,
  X-Content-Type-Options, Referrer-Policy) — no es factor de ranking
  confirmado y una CSP mal puesta puede romper GTM/fuentes; queda como
  hallazgo para que el usuario decida, no una corrección de esta fase.
- **Estructura de URL**: limpias, con guiones, sin query params para
  contenido primario, muy por debajo de 100 caracteres, trailing slash
  consistente.
- **Mobile**: `<meta name="viewport">` presente; sin interstitials
  intrusivos observados.
- **Core Web Vitals**: **sigue bloqueado**, mismo motivo que la sesión
  anterior (cuota compartida de PSI agotada, Unlighthouse no puede lanzar
  Chrome en este entorno WSL) — no reintentado porque es un límite de
  infraestructura persistente, no algo puntual.
- **Datos estructurados**: JobPosting/Organization/WebSite válidos, cero
  tipos deprecados, fix de TELECOMMUTE de 1.2 confirmado en vivo. **Hallazgo
  nuevo, Low/Medium, no implementado:** las páginas de categoría
  (`/empleos/<ciudad>`, `/empleos/<rol>`) no llevan ningún schema propio de
  listado (`ItemList`/`CollectionPage`/`BreadcrumbList`) — solo heredan el
  `Organization`+`WebSite` genérico del shell estático. Oportunidad real,
  cruzada con Fase 6 si se profundiza en schema.
- **Renderizado JS**: los 6 tipos de página reales ahora tienen SSR
  consistente entre HTML crudo y DOM post-hidratación (fixes 1.1-1.3) — la
  guía de Google de diciembre 2025 sobre "canonical/título deben coincidir
  entre servidor y JS" ya no tiene ningún caso conocido de discrepancia en
  este sitio.
- **Paginación**: **hallazgo Low, deliberadamente no corregido.** Las
  páginas de categoría cortan en 60 vacantes (`PAGE_LIMIT` en
  `CategoryLanding.tsx`/`server.ts`) sin `rel="next"/"prev"` ni "cargar
  más" — Bogotá con 7,901 vacantes reales solo enlaza 60 desde su propia
  página de categoría. No se corrige ahora a propósito: las 22k páginas de
  vacante ya están 100% cubiertas por `sitemap-jobs.xml` (la categoría no
  es el mecanismo de descubrimiento), y agregar más URLs indexables
  (`?page=2`, etc.) iría en contra directa del riesgo de bloat/thin-content
  a escala que 1.6 ya identificó como el problema más urgente ahora mismo
  — mismo dominio nuevo, mismo presupuesto de confianza limitado.
- **IndexNow**: no implementado — sin `indexnow.txt`/key file. Oportunidad
  menor (Bing/Yandex, no afecta a Google), no implementada esta sesión.

### 1.8 Keyword research sin credenciales — alternativa gratuita (2026-08-04)

El usuario preguntó si el "keyword research" del sitio está bien montado. No
hay credenciales de Google Ads ni DataForSEO en el entorno — sin eso, ninguna
herramienta da volumen de búsqueda real, y `AGENTS.md` #5 prohíbe inventar
ese número. En vez de simular datos, se usaron dos fuentes verificables sin
credenciales:

- **Comparación de superficie con un competidor real** (Elempleo, robots.txt
  público): ~336 páginas de ciudad indexadas en su sitemap, contra las 27
  ciudades + 32 roles × 2 países de este sitio — confirma que el hueco no es
  de volumen de páginas, sino de qué roles/sectores cubre `DEFAULT_ROLES_200`
  (ver 1.9 abajo).
- **WebSearch contra fuentes de noticias/medios reales** sobre demanda laboral
  2026 en Colombia y Venezuela (nunca un número de volumen de búsqueda,
  solo qué sectores están contratando más): para Colombia, sectores con
  demanda real no cubierta por la lista actual — logística, salud,
  administración, derecho, ingeniería industrial, psicología; para
  Venezuela, un mercado genuinamente distinto al de Colombia — comercio,
  salud, hotelería/turismo, distribución, alimentos y bebidas, servicios
  financieros (la lista actual es la misma para ambos países). También se
  confirmó que la proporción real presencial/híbrido/remoto (~71.4%/21%/7.6%)
  no coincide con el peso que el sitio le da a "Remoto" (única modalidad con
  categoría propia, sin "Híbrido").
- **No se implementó nada en código en este punto** — esta investigación
  alimenta directamente la decisión de la Fase 9-bis (swap 1:1, ver 1.9/1.10)
  en vez de sustituirla.
- La Fase 9 de la tabla (§3) sigue formalmente bloqueada — esto no es
  volumen de búsqueda real, es señal cualitativa de sector, y se documenta
  como tal, no como "Fase 9 completada".

### 1.9 Bug de falsos positivos en `jobMatchesRole()` — fix de word-boundary (2026-08-04)

Antes de ejecutar el swap 1:1 de roles (autorizado por el usuario:
*"haz el swap 1:1 de menor riesgo primero, implementa todas las phases no
pares hasta completar todo"*), se necesitaban conteos reales confiables por
rol. Al calcularlos se encontró un bug real en `jobMatchesRole()`
(`src/lib/job-filters.ts`): usaba `.includes()` (substring crudo) para
matchear las palabras expandidas de un rol contra el título de cada
vacante. Algunos sinónimos de `TRANSLATION_MAP` (`ai-role-agent.ts`) son de
1-2 caracteres (`ti`/`it` desde `software`/`sistemas`; `ia`/`ai` desde el
par recíproco `ai↔ia`) — como substring crudo, esos tokens aparecen dentro
de miles de palabras españolas sin relación alguna (`"ia"` está presente en
el 37% de los 22,760 títulos reales del corpus — "gerencia", "experiencia",
"historia"...; `"ti"` en el 30%).

Confirmado empíricamente contra el corpus real: "AI Engineer" matcheaba
9,013 vacantes (mayoría "Ejecutivo comercial", "Historiador"...) y
"Arquitecto de Software" 8,876 (mismo patrón) — números inflados por el bug,
no demanda real.

**Fix**: `jobMatchesRole()` ahora exige coincidencia en frontera de palabra
(`\bpalabra\b` vía regex, con los tokens escapados para caracteres como el
punto de "node.js") en vez de substring crudo. Es un subconjunto estricto de
`.includes()` — cualquier título que matchea con frontera de palabra también
matchea con substring, nunca al revés — así que el fix solo puede *eliminar*
falsos positivos, nunca introducir uno nuevo.

Conteos reales después del fix (antes → después):
- AI Engineer: 9,013 → 584
- Arquitecto de Software: 8,876 → 1,211
- Canarios verificados sin regresión: Auxiliar de Enfermería (530→542, plano
  dentro del margen de crecimiento del corpus), Diseñador Gráfico (235→220,
  ídem), Desarrollador Node.js (34→35, confirma que el escape del punto
  literal sigue funcionando).

Este cambio afecta `jobMatchesRole()` compartido por `/api/jobs`
(`applyJobFilters`) y las páginas de categoría por rol — no es solo un fix
de SEO, también cambia qué vacantes ve un usuario real al filtrar por rol
en el dashboard. Es el comportamiento correcto (los falsos positivos ya
existían ahí también), pero es un cambio de comportamiento visible más allá
de SEO.

Regresión cubierta con una suite nueva y dedicada, `npm run
test:role-matching` (`tests/validate-role-matching.ts`, 12 casos: los 2
falsos positivos confirmados, matches reales que deben seguir funcionando,
y los 3 canarios de frontera de palabra). Verificado en verde: `tsc
--noEmit`, `npm run build`, `test:seo`, `test:dashboard-filters`,
`test:companies-search`, `test:role-matching`.

### 1.10 Swap 1:1 de menor riesgo en `DEFAULT_ROLES_200` (2026-08-04)

Con los conteos ya confiables (1.9), se ejecutó el swap autorizado por el
usuario: mismo tamaño de lista (32 roles, para no aumentar el número de
páginas de categoría por rol — `sitemap-categories.xml` sigue en 79 URLs,
verificado con `test:seo`), reemplazando los 3 roles tech más redundantes
y de menor demanda real por 3 roles de sectores reales identificados en
1.8 y que no tenían ninguna representación en la lista.

**Fuera** (redundantes dentro del clúster de 8+ roles "Desarrollador
X"/"Ingeniero X"/"AI Engineer"/"Arquitecto de Software" ya presentes, y con
la demanda real más baja de las 32):
- Data Engineer (0 matches reales)
- Data Analyst (1 match real)
- RPA Developer (24 matches reales, nicho de automatización ya cubierto
  conceptualmente por Ingeniero DevOps/los roles de desarrollador)

**Dentro** (sectores con demanda real confirmada en 1.8 y cero
representación previa):
- Ingeniero Industrial (sector manufactura/operaciones) — 125 matches reales
- Analista de Logística (sector logística) — 62 matches reales
- Analista Jurídico (sector derecho) — 61 matches reales

**Nota de proceso**: el primer intento usó "Coordinador de Logística", que
resultó en 1,257 matches — pero la mayoría eran falsos positivos nuevos
("Real Estate Lead Manager", "Lead Product Manager", "Technical Lead
(Python)"), causados por `coordinador: ["coordinator", "lead",
"supervisor"]` en `TRANSLATION_MAP` — "lead" es frecuencia 1 dentro de la
lista de 32 roles (por tanto "distintivo" según `ROLE_WORD_FREQUENCY`) pero
extremadamente genérico en el corpus real (aparece en título tras título de
seniority ajeno a logística). Se verificó con muestras de títulos reales
(no solo el conteo) antes de aceptar el swap, se detectó el problema, y se
cambió a "Analista de Logística" (62 matches, todos genuinamente de
logística). Mismo patrón de riesgo se descartó también para "Jefe de
Logística" (`jefe: [..., "lead", ...]`, mismo problema). Esto confirma que
el fix de 1.9 (frontera de palabra) resuelve la clase de bug de substring
crudo, pero **no** resuelve por sí solo el riesgo de una palabra distintiva
dentro de la lista de 32 roles que igual es genérica en el corpus real —
cualquier rol nuevo debe verificarse con muestras de títulos reales, no
solo con el conteo, antes de aceptarse.

Se corrió un barrido adicional sobre las 69 palabras "gatillo" (distintivas
u obligatorias) de los 32 roles finales contra el corpus completo — la más
frecuente es "comercial" (12.7%, esperado y correcto: es real la categoría
más común en Colombia/Venezuela, confirmado por muestra de títulos), nada
en el resto se acerca al patrón de "ti"/"ia"/"lead" ya corregido.

**Deliberadamente no implementado en este swap** (mayor alcance, mayor
riesgo, fuera de "swap 1:1 de menor riesgo"): Venezuela sigue usando la
misma lista de 32 roles que Colombia pese a tener un mercado real distinto
(comercio, salud, hotelería/turismo, distribución, alimentos y bebidas,
servicios financieros, según 1.8) — separar la lista por país es un cambio
de arquitectura (`DEFAULT_ROLES_200` pasaría de ser una constante global a
depender del país en `scheduler.ts`, con impacto en el scraper, no solo en
SEO) que merece su propia sesión y diagnóstico, no un swap de 3 roles.
Tampoco se agregó una categoría "Híbrido" pese a que 1.8 encontró que la
modalidad real (~21%) supera a "Remoto" (~7.6%) — mismo criterio, cambio
de mayor alcance que el swap.

Verificado en verde tras el swap: `tsc --noEmit`, `npm run build`,
`test:seo` (79 URLs de categoría sin cambios), `test:dashboard-filters`,
`test:companies-search`, `test:role-matching`.

**Corrección post-swap, misma sesión (2026-08-04): 404 real detectado en
lugar de 410.** Antes de dar el swap por terminado se confirmó que quitar 3
roles de `DEFAULT_ROLES_200` significaba que `resolveCategorySlug()` ya no
reconoce `data-analyst`/`data-engineer`/`rpa-developer` — las 6 URLs
(`/empleos/<slug>` + `/ve/empleos/<slug>`) que Search Console ya había
rastreado (los 3 sub-sitemaps reportan "Correcto") empezaron a caer en la
misma rama 404 genérica que un slug inventado. La aserción de `test:seo`
sobre las 79 URLs no lo detecta porque cuenta URLs, no identidad — un swap
3-por-3 deja el conteo invariante.

Se corrigió antes de considerar la fase cerrada: `RETIRED_ROLE_SLUGS`
(`job-seo.ts`) marca explícitamente los 3 slugs retirados, y la rama de
categoría en `server.ts` responde 410 (con `noindex`, sin JSON-LD) para
esos slugs específicos en vez de 404 — mismo tratamiento que
`wasJobPurged()` ya le da a una vacante retirada: una señal real de "ya no
está" en vez de "nunca existió". `sitemap-categories.xml` ya no las lista
(se genera a partir del `DEFAULT_ROLES_200` actual), así que Google las irá
soltando de su cola de rastreo con la señal correcta, sin haber pasado por
un 404 falso primero. Cobertura nueva en `test:seo` (3 checks: 410 en
`/empleos/<retirado>`, `noindex`+sin JSON-LD, y 410 también bajo `/ve`).
Re-verificado en verde: `tsc --noEmit`, `npm run build`, `test:seo`,
`test:dashboard-filters`, `test:companies-search`, `test:role-matching`.

**Nota para el drift compare post-deploy (tarea pendiente, ver checklist de
sesión)**: `/empleos/bogota` es una de las 6 URLs de baseline y Fase 6
(§1.11) le agregó BreadcrumbList+ItemList — el próximo `/seo drift compare`
va a marcar `schema_hash` como cambiado ahí. Es el cambio esperado de
§1.11, no una regresión.

**Aún pendiente, no bloqueante**: el checklist manual de
`docs/QA-CHECKLIST-SEO.md` (Rich Results Test) no se ha corrido contra los
tipos `BreadcrumbList`/`ItemList` nuevos de §1.11 — la validación de código
(JSON válido, campos reales, verificado con `curl` directo) está hecha; la
validación del lado de Google sigue pendiente de que el usuario la corra o
la autorice.

### 1.11 Fase 6 — Schema.org: BreadcrumbList + ItemList en páginas de categoría (2026-08-04)

`§1.7` (Fase 5) ya había confirmado JobPosting/Organization/WebSite válidos
contra Rich Results y cero tipos deprecados, y había dejado anotado (sin
implementar) que las páginas de categoría (`/empleos/<ciudad>`,
`/empleos/<rol>`) no llevaban ningún schema propio de listado. Esta sesión
cierra ese hallazgo:

- **`buildCategoryBreadcrumbList()`** (`src/lib/job-seo.ts`): `BreadcrumbList`
  de 2 niveles reales (Inicio → la categoría actual) — no se inventó un nivel
  intermedio "Empleos" porque no existe una página hub en `/empleos` a la que
  apuntar; un breadcrumb con un nodo que no resuelve sería peor que no tener
  breadcrumb.
- **`buildCategoryItemList()`** (`src/lib/job-seo.ts`): `ItemList` con un
  `ListItem` por cada vacante ya renderizada en el `<nav>` visible de la
  página (mismo array `page`, nunca una consulta aparte) — título y URL
  reales, nada agregado que no esté ya en el HTML visible. No duplica el
  `JobPosting` de cada vacante individual (eso vive en su propia página); es
  el patrón seguro documentado para páginas hub que enlazan a contenido con
  su propio markup completo.
- Inyectado en `server.ts` justo después del payload `window.__SSR_CATEGORY__`,
  mismo punto donde el resto de esta rama ya arma el `<head>`.
- Página de categoría vacía (`total === 0`, ya noindexada por diseño):
  `ItemList` queda con `itemListElement: []` — refleja la realidad (0
  vacantes), no se ocultó ni se inventó contenido, y de todos modos no se
  indexa.
- Verificado con `curl` directo contra el servidor local (no solo el test):
  el JSON-LD de `/empleos/bogota` en producción-local coincide 1:1 con los
  60 links que ya se ven en el `<nav>` de la página — mismos títulos, mismas
  URLs, mismo orden.
- Cobertura nueva en `test:seo`: valida que ambos bloques existen, son JSON
  válido, el `BreadcrumbList` tiene 2 niveles y el segundo apunta a la URL
  canónica real de la categoría, y el `ItemList` tiene al menos un item con
  una URL real `/empleos/...`.
- Verificado en verde: `tsc --noEmit`, `npm run build`, `test:seo`,
  `test:dashboard-filters`, `test:companies-search`.

### 1.12 Fase 8 — GEO / AI Overviews: citability sobre una vacante y una categoría (2026-08-04)

`seo-geo` corrido contra
`/empleos/928d3923-.../analista-senior-planeacion-financiera-cali` (vacante)
y `/empleos/bogota` (categoría). Google publicó en 2026 que "optimizar para
IA generativa sigue siendo SEO" — mismos fundamentos, no una disciplina
aparte — así que la mayoría de lo evaluado aquí ya estaba cubierto o
deliberadamente diferido en fases anteriores:

- **Acceso de crawlers de IA**: `robots.txt` es `User-agent: * / Allow: /`
  sin reglas específicas — GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot,
  Google-Extended entran todos sin bloqueo. Pass, sin acción.
- **Renderizado (SSR)**: el contenido real (título, descripción, JSON-LD)
  ya está en el HTML crudo, no depende de JS — confirmado con `curl`
  directo, mismo hallazgo ya validado en §1.7 ("Renderizado JS"). Pass.
- **Datos estructurados**: JobPosting ya validado (§1.7); BreadcrumbList +
  ItemList en categorías agregado esta misma sesión (§1.11).
- **Citabilidad/estructura (pasajes de 134-167 palabras, encabezados tipo
  pregunta, listas)**: la página de vacante tiene ~37 palabras de contenido
  visible — el mismo límite absoluto de contenido que §1.6 ya identificó y
  dejó como decisión pendiente del usuario (no se resuelve inventando
  prosa). La página de categoría es una lista de 60 links reales, no
  prosa — estructuralmente correcta para lo que es (un hub), no una pieza
  citable en sí misma.
- **`llms.txt`**: ausente (404). Google confirma explícitamente que no lo
  usa como señal de ranking/citación para Search — "no ayuda ni perjudica".
  Solo sería relevante para crawlers de IA no-Google, beneficio marginal y
  sin evidencia fuerte — queda anotado como oportunidad Low, no
  implementado, mismo criterio que IndexNow en §1.7.
- **Recencia/frescura (implementado)**: el único hallazgo con una mejora
  real y de bajo riesgo — `buildJobDescription()` (`src/lib/job-seo.ts`)
  ahora agrega "Publicado el `<fecha real>`" al texto visible de cada
  vacante, usando el mismo `job.publishedAt` que ya alimentaba
  `datePosted` en el JobPosting JSON-LD (dato real ya existente, nunca
  inventado). Recencia es una señal documentada tanto para GEO (contenido
  de <3 meses ~3x más citable en respuestas de IA) como para E-E-A-T
  tradicional. No toca `buildJobMeta()` (el `<meta name="description">`
  para el snippet de SERP sigue igual) — solo el texto visible + JSON-LD
  `description`.
- **Autoría/marca**: no aplica un byline de autor (una vacante agregada no
  es contenido editorial con autor) — se deja sin acción, forzar uno sería
  inventar una atribución falsa.

Verificado con `curl` directo contra el servidor local: la vacante real
ahora muestra "Publicado el 4 de agosto de 2026" en el HTML crudo, en el
punto correcto de la oración (después de modalidad, antes del conteo de
otras vacantes de la empresa). Verificado en verde: `tsc --noEmit`,
`npm run build`, `test:seo`, `test:dashboard-filters`, `test:companies-search`.

### 1.13 Drift compare post-deploy — confirmación de las 6 URLs de baseline (2026-08-04)

Con las 4 correcciones de esta sesión ya desplegadas en producción
(swap de roles, fix de 410, schema de categoría, fecha de publicación),
se corrió `/seo drift compare` contra las 6 URLs de baseline (sección 2).
**Cero hallazgos CRITICAL nuevos** en las 6:

- `/` y `/ve`: 1 INFO cada una (hash de contenido cambiado — vacantes
  nuevas del día), sin más.
- `/dashboard`: 1 CRITICAL (`canonical_changed`, `/` → `/dashboard`) — el
  mismo ya documentado y esperado desde §1.1/§1.4, de la sesión anterior,
  no algo nuevo de hoy.
- `/empleos/bogota`: 3 WARNING (conteo de vacantes 7901→8018,
  `schema_modified`) + 1 INFO — el `schema_modified` es exactamente lo
  anticipado en §1.10/§1.11 (BreadcrumbList+ItemList nuevos).
- `/ve/empleos/project-manager`: 3 WARNING (conteo 189→177, dentro del
  ruido normal de expiración/ingesta diaria — Project Manager no fue
  tocado por el swap; `ROLE_WORD_FREQUENCY` sí se recalculó globalmente
  al cambiar la lista, lo que puede desplazar levemente qué títulos
  cuentan como "distintivos") + `schema_modified` (mismo motivo que
  Bogotá) + 1 INFO.
- Página de vacante real (`desarrollador-php-bogota-bogota`): 1 WARNING
  (`schema_modified`, esperado por la fecha de publicación agregada en
  §1.12 al campo `description` del JobPosting) + 1 INFO.

Ningún hallazgo sin explicar, ningún CRITICAL nuevo. Los 4 cambios de esta
sesión (§1.9-§1.12) quedan confirmados en vivo contra producción, no solo
en local.

### 1.14 Fase 7 — Core Web Vitals con credenciales reales (2026-08-04)

El usuario proporcionó un API key real de PageSpeed Insights/CrUX (guardado
en `~/.config/claude-seo/google-api.json`, fuera del repo — nunca en
`.env` ni commiteado) y las credenciales de service account
(`GOOGLE_INDEXING_CLIENT_EMAIL`/`GOOGLE_INDEXING_PRIVATE_KEY`, ya usadas
por `google-indexing.ts` — el usuario las agrega directamente a `.env`,
nunca escritas por el agente en ese archivo, que está en el deny-list del
proyecto).

`claude-seo run pagespeed_check.py https://buscotrabajo.co/ --json`:

- **`field_metrics` viene vacío `{}`** tanto en mobile como desktop — CrUX
  confirma (no asume) que **todavía no hay datos de campo reales** para
  este dominio. Esperado: CrUX exige un umbral mínimo de tráfico real de
  Chrome durante 28 días antes de publicar datos por origen, y el dominio
  tiene ~9-15 días (§1.5). Exit criteria de la fase ("LCP/INP/CLS con CrUX
  real") técnicamente cumplido: se confirmó con la API real que el dato de
  campo no existe aún, no es una suposición ni un bloqueo de credenciales.
- `crux_history.py` (endpoint dedicado, distinto de PSI) devolvió 403 —
  la API "Chrome UX Report API" necesita habilitarse por separado en
  Google Cloud Console además de "PageSpeed Insights API" (mismo API key,
  toggle distinto). No bloqueante: el mismo dato (campo vacío) ya se
  confirmó vía PSI. Oportunidad menor para cuando el usuario quiera
  habilitarla.
- **Datos de laboratorio (Lighthouse, no CrUX) capturados como referencia,
  no corregidos en esta sesión** — nueva superficie descubierta, fuera del
  alcance original de Fase 7 (que era solo desbloquear credenciales):
  Performance mobile 54-80/100 (varía entre corridas, ruido normal de
  Lighthouse), desktop 97/100. LCP mobile 5.3s (score 0.22, malo), TBT
  mobile 1020ms (score 0.26, malo) — oportunidad principal reportada por
  la propia herramienta: "Reduce unused JavaScript" (~1050ms de ahorro
  potencial). Accessibility 96, Best Practices 100, SEO 100 en ambos.
  **No implementado** — optimizar el bundle/JS es un cambio de mayor
  alcance (code-splitting, lazy loading) que merece su propia sesión con
  su propia verificación, no un añadido apurado a esta.

Verificado: `claude-seo run google_auth.py --check` confirma Tier 0 (API
key) activo para PSI/CrUX/CrUX History antes y después.

### 1.15 Fase 3 — causa raíz confirmada con datos reales de Search Console API (2026-08-04)

El usuario proporcionó `GOOGLE_INDEXING_CLIENT_EMAIL`/`GOOGLE_INDEXING_PRIVATE_KEY`
en `.env` (nota de proceso: el primer pegado tenía comillas tipográficas —
`"..."` en vez de `"..."` rectas, probablemente de la app desde donde se
copió, lo que hacía que `dotenv` no cargara las variables; corregido
retecleándolas con comillas rectas). El agente nunca escribió en `.env`
directamente (deny-list del proyecto) — solo verificó el formato del
private key fuera del repo, sin guardarlo en disco, antes de indicarle al
usuario qué pegar.

`scripts/check-search-console.ts` (solo lectura, ya existente):

- **`sitemaps.list`** (conteos agregados): `sitemap-pages.xml` 12
  enviadas/0 indexadas, `sitemap-categories.xml` 79/0, `sitemap.xml`
  (índice) 21969/0. El conteo agregado de "indexadas" en este endpoint
  parece rezagado/poco fiable comparado con la inspección por URL (ver
  abajo) — se reporta como dato crudo, no como conclusión.
- **`urlInspection.index.inspect`** (verdad por URL, más confiable) sobre
  9 URLs representativas — **esto SÍ confirma la causa raíz con evidencia
  directa de Google, cerrando la Fase 3**:
  - `/`, `/ve`, `/dashboard`, `/ve/dashboard`: **"Submitted and indexed"**
    (`verdict=PASS`) — las páginas top-of-funnel sí están indexadas.
  - `/empleos/caracas` (ciudad): **"Submitted and indexed"** — al menos
    una página de categoría de ciudad ya indexó.
  - `/empleos/bogota`, `/empleos/project-manager`,
    `/ve/empleos/project-manager` (rol): **"Discovered - currently not
    indexed"** (`verdict=NEUTRAL`) — Google las conoce, las tiene en cola,
    pero decide no indexarlas todavía. Esto confirma con evidencia directa
    (no inferencia) el patrón que §1.5 ya había planteado como hipótesis
    más probable: dominio nuevo, cero backlinks, presupuesto de confianza
    limitado — no un bloqueo técnico (si lo fuera, `robotsTxtState`
    reportaría `DISALLOWED` o `pageFetchState` un error; en cambio vienen
    `UNSPECIFIED` porque Google ni siquiera llegó a esa etapa del pipeline
    para una URL que decidió no indexar todavía).
  - `/empresas`: **"URL is unknown to Google"** — hallazgo nuevo, real,
    no relacionado con el patrón anterior: la página **nunca se envió**.
    Confirmado: `/empresas` es una ruta real y funcional (`CompaniesDirectory`
    en `App.tsx`, responde 200) pero nunca estuvo en `static/sitemap.xml`
    — a diferencia de `/dashboard`/`/como-funciona`/etc., que sí están.
    **Corregido**: se agregaron `/empresas` y `/ve/empresas` a
    `static/sitemap.xml` (`changefreq: daily`, `priority: 0.7`, entre el
    hub principal y las páginas de marketing estáticas).

**Hallazgo nuevo, NO corregido esta sesión (mayor alcance)**: al verificar
`/empresas` se confirmó que **ni `/empresas` ni `/empresas/:slug` tienen
ninguna rama SSR en `server.ts`** — a diferencia de home/dashboard/
categoría/vacante, sirven el shell estático genérico sin reescribir
título/meta/canonical/JSON-LD. El `<title>` crudo que ve un crawler en
`/empresas` es el mismo de la home, no algo específico de la página. Esto
no formaba parte de la muestra de "6 URLs de baseline" que las Fases 5/6/8
ya auditaron, así que no se había detectado antes. Con `/empresas/:slug`
ya existiendo con datos reales de reputación por empresa
(`docs/COMPANY-REPUTATION-PLAN.md`), esto es una oportunidad real de SEO
programático (título/meta real por empresa, posible schema
`Organization`) — pero es un alcance nuevo y considerable (nueva rama de
servidor, nuevos tests, su propia verificación), no algo para añadir de
apuro a esta sesión. Queda anotado para una fase futura dedicada.

Verificado: `npm run build`, `test:seo` en verde tras agregar las 2 URLs
al sitemap estático.

## 2. Primer paso al reiniciar sesión: baseline de `seo-drift`

Antes de cualquier fase nueva de la tabla de abajo, capturar un baseline
de las páginas que representan cada patrón real del sitio (no las 22,000
una por una — una muestra representativa, igual que hace
`scripts/check-search-console.ts` con `SAMPLE_URLS`):

```
/seo drift baseline https://buscotrabajo.co/
/seo drift baseline https://buscotrabajo.co/ve
/seo drift baseline https://buscotrabajo.co/dashboard
/seo drift baseline https://buscotrabajo.co/empleos/bogota
/seo drift baseline https://buscotrabajo.co/ve/empleos/project-manager
/seo drift baseline https://buscotrabajo.co/empleos/<un-id-real>/<slug>
```

Guardado en SQLite local (`~/.cache/claude-seo/drift/baselines.db`), no
en este repo. Después de esto, **cualquier sesión futura que toque una de
estas rutas (o su lógica compartida en `job-seo.ts`/`server.ts`) corre
`/seo drift compare` contra la(s) URL(es) afectada(s) antes de dar el
cambio por terminado.**

## 3. Fases propuestas (una por sesión)

| Fase | Qué hace                                                         | Skill/agente                                             | Exit criteria                                                                                                                                                     | Estado                                                                              |
| ---- | ---------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 0    | Diagnóstico de causa raíz (bug de churn, thin content, hreflang) | (manual, pre-plugin)                                     | Confirmado con evidencia en vivo                                                                                                                                  | ✅ Hecho — `SEO-PLAN.md` §9                                                         |
| 1    | Fixes de mayor apalancamiento ya identificados                   | (manual)                                                 | `test:seo` + `tsc` + `build` en verde                                                                                                                             | ✅ Hecho — `SEO-PLAN.md` §10                                                        |
| 2    | Baseline de drift (sección 2 de este doc)                        | `seo-drift`                                              | Baseline guardado para las 6 URLs de muestra                                                                                                                      | ✅ Hecho — 2026-08-04, baseline IDs 1-6. `/seo drift compare` corrido post-deploy de 1.1-1.3 contra las 6: único CRITICAL es `canonical_changed` en `/dashboard` (esperado, ver §1.1); todo lo demás coincide con los diffs pre-etiquetados o es cambio real de datos (conteo de vacantes) |
| 3    | Confirmar causa raíz con datos reales de Google                  | `seo-google` (`gsc query`, `inspect`, `sitemaps`)        | Requiere que el usuario traiga el desglose de Search Console, o las credenciales `GOOGLE_INDEXING_CLIENT_EMAIL`/`GOOGLE_INDEXING_PRIVATE_KEY` en el entorno local | ✅ Hecho — 2026-08-04, ver §1.15. Confirmado con la API real: `/`, `/dashboard`, city pages sí indexan; role pages en "Discovered - currently not indexed" (coincide con §1.5); `/empresas` nunca se había enviado, corregido |
| 4    | Auditoría de contenido programático a escala                     | `seo-programmatic`, `seo-content`                        | Score de unicidad real sobre una muestra de páginas de vacante; decidir si la Fase 4 del plan viejo (descripciones reales por fuente) se vuelve necesaria         | ✅ Hecho — 2026-08-04, ver §1.6. Unicidad OK (61.3%), pero contenido absoluto muy corto (~37 palabras/página) — decisión pendiente del usuario, no bloqueante |
| 5    | Auditoría técnica completa                                       | `seo-technical`, `seo-sitemap`                           | 9 categorías revisadas contra el sitio real; confirmar que nada de lo nuevo (hreflang, `last_seen_at`) introdujo una regresión técnica                            | ✅ Hecho — 2026-08-04, ver §1.7. Cero CRITICAL; 3 oportunidades Low/Medium anotadas, ninguna implementada (justificación en §1.7) |
| 6    | Schema.org — validación y oportunidades                          | `seo-schema`                                             | JobPosting validado contra Rich Results; confirmar cero tipos deprecados                                                                                          | ✅ Hecho — 2026-08-04, ver §1.11. JobPosting/Organization/WebSite ya validados en §1.7; oportunidad de §1.7 (BreadcrumbList/ItemList en categorías) implementada |
| 7    | Core Web Vitals con datos de campo reales                        | `seo-google` (`pagespeed`, `crux`)                       | LCP/INP/CLS con CrUX real, no solo lab data                                                                                                                       | ✅ Hecho — 2026-08-04, ver §1.14. API key real conectada; CrUX confirma (no asume) que aún no hay datos de campo — dominio demasiado nuevo/bajo tráfico para el umbral de 28 días |
| 8    | GEO / AI Overviews — superficie sin tocar hoy                    | `seo-geo`                                                | Reporte de citability score sobre una página de vacante y una de categoría                                                                                        | ✅ Hecho — 2026-08-04, ver §1.12. Fecha de publicación real agregada al texto visible; contenido corto sigue siendo el mismo límite ya documentado en §1.6 |
| 9    | Investigación de keywords (solo si hay fuente de datos real)     | `seo-google` (`keywords`, Tier 3) o extensión DataForSEO | **No arranca sin credenciales reales** — nunca un volumen inventado                                                                                               | ⬜ Bloqueado (volumen real) — parcialmente sustituido con alternativa gratuita, ver §1.8/§1.10. Sigue sin credenciales Ads/DataForSEO |

No hay una fase "10" ya definida — cualquier trabajo más allá de esto
(backlinks, contenido adicional, un tercer país) es exploratorio y
necesita su propio diagnóstico antes de entrar a esta tabla, mismo
criterio que ya usa `docs/SEO-PLAN.md` §8.

## 4. Qué NO hacer

- No correr `/seo audit` (el orquestador de 15 subagentes en paralelo)
  como primer paso — es caro en tiempo/contexto y la mayoría de sus
  hallazgos ya están cubiertos por el diagnóstico manual de `SEO-PLAN.md`
  §9. Usarlo más adelante, una vez agotadas las fases específicas de la
  tabla, como auditoría de cierre.
- No instalar extensiones pagas (DataForSEO, Ahrefs, SE Ranking,
  Profound) sin que el usuario decida explícitamente traer sus propias
  credenciales — ninguna es necesaria para las fases 2-8.
- No tocar `robots.txt`/`sitemap*.xml` fuera de lo que una fase concreta
  de la tabla justifique — ya están verificados sanos (`SEO-PLAN.md` §9.1).
