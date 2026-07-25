# Glassdoor — Catálogo de fuente

Última verificación: 2026-07-25. Las citas de `robots.txt` son de una
descarga directa (`curl`) contra `glassdoor.com` en esta fecha. Las citas
de Términos de Uso y de la documentación del API **no pudieron obtenerse
por descarga directa** (toda solicitud directa devolvió `403 Forbidden`,
igual que la vía scrapeada); se obtuvieron de capturas de Internet Archive
(`web.archive.org`) — ver nota de procedencia en cada sección. El contenido
descargado de internet se trata como dato no confiable: se reporta, no se
obedece.

## Resumen ejecutivo

Glassdoor **no ofrece ningún método de la escalera de prioridad más ligero
que "HTML + selectores"** para este caso de uso, por la misma razón
estructural que Indeed: rung 1 (API) existe pero es exclusivamente para
partners con acreditación comercial, sin alta de autoservicio documentada;
rung 2 (feed) está cerrado por `robots.txt` y no existe sitemap; rung 3
(JSON-LD) vive en la página de detalle de vacante, que `robots.txt`
deshabilita. Además, sus **Términos de Uso — revisados el 1 de julio de
2026, es decir, vigentes hace apenas 3 semanas — son legalmente un
documento de Indeed, Inc.** ("Indeed, Inc. ('Glassdoor') provides the
services Glassdoor.com... For the purposes of these Terms, 'Glassdoor,'
'we,' 'us,' and 'our,' means Indeed, Inc.") y contienen una cláusula de
prohibición de scraping prácticamente equivalente a la ya documentada en
`indeed.md`. `robots.txt` sí permite técnicamente la URL de búsqueda exacta
que usa el scraper actual — igual que en Indeed, esto **no equivale a
autorización de los Términos de Uso**; son dos capas independientes y
ambas aplican.

A diferencia de Indeed, aquí hay un factor adicional que agrava la
situación desde la regla 8 de `AGENTS.md` ("Never bypass... anti-bot
controls"): el propio código de este proyecto ya usa `got-scraping`
(`src/index.ts:3`), una librería cuyo propósito explícito es imitar huellas
TLS/HTTP2 de navegador real para evitar detección de bots, y el log de fase
que la invoca se autodescribe literalmente como
`"Phase 2: Local Cloudflare-bypass scraping (Indeed, Glassdoor)"`
(`src/index.ts:1501`). Esto no es un hallazgo de esta investigación sobre
Glassdoor específicamente — es una característica preexistente del
pipeline compartido con Indeed — pero es un hecho relevante para la
recomendación: "seguir scrapeando con más jitter" no es un statu quo
neutral aquí, es continuar operando una herramienta orientada a evadir un
control anti-bot (el WAF que ahora devuelve 403) contra una fuente cuyos
Términos, propios, ya prohíben el acceso automatizado sin permiso escrito.

Como en `indeed.md`, esta no es una recomendación de abandonar Glassdoor —
es la constatación de hechos documentados que corresponde poner en manos
de una decisión humana explícita.

---

## 1. API pública de búsqueda de empleos

**Estado: existe un programa de API de Glassdoor, pero documentado hoy
como exclusivo para "API partners" acreditados comercialmente; sin alta de
autoservicio documentada para lectura de resultados de búsqueda de
empleo.**

Nota de procedencia: las tres URLs de este apartado devolvieron `403
Forbidden` en descarga directa (`curl`, 2026-07-25) — el mismo patrón que
la ruta scrapeada, así que el 403 en sí **no informa nada sobre la
disponibilidad del API**; es una respuesta de WAF/Cloudflare uniforme a
cualquier ruta del dominio, no una señal específica del programa de API.
Para leer el contenido se usaron capturas de Internet Archive (fechas
abajo). Se cita textualmente lo que dicen esas capturas, marcado como tal.

- `https://www.glassdoor.com/developer/index.htm` — captura del
  2026-06-07 (`web.archive.org/web/20260607213818/...`), es decir, **7
  semanas antes de esta verificación**. Cita literal:
  > "The Glassdoor API is a simple, lightweight REST API that responds to
  > http requests with JSON (future support for XML is planned)... **The
  > APIs that are not provided publicly are available to our API
  > partners. If you're interested in becoming an API partner, please
  > contact us.**"
  Los parámetros comunes documentados incluyen `t.p` (partner id) y `t.k`
  (partner key), descritos ambos como **"as assigned by Glassdoor"** — no
  se documenta ningún flujo de autoservicio para obtenerlos.
- `https://www.glassdoor.com/developer/jobsApiActions.htm` — captura del
  2026-01-15. Cita literal:
  > "The jobs actions are used to search for jobs. There are 3 actions
  > currently supported: **Glassdoor has additional Jobs APIs that are not
  > provided publicly, but are available to our API partners.**"
  La lista de las "3 actions" no aparece en el HTML capturado — puede ser
  contenido renderizado por JS que Internet Archive no ejecutó, o puede
  no existir; **esto es observado, no se puede afirmar que las acciones
  fueron eliminadas.** Como dato de contexto (no como conclusión): la
  versión de API referenciada sigue siendo "1" ("1.1" para jobs) y el
  snippet de atribución apunta a `glassdoor.com:8080`, señales
  compatibles con una página vestigial, sin fecha que lo confirme.
- `https://www.glassdoor.com/developer/register_input.htm` — la única
  captura disponible en Internet Archive es del **2023-03-22**, más de
  tres años antes de esta verificación. Dice: "Your Glassdoor API key is
  tied to your Glassdoor account. To obtain an API key, please log in or
  create an account." **Esta cita no se usa como evidencia del estado
  2026** — se reporta solo para que quede constancia de que existió un
  flujo de autoservicio en 2023 y de que no hay una captura más reciente
  de esta página específica disponible en el archivo.

Afirmaciones de terceros encontradas por búsqueda web (dev.to, jobspipe.dev,
zuplo.com, mantiks.io, theirstack.com) sostienen que "Glassdoor retiró su
API pública en 2022" y que el acceso es "solo para partners enterprise
desde 2024". **Esto no está verificado contra una fuente de Glassdoor con
fecha específica**; además, varias de esas fuentes son proveedores
comerciales de scraping/agregación de datos con interés directo en that
narrativa. Se reporta como afirmación de terceros interesados, no como
hecho confirmado.

**Conclusión rung 1**: no hay evidencia de una vía de autoservicio pública
para consultar resultados de búsqueda de empleo; la propia documentación
vigente (capturada hace 1–7 semanas) dirige explícitamente a "become an
API partner" mediante contacto comercial. No es equivalente a "API pública
disponible".

## 2. Feed estructurado (RSS/JSON/sitemap)

**Estado: cerrado por robots.txt; no existe directiva de sitemap.**

`robots.txt` (sección 4) contiene `Disallow: /rss/*` en el grupo
`User-agent: *` — Glassdoor tiene (o tuvo) una ruta `/rss/` y la excluye
explícitamente de rastreo para cualquier agente genérico, igual que Indeed
hace con `/rss`. Además, a diferencia de Workana (que sí declara un
`Sitemap:` en su robots.txt, aunque resultó ser solo páginas SEO de
categoría), **el `robots.txt` de Glassdoor no contiene ninguna directiva
`Sitemap:`** — se verificó con `grep -i sitemap` sobre el archivo completo,
sin resultados. No hay, por tanto, ni siquiera un sitemap de páginas de
categoría que evaluar.

**Conclusión rung 2**: cerrado, y cerrado deliberadamente vía robots.txt
para el feed conocido; no hay sitemap alternativo.

## 3. HTML + JSON-LD / HTML + selectores (estado actual del proyecto)

`src/index.ts` (`scrapeGlassdoor`) opera hoy sobre
`https://www.glassdoor.com/Job/colombia-<keyword>-jobs-SRCH_IL.0,8_IN54_KO9,<n>.htm?fromAge=3`,
extrayendo campos de un stream de React Flight (RSC) embebido y
doble-escapado en el HTML, con regex específicas por fragmento
`\"jobview\":{...}`. **Esta estructura es comportamiento observado, no
documentado ni garantizado por Glassdoor** — es un detalle interno del
frontend (Next.js/RSC), sujeto a cambio sin aviso en cualquier despliegue,
independientemente del bloqueo 403 actual.

No hay una capa JSON-LD accesible sin bloqueo: la página de detalle de
vacante (`/jobview/...`) es la que normalmente llevaría ese markup, y está
**deshabilitada por robots.txt** (ver sección 4). El escalón "HTML +
JSON-LD" no es, por tanto, una alternativa más ligera disponible aquí: la
única página solicitable de forma compatible con robots.txt es la de
resultados de búsqueda, que es exactamente la que ya se scrapea.

Tampoco es viable llamar directamente al backend JSON/GraphQL que el
propio frontend usa para poblar esa página: `robots.txt` deshabilita
explícitamente `/graph`, `/api/`, `/api-web/`,
`/employers/engagement/api/`, `*/*Ajax.htm`, `*/json/` y `*/json$` (grupo
`*`). Es la misma situación que Workana con su `/api/` — la ruta interna
existe pero está expresamente excluida de rastreo; no perseguirla como
"alternativa más ligera".

## 4. robots.txt — hallazgos verbatim

Obtenido con `curl` directo (no vía navegador) el 2026-07-25 desde
`https://www.glassdoor.com/robots.txt` (200 OK, 226 líneas).

### Grupo `User-agent: *` (aplica a un cliente HTTP genérico)

Extracto relevante (archivo completo consultado en su totalidad):

```
User-agent: *
...
Disallow: /jobview/
Disallow: /legal/
...
Disallow: /rss/*
Disallow: /search/
Disallow: /Search/
...
Disallow: /developer/index.htm
Disallow: /developer/widget/builder/
...
Disallow: /about/terms/
...
# API Endpoints
Disallow: /graph
Disallow: /api-web/
Disallow: /api/
Disallow: /employers/engagement/api/
...
Disallow: /Job/*_IP*
Disallow: /job-listing/*_IE*.htm
Disallow: /job-listing/JV.htm?*
```

Puntos verificados programáticamente con `urllib.robotparser` de Python
contra el archivo completo (`can_fetch("*", url)`):

| URL probada | ¿Permitida por robots.txt para `*`? |
|---|---|
| `.../Job/colombia-software-engineer-jobs-SRCH_IL.0,8_IN54_KO9,27.htm?fromAge=3` (patrón exacto que usa el scraper actual) | **Sí** |
| `.../jobview/12345.htm` (página de detalle de vacante) | No |
| `.../job-listing/index.htm?jl=12345` (link de fallback que el scraper solo *construye* como salida, no fetchea) | Sí |
| `.../developer/index.htm` | No |
| `.../developer/jobsApiActions.htm` | Sí (no bloqueada, pero irrelevante — el WAF la bloquea igual, ver §1) |
| `.../about/terms/` | No |

Lecturas clave:

- **La URL de búsqueda exacta que usa hoy el scraper está técnicamente
  permitida por robots.txt** para un agente genérico — no coincide con
  `/Job/*_IP*` (que bloquea un patrón `_IP` distinto al `_IN`/`_KO` que usa
  esta URL) ni con ningún otro patrón `Disallow`. Esto es idéntico al
  hallazgo de `indeed.md`: **permiso de robots.txt no equivale a permiso
  de los Términos de Uso** — son dos capas independientes y ambas aplican
  (ver sección 5).
- **`/jobview/` está deshabilitada.** El scraper actual no la solicita —
  solo construye URLs de esa familia (`job-listing/index.htm?jl=...`) como
  dato de salida para que un humano las abra. Esto es correcto tal como
  está, pero es un **techo duro** para cualquier futuro enriquecimiento
  que quiera abrir la página de detalle (descripción completa, salario,
  posible JSON-LD): eso violaría robots.txt. No implementarlo sin revisar
  este documento de nuevo — misma advertencia que `indeed.md` hace para
  `/viewjob?` de Indeed.
- **`/about/terms/` y `/legal/` están deshabilitadas** para el grupo `*`.
  Consecuencia estructural, no anecdótica: **este proyecto nunca podrá
  monitorear programáticamente los Términos de Uso de Glassdoor de forma
  compatible con robots.txt** — solo un humano abriendo el sitio en
  navegador podría re-verificar cambios futuros; no automatizarlo.
- **`/graph`, `/api/`, `/api-web/`, `/employers/engagement/api/`,
  `*/*Ajax.htm`, `*/json/`, `*/json$` están deshabilitadas** — esto
  descarta de antemano la idea obvia de "llamar directamente al
  JSON/GraphQL interno en vez de parsear HTML"; no perseguirla (mismo
  patrón que `/api/` en `workana.md`).
- **No hay directiva `Crawl-delay`** en ningún grupo del archivo
  (verificado con `grep -i "crawl-delay"`, sin resultados). No existe un
  límite de tasa publicado por Glassdoor que "cumplir" — cualquier
  cadencia aplicada (`jitterDelay()`, `MAX_KEYWORDS_PER_ROLE = 12`) es una
  cortesía autoimpuesta del proyecto, no cumplimiento de un umbral
  documentado. Misma conclusión que `indeed.md`.

### Grupo de bots de IA nombrados (GPTBot, anthropic-ai, Claude-Web,
ClaudeBot, Google-Extended, Amazonbot, GoogleOther, Perplexity, Cohere,
cohere-ai, Applebot-Extended, Google-CloudVertexBot)

