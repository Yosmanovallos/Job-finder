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
| 3    | Confirmar causa raíz con datos reales de Google                  | `seo-google` (`gsc query`, `inspect`, `sitemaps`)        | Requiere que el usuario traiga el desglose de Search Console, o las credenciales `GOOGLE_INDEXING_CLIENT_EMAIL`/`GOOGLE_INDEXING_PRIVATE_KEY` en el entorno local | ⬜ Bloqueado — depende del usuario                                                  |
| 4    | Auditoría de contenido programático a escala                     | `seo-programmatic`, `seo-content`                        | Score de unicidad real sobre una muestra de páginas de vacante; decidir si la Fase 4 del plan viejo (descripciones reales por fuente) se vuelve necesaria         | ⬜ Pendiente                                                                        |
| 5    | Auditoría técnica completa                                       | `seo-technical`, `seo-sitemap`                           | 9 categorías revisadas contra el sitio real; confirmar que nada de lo nuevo (hreflang, `last_seen_at`) introdujo una regresión técnica                            | ⬜ Pendiente                                                                        |
| 6    | Schema.org — validación y oportunidades                          | `seo-schema`                                             | JobPosting validado contra Rich Results; confirmar cero tipos deprecados                                                                                          | ⬜ Pendiente                                                                        |
| 7    | Core Web Vitals con datos de campo reales                        | `seo-google` (`pagespeed`, `crux`)                       | LCP/INP/CLS con CrUX real, no solo lab data                                                                                                                       | ⬜ Pendiente (necesita credenciales Google)                                         |
| 8    | GEO / AI Overviews — superficie sin tocar hoy                    | `seo-geo`                                                | Reporte de citability score sobre una página de vacante y una de categoría                                                                                        | ⬜ Pendiente                                                                        |
| 9    | Investigación de keywords (solo si hay fuente de datos real)     | `seo-google` (`keywords`, Tier 3) o extensión DataForSEO | **No arranca sin credenciales reales** — nunca un volumen inventado                                                                                               | ⬜ Bloqueado — depende de credenciales que el usuario decida conectar               |

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