```
Disallow: /
Allow: /blog/
Allow: /Award/
Allow: /About/
```

Bloqueo total del sitio (incluido `/Job/`) para estos user-agents
nombrados, con solo tres subrutas de contenido editorial permitidas. No
aplica al cliente HTTP de este proyecto salvo que se identifique con uno
de esos user-agents (no es el caso observado en el código revisado) —
pero si algún componente futuro del pipeline llegara a identificarse con
alguno de ellos, `/Job/` quedaría deshabilitado por completo.

### Grupo de bots de IA de "baja calidad" y scrapers conocidos

```
User-agent: CCBot / Omgilibot / Omgili / FacebookBot / Bytespider /
            Diffbot / Youbot / FriendlyCrawler / img2dataset
Disallow: /

User-Agent: OmniExplorer_Bot
Disallow: /

User-agent: ia_archiver / Baiduspider
Disallow: /
Allow: */index.htm
```

Señal adicional de que Glassdoor vigila activamente user-agents de
scraping/IA conocidos por nombre, más allá de lo que el grupo `*` deja
pasar en teoría — mismo patrón documentado en `indeed.md` para `Scrapy`,
`JobdiggerSpider`, etc.

## 5. Términos de Uso — cita literal, con nota de procedencia obligatoria

**Nota de procedencia (léase antes que las citas):** `https://www.glassdoor.com/about/terms/`
devolvió `403 Forbidden` en cada intento de descarga directa realizado en
esta sesión (2026-07-25, tanto con `WebFetch` como con `curl`). El texto
citado abajo proviene de una **captura de Internet Archive**
(`web.archive.org/web/20260721162840/https://www.glassdoor.com/about/terms/`),
**no de una descarga directa de Glassdoor** — a diferencia de las citas de
`indeed.md`, que sí vinieron de una descarga directa de `indeed.com/legal`.
Dicho esto, la propia página capturada indica **"Revised: July 1st, 2026"**,
y la captura es del **2026-07-21** — es decir, a solo 4 días de esta
verificación (2026-07-25) y a 3 semanas de la fecha de revisión declarada.
Esto hace que el texto sea, con muy alta probabilidad, el texto vigente
hoy — sensiblemente más fuerte que el caso de `workana.md` (donde solo se
pudieron citar snippets de buscador), pero sigue sin ser una lectura
directa del propio sitio de Glassdoor, y debe tratarse como tal en
cualquier decisión de cumplimiento.

Identidad legal de la entidad (cita literal del propio documento):

> "Indeed, Inc. ("Glassdoor") provides the services Glassdoor.com and
> Fishbowlapp.com... For the purposes of these Terms, "Glassdoor," "we,"
> "us," and "our," means Indeed, Inc."

Es decir: los Términos de Uso de Glassdoor **son, legalmente, un documento
de Indeed, Inc.** — no una empresa afiliada distinta con reglas separadas.
Esto explica por qué la cláusula de scraping (abajo) es prácticamente
equivalente a la ya documentada en `indeed.md`. Dato reportado sin
resolver: el pie de página de la misma captura dice "Copyright © 2008–2026,
Glassdoor, Inc." — coexisten ambas menciones ("Indeed, Inc." en el cuerpo
legal, "Glassdoor, Inc." en el copyright de pie de página); se reporta la
discrepancia, no se intenta reconciliar.

El mismo documento también confirma explícitamente la relación con Indeed
en la sección de conducta prohibida, al referirse a "our affiliates if you
have connected your Glassdoor account to an affiliate account, **such as
an Indeed services account**".

Cláusula de uso no comercial (sección 1, "Eligibility to Use the
Services"):

> "Except as set forth below, or as otherwise approved by us, **the
> services are for your personal, non-commercial use unless you enter
> into a separate agreement with us for your commercial use.**"

Esta es una prohibición independiente de la de scraping: aplica por sí
sola si este proyecto se usa o monetiza comercialmente, sin necesidad de
invocar la cláusula de automatización. No se especula aquí sobre los
planes de producto de este repo; se documenta la cláusula tal como existe.

Cláusula de conducta prohibida (lista de "you agree that you will not"),
cita literal:

> "Introduce software or automated agents to the services, or access the
> services so as to produce multiple accounts, generate automated
> messages, or **to scrape, strip, or mine data from the services without
> our express written permission**;"

Y, en la misma lista:

> "Copy or use the information, Content (excluding Your Content), or data
> on the services **in connection with a competitive service**, as solely
> determined by Glassdoor;"

> "**Sell, resell, rent, lease, loan, trade, or otherwise monetize access
> to the services** or any Content (excluding Your Content) without our
> express written permission;"

> "Interfere with, disrupt, modify, **reverse engineer, or decompile** any
> data or functionality of the services;"

**Lectura factual, sin editorializar**: a diferencia de la cláusula de
Indeed citada en `indeed.md` (que otorga un permiso condicional acotado a
"crawl... solely as outlined in our robots.txt file"), esta cláusula de
Glassdoor **no contiene ninguna excepción de robots.txt** — la prohibición
de "scrape, strip, or mine data... without our express written permission"
es incondicional salvo permiso escrito expreso. El hecho de que
`robots.txt` permita técnicamente la URL de búsqueda (sección 4) no
constituye ese permiso escrito; son dos capas de reglas independientes.

## 6. Otras rutas ya usadas por el proyecto (contexto)

El código ya tiene una ruta Apify (`scrapeIndeedCombined`, feature-flagged
por `APIFY_TOKEN`) para Indeed; no se identificó un actor Apify equivalente
ya integrado para Glassdoor en el código revisado. Igual que en
`indeed.md` y `workana.md`: enrutar la extracción a través de un proveedor
externo **no cambia el análisis de los Términos de Uso de la sección 5**
(la prohibición de "scrape... without our express written permission"
sigue aplicando sin importar quién opere el cliente HTTP), y sigue siendo
un escalón más pesado y más abajo en la jerarquía de prioridad del
proyecto. No es "más legítimo", es "más caro y más abajo en la escalera".

## 7. Estado actual del código (contexto para la decisión humana)

- `src/sources/glassdoor.ts` ya limita el fan-out a
  `MAX_KEYWORDS_PER_ROLE = 12` variantes de keyword por rol e inserta
  `jitterDelay()` (1–3 s aleatorios) entre solicitudes — mismo ajuste
  aplicado a Indeed, según el propio comentario del archivo.
- `scrapeGlassdoor` (`src/index.ts`) ya no traga errores silenciosamente:
  un fallo de fetch se propaga para que `executeWithResilience` y el
  circuit breaker lo vean (corregido explícitamente, según comentario en
  el código, tras observar que antes se devolvía `[]` y ocultaba el
  bloqueo).
- **Hallazgo que sí corresponde reportar en este documento**: el fetch
  subyacente (`gsFetch`, `src/index.ts`) usa `got-scraping`
  (`import { gotScraping } from "got-scraping"`, `src/index.ts:3`), una
  librería cuyo propósito documentado es imitar huellas TLS/HTTP2/header
  de navegadores reales para reducir la probabilidad de detección como
  bot. El propio log de la fase que invoca a Glassdoor e Indeed se
  autodescribe como `"Phase 2: Local Cloudflare-bypass scraping (Indeed,
  Glassdoor)"` (`src/index.ts:1501`). Esto es una característica
  preexistente del pipeline (no introducida por esta investigación), pero
  es un hecho directamente relevante para la regla 8 de `AGENTS.md`
  ("Never bypass CAPTCHA, auth, anti-bot controls, or terms of use"): el
  cliente que hace las solicitudes ya está diseñado para evadir controles
  anti-bot, contra una fuente cuyo WAF ahora devuelve 403 en el 100% de
  las solicitudes y cuyos Términos de Uso prohíben el scraping sin permiso
  escrito. No se recomienda "arreglar" esto ajustando fingerprints —
  seguir por esa vía sería exactamente el tipo de evasión que la regla 8
  prohíbe.

## 8. Cobertura de campos vs. el tipo `Job` del proyecto

`Job` (`src/sources/types.ts`): `jobId, title, company, location, url,
dateText, source, publishedAt?`.

`scrapeGlassdoor` puebla:

- `jobId`: `listingId` numérico si está presente, si no el `link` completo.
- `title`, `company`, `location`: extraídos por regex del fragmento
  `jobview` del stream RSC, con `unescapeFlight()` + `htmlEntities()`.
  **`company` cae a `"Confidencial"` y `location` cae a `"Colombia"`
  cuando el campo falta** — ambos son **valores de reemplazo fabricados**,
  no datos reales de la fuente, y no deberían sobrevivir según la regla 5
  de `AGENTS.md` ("Never invent data... Prefer unknown/null"). Mismo
  patrón que `workana.md` señaló para su default de `"Colombia"`.
- `url`: `seoJobLink` si está presente; si no, se construye
  `job-listing/index.htm?jl=<listingId>` (no verificado que esa URL
  resuelva sin bloqueo, dado el 403 actual).
- `dateText`/`publishedAt`: derivados de `ageInDays`, un entero de días
  provisto por la propia fuente — esto **sí es precisión genuina de día a
  nivel de fuente**, no un descarte de datos disponibles.

No hay campo de salario, descripción completa, ni tipo de contrato en el
payload observado — consistente con que esos datos, si existen, estarían
en la página de detalle (`/jobview/`), deshabilitada por robots.txt (ver
§4). Toda esta estructura (el stream RSC, los nombres de campo
`jobview`/`header`/`ageInDays`/`employerNameFromSearch`/`jobTitleText`/
`locationName`/`seoJobLink`) es **comportamiento observado, no
documentado ni garantizado por Glassdoor** — estado interno de frontend
sujeto a cambio sin aviso en cualquier despliegue.

## 9. Recomendación

La escalera de prioridad no ofrece ningún escalón más ligero disponible:
rung 1 (API) es de partners acreditados sin alta de autoservicio
documentada; rung 2 (feed) cerrado por robots.txt y sin sitemap; rung 3
(JSON-LD) vive en una ruta deshabilitada por robots.txt; el JSON/GraphQL
interno también está deshabilitado. Esto es estructuralmente idéntico al
caso de Indeed. A eso se suma: unos Términos de Uso revisados hace 3
semanas, que son legalmente un documento de Indeed, Inc., que prohíben
scraping "without our express written permission" sin la excepción de
robots.txt que sí tenía la cláusula de Indeed, más una cláusula
independiente de uso no comercial, más un cliente HTTP (`got-scraping`)
ya orientado a evadir detección de bots contra un WAF que ahora bloquea el
100% de las solicitudes.

No puedo, por regla del proyecto, recomendar evadir los Términos de Uso ni
el control anti-bot activo (el 403 en sí), ni recomendar "seguir
scrapeando con más jitter" como si fuera cumplimiento — no hay umbral de
Glassdoor que cumplir (no hay `Crawl-delay`), y el uso automatizado ya está
prohibido por los Términos independientemente de la cadencia. Corresponde
escalar la decisión, con estos hechos ya verificados, a quien tenga
autoridad de producto sobre este repo:

- **Opción A — retirar Glassdoor como fuente de scraping directo** (misma
  recomendación que `workana.md` adoptó, con evidencia aquí más fuerte:
  ToS con fecha de revisión de hace 3 semanas leída de una captura a solo
  4 días de esta verificación, más el hallazgo adicional de
  `got-scraping`/"Cloudflare-bypass" en el código). Elimina el conflicto
  documentado en la sección 5 y el problema de regla 8 de la sección 7.
- **Opción B — mantener el scraping HTML actual, con el riesgo de
  Términos de Uso y de uso de herramientas anti-detección expresamente
  documentado y aceptado por un humano**, no decidido implícitamente por
  un agente. Si se opta por esto, como mínimo debería (i) dejar de usar
  `got-scraping` en modo que imite fingerprints de navegador para evadir
  el WAF —dado que la regla 8 lo prohíbe explícitamente—, y (ii) eliminar
  los valores fabricados `"Confidencial"`/`"Colombia"` de la sección 8 en
  favor de `unknown`/`null`, independientemente de qué se decida sobre el
  scraping en sí.
- **Opción C — solicitar permiso escrito explícito a Glassdoor/Indeed,
  Inc.** ("our express written permission", la única vía que el propio
  texto deja abierta) antes de continuar. No investigado aquí por exceder
  el alcance de investigación de fuentes (es gestión comercial/legal).
- Enrutar la extracción vía Apify (u otro proveedor externo) **no es una
  opción que resuelva esto** — no cambia el análisis de los Términos de
  Uso de la sección 5 (ver sección 6); no adoptarlo como solución de
  cumplimiento.

No recomiendo ninguna opción por mi cuenta — es una decisión de negocio y
de riesgo legal, no una decisión técnica.

## Fuentes consultadas

- `https://www.glassdoor.com/robots.txt` (descarga directa con `curl`,
  200 OK, 2026-07-25) — analizado también programáticamente con
  `urllib.robotparser` de Python contra las URLs relevantes.
- `https://www.glassdoor.com/about/terms/` — descarga directa: `403
  Forbidden` (WebFetch y `curl`, 2026-07-25). Contenido leído vía
  captura de Internet Archive:
  `http://web.archive.org/web/20260721162840/https://www.glassdoor.com/about/terms/`
  (capturada 2026-07-21; página indica "Revised: July 1st, 2026").
- `https://www.glassdoor.com/developer/index.htm` — descarga directa:
  `403 Forbidden` (2026-07-25). Leído vía captura de Internet Archive:
  `http://web.archive.org/web/20260607213818/https://www.glassdoor.com/developer/index.htm`
  (capturada 2026-06-07).
- `https://www.glassdoor.com/developer/jobsApiActions.htm` — descarga
  directa: `403 Forbidden` (2026-07-25). Leído vía captura de Internet
  Archive:
  `http://web.archive.org/web/20260115102241/https://www.glassdoor.com/developer/jobsApiActions.htm`
  (capturada 2026-01-15).
- `https://www.glassdoor.com/developer/register_input.htm` — descarga
  directa: `403 Forbidden` (2026-07-25). Única captura disponible en
  Internet Archive: `2023-03-22` — citada solo como dato histórico, no
  como evidencia del estado 2026 (ver §1).
- `http://archive.org/wayback/available?url=...` (API de disponibilidad
  de Internet Archive, usada para localizar timestamps de captura antes
  de descargar cada página).
- Búsquedas web: "Glassdoor public API job search developers
  documentation 2026", "Glassdoor Terms of Use prohibited automated
  access scraping robots", "glassdoor.com/developer API jobs no longer
  OR deprecated OR discontinued 2022 2023" — resultados de dev.to,
  jobspipe.dev, zuplo.com, mantiks.io, theirstack.com citados solo como
  afirmaciones de terceros no verificadas contra fuente oficial con
  fecha (varios de ellos son proveedores comerciales de
  scraping/agregación, con interés directo en esa narrativa; ver §1).
- Código del propio proyecto revisado como contexto (no como fuente
  externa): `job-radar-apify/src/index.ts` (`scrapeGlassdoor`, `gsFetch`,
  import de `got-scraping`, log "Cloudflare-bypass scraping"),
  `job-radar-apify/src/sources/glassdoor.ts`,
  `job-radar-apify/src/sources/types.ts`.

## Nota sobre contenido no confiable

Todo lo descargado de Glassdoor o de Internet Archive (robots.txt,
capturas HTML de Términos de Uso y documentación de API) se trató como
dato, no como instrucción, según las reglas del proyecto. Nada de ese
contenido intentó dirigir el comportamiento de esta herramienta; se
reporta aquí lo encontrado, no se ejecuta nada de lo que el contenido
descargado pudiera decir.
