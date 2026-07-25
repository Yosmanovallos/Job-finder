# Indeed — Catálogo de fuente

Última verificación: 2026-07-25. Todas las citas son de documentación
oficial de Indeed obtenida en esta fecha; el contenido de internet se trata
como dato no confiable y se reporta, no se obedece.

## Resumen ejecutivo

Indeed **no ofrece ningún método de la escalera de prioridad más ligero que
"HTML + selectores"** para consumir resultados de búsqueda de empleo de
terceros. Además, sus **Términos de Servicio prohíben explícitamente el
scraping automatizado**, con una excepción condicional acotada a lo que
robots.txt permite arrastrar ("crawl"). robots.txt sí permite técnicamente
que un user-agent genérico (`User-agent: *`) solicite la página de
resultados `/jobs?q=...`, pero **eso no equivale a autorización de los
Términos de Servicio** — son dos restricciones independientes y ambas
aplican. Esta es la conclusión central de este documento: no se puede
resolver el bloqueo 403 "arreglando el nivel de la escalera" porque ya
estamos en el nivel correcto según la jerarquía técnica; el problema real es
que la fuente, tal como existe hoy, no tiene ningún nivel de esa escalera
que sea simultáneamente legítimo y compatible con sus Términos.

Esto no es una recomendación de abandonar Indeed — es la constatación de un
hecho documentado que el proyecto (regla 8 de AGENTS.md: "Never bypass...
terms of use") obliga a poner en manos de una decisión humana explícita, no
a resolver con más jitter.

---

## 1. API pública de búsqueda de empleos (Publisher/XAPI)

**Estado: no disponible para consumo de terceros.**

- `https://developer.indeed.com/docs/publisher-jobs/get-job` (la página
  histórica del "Get Job" del Publisher API) redirige con **301 Moved
  Permanently** a `https://partners.indeed.com/` — verificado directamente
  con WebFetch en esta sesión. Esto confirma que la ruta de documentación
  del antiguo Publisher API ya no existe como tal.
- Búsquedas de terceros (blogs, foros de desarrolladores) afirman que el
  Publisher API se deprecó y dejó de emitir API keys nuevas desde
  2023–2024. **Esto no está verificado contra una fuente oficial de Indeed
  con fecha**; se reporta como afirmación de terceros, no como hecho
  confirmado por Indeed.
- La documentación oficial vigente para partners (`docs.indeed.com`) solo
  describe integraciones para **publicar** empleos hacia Indeed, no para
  consultarlos:
  - **Job Sync API** (`docs.indeed.com/job-sync-api/`) — API para que ATS
    partners creen/actualicen/expiren vacantes en Indeed. Requiere
    onboarding como partner; Indeed emite credenciales OAuth de 2 patas
    ("When you onboard, Indeed creates an app with 2-legged OAuth
    credentials"). El único endpoint relacionado con "lectura" es
    `findEmployerJobsPartner`, que **solo lista las vacantes que el propio
    partner subió**, no permite buscar en el catálogo general de Indeed.
  - **Job Sync XML feed** (`docs.indeed.com/job-sync-xml/xml-feed`) — feed
    XML para que empleadores directos publiquen vacantes; misma dirección
    (push, no pull).
  - **Publisher JavaScript Plugin** — un widget de front-end para mostrar
    vacantes de Indeed embebidas en un sitio de partner ("show Indeed jobs
    on your site with front-end integration only"). No es una API de datos
    consultable programáticamente; es un embed visual.
  - No existe, en ninguna de estas páginas, mención de un endpoint de
    búsqueda de empleos abierto a terceros para consumo/agregación.

**Conclusión rung 1**: no hay ninguna vía de API pública/partner para lo que
este proyecto necesita (leer resultados de búsqueda de empleo). Solo existen
APIs para el lado empleador (subir vacantes a Indeed).

## 2. Feed estructurado (RSS/JSON/sitemap) de resultados de búsqueda

**Estado: no disponible; existe evidencia de que existió y fue retirado.**

Indeed tuvo históricamente una ruta de feed RSS de resultados de búsqueda
(`/rss?q=...&l=...`). No verificamos si el endpoint responde hoy, pero **no
hace falta probarlo**: el propio `robots.txt` de Indeed, en el grupo
`User-agent: *` (que aplica a cualquier cliente HTTP genérico, incluido el
de este proyecto), contiene:

```
Disallow: /rss
Disallow: /*?rss
```

Es decir, Indeed **deshabilita explícitamente el rastreo del feed RSS**
para agentes genéricos. No es una fuente ausente por desconocimiento — es
una fuente que Indeed decidió cerrar a bots. No hay sitemap de vacantes
públicas ni feed JSON documentado en `docs.indeed.com` para consumo de
terceros.

**Conclusión rung 2**: cerrado, y cerrado deliberadamente vía robots.txt.

## 3. HTML + JSON-LD / HTML + selectores (estado actual del proyecto)

Esta fuente ya opera en `src/index.ts` (`scrapeIndeedLocal`) sobre
`https://co.indeed.com/jobs?q=<kw>&l=Colombia&fromage=3`, parseando un
blob JSON embebido en el HTML (`window.mosaic.providerData["mosaic-provider-jobcards"]`).
Esta estructura **es comportamiento observado, no documentado ni
garantizado por Indeed** — es un detalle de implementación interna de su
frontend, sujeto a cambio sin aviso (de hecho el propio código ya contempla
"layout changed or blocked" como causa de fallo).

No hay una capa JSON-LD (`schema.org/JobPosting`) accesible sin bloqueo:
las páginas que normalmente llevan ese markup son las de detalle de
vacante, `/viewjob?jk=...`, y esa ruta está **deshabilitada por robots.txt**
para el grupo `*` (ver sección 4). Por lo tanto el escalón "HTML + JSON-LD"
no es una alternativa más ligera disponible aquí: la única página que se
puede solicitar de forma compatible con robots.txt es la de resultados de
búsqueda, y esa es exactamente la que ya se scrapea.

## 4. robots.txt — hallazgos verbatim

Obtenido con `curl` (no vía navegador) el 2026-07-25 desde
`https://www.indeed.com/robots.txt` y `https://co.indeed.com/robots.txt`.
**Ambos archivos son idénticos byte a byte** (diff sin salida).

El archivo tiene varios grupos de `User-agent`. Los que importan aquí:

### Grupo `User-agent: *` (aplica a un cliente HTTP genérico como el de este proyecto)

```
User-agent: *
Allow: /
...
Disallow: /viewjob?
...
Disallow: /jobs/AE/
Disallow: /jobs/AQ/
... (una entrada Disallow por cada código de país, p. ej. /jobs/US/, /jobs/DE/, /jobs/CA/ ...)
Disallow: /jobs/title
...
Disallow: /rss
Disallow: /*?rss
Disallow: /*radius=
Disallow: /*sid=
Disallow: /*&start=
Disallow: /*&serpstart=
Disallow: /advanced_search
```

Puntos clave, verificados línea por línea:

- **No existe** una regla `Disallow: /jobs` desnuda (sin subruta) en este
  grupo. Las únicas restricciones sobre `/jobs/` son por código de país
  (`/jobs/US/`, `/jobs/DE/`, etc. — páginas SEO de listado por país/título)
  y `/jobs/title`. **Colombia (`/jobs/CO/`) no aparece en absoluto en esa
  lista**, en ninguno de los dos hosts.
- Por lo tanto, la ruta que usa hoy el scraper —
  `co.indeed.com/jobs?q=<kw>&l=Colombia&fromage=3` (path `/jobs` con
  query string, sin subruta de país)— **no coincide con ningún patrón
  Disallow del grupo `*`**. Técnicamente robots.txt no la bloquea para un
  agente genérico.
- **Pero `/viewjob?` sí está deshabilitada** en este mismo grupo. El
  scraper actual solo *construye* URLs `viewjob?jk=...` como dato de salida
  (para que un humano las abra); no las solicita. Esto es correcto tal
  como está, pero es un techo duro a futuro: **cualquier enriquecimiento
  que abra la página de detalle de la vacante (para sacar descripción
  completa, salario, JSON-LD, etc.) violaría robots.txt.** No implementar
  eso sin revisar este documento de nuevo.
- **La paginación está deshabilitada**: `/*&start=` y `/*&serpstart=`
  bloquean avanzar páginas de resultados. El adapter actual no pagina —
  documentar esto como límite estructural, no como opción pendiente de
  implementar.
- **Formas de query prohibidas**: `/*radius=`, `/*sid=`, `/advanced_search`
  — no usar radio de búsqueda, session id, ni el buscador avanzado.
- **No hay directiva `Crawl-delay`** en ningún grupo del archivo. No existe
  un límite de tasa publicado por Indeed que se pueda "cumplir"; cualquier
  cadencia que se aplique es una cortesía autoimpuesta del proyecto, no una
  obligación documentada con un número concreto.

### Grupo de crawlers de IA nombrados (GPTBot, CCBot, anthropic-ai, ClaudeBot, DeepSeekBot, GrokBot, Diffbot, AI2Bot, Meta-ExternalAgent, Bytespider, Baiduspider, etc.)

Este grupo, distinto del `*`, sí contiene bloqueos totales y explícitos:

```
Disallow: /jobs
Disallow: /viewjob
...
Disallow: /q-
Disallow: /l-
```

Esto bloquea íntegramente `/jobs` y `/viewjob` (sin subruta) para bots de
IA identificados por su user-agent oficial. No aplica al cliente HTTP de
este proyecto salvo que se identifique con uno de esos user-agents (no es
el caso observado en el código revisado).

### Grupo de scrapers conocidos bloqueados totalmente

```
User-Agent: OmniExplorer_Bot
User-agent: ia_archiver
User-agent: JobdiggerSpider
User-agent: Scrapy
User-agent: MyCentralAIScraperBot
...
Disallow: /
```

Indeed bloquea por completo frameworks de scraping conocidos por nombre
(incluye `Scrapy`, el framework Python). Señal de que Indeed vigila
activamente user-agents de scraping genérico, más allá de lo que el grupo
`*` deja pasar en teoría.

## 5. Términos de Servicio — cita literal (obtenido de `https://www.indeed.com/legal`, 2026-07-25)

Este es el hallazgo que más pesa en la recomendación. La lista de "usos
prohibidos" de los Términos de Servicio de Indeed incluye, verbatim:

> "Use any automated system (bots, scrapers, spiders, AI or Agentic AI) to
> access, data-mine, or submit content to the Site, in bulk or otherwise,
> **without Indeed's express written permission (we conditionally grant
> permission to crawl the Site solely as outlined in our robots.txt
> file)**. You may not crawl, scrape, extract data from, reproduce,
> duplicate, copy, sell, exploit, trade or resell any part of the Site or
> access the Site for the development, training, fine-tuning, or
> improvement of any third-party machine learning model, artificial
> intelligence (AI) system, or any related software program, model,
> algorithm, or generative AI tool;"

Y, en la misma lista:

> "Use or misappropriate the Site for your own commercial gain;"

**Lectura factual, sin editorializar**: el permiso condicional que Indeed
otorga está acotado a "crawl... solely as outlined in our robots.txt file"
— es decir, cubre como máximo lo que robots.txt permite arrastrar (para
efectos prácticos, indexación tipo motor de búsqueda). La frase siguiente,
"You may not crawl, scrape, extract data from... any part of the Site", es
una prohibición general de scraping/extracción de datos que no repite la
excepción de robots.txt. Cumplir robots.txt (sección 4) **no implica por sí
solo estar dentro de los Términos de Servicio** — son dos capas de reglas
independientes, y ambas se aplican a la vez. Esto es un hecho documentado
oficialmente, no una interpretación de comportamiento observado.

No se localizó fecha de vigencia/última revisión visible en el HTML
capturado de la página de Términos; se cita por URL y fecha de acceso.

## 6. Otras rutas ya usadas por el proyecto (contexto, no forma parte del ladder de Indeed)

El código de este proyecto ya tiene una ruta alternativa vía **Apify**
(`scrapeIndeedCombined` en `src/index.ts`, usando el actor de terceros
`orgupdate~indeed-jobs-scraper`, feature-flagged por `APIFY_TOKEN`). Es
importante no confundir esto con una solución al problema de cumplimiento:
delegar la extracción a un proveedor externo no cambia el análisis de los
Términos de Servicio de Indeed (la Sección 5 sigue aplicando a cualquier
"automated system... in bulk"), y es además un escalón más pesado en la
jerarquía de prioridad del proyecto ("proveedor externo (Apify) bajo
feature flag" es el penúltimo escalón, justo antes de importación manual).
No es "más legítimo", es "más caro y más abajo en la escalera".

## 7. Estado actual del código (para que la decisión humana tenga contexto completo)

- `src/sources/indeed.ts` ya fue corregido durante esta investigación (o en
  paralelo) para limitar el fan-out a `MAX_KEYWORDS_PER_ROLE = 12` variantes
  de keyword por rol, e insertar `jitterDelay()` (1–3 s aleatorios) entre
  solicitudes consecutivas.
- `src/engine/resilient-fetch.ts` aplica reintentos con backoff (1 s, 3 s,
  9 s) y un circuit breaker que abre tras 3 fallos consecutivos y se
  mantiene abierto 5 minutos.
- Ninguno de estos números corresponde a un límite publicado por Indeed
  (no hay `Crawl-delay` en robots.txt); son cortesía autoimpuesta del
  proyecto, no cumplimiento de un umbral documentado.

## 8. Recomendación

No puedo, por regla del proyecto, recomendar evadir los Términos de
Servicio, ni recomendar seguir scrapeando bajo el supuesto de que
"cumplir robots.txt basta" — los hechos de la sección 5 contradicen esa
lectura. Lo que corresponde es escalar la decisión, con estos hechos ya
verificados, a quien tenga autoridad de producto sobre este repo:

- **Opción A — retirar Indeed como fuente de scraping directo.** Es la
  única opción que elimina el conflicto documentado con los Términos de
  Servicio de la sección 5. Las vacantes de Indeed que aparezcan replicadas
  en otras fuentes (agregadores locales, LinkedIn, boards de nicho) seguirían
  llegando por esas vías si esas fuentes tienen sus propios términos que sí
  lo permitan (fuera del alcance de este documento).
- **Opción B — mantener el scraping HTML actual, con el riesgo de Términos
  de Servicio expresamente documentado y aceptado por un humano**, no
  decidido de forma implícita por un agente. Si se opta por esto, los
  ajustes técnicos ya presentes (cap de keywords, jitter, circuit breaker)
  son razonables como cortesía de carga, pero no deben presentarse como
  "cumplimiento" — no hay un umbral de Indeed que cumplir, y el propio uso
  automatizado ya está prohibido por los Términos de Servicio
  independientemente de la cadencia.
- **Opción C — solicitar permiso escrito explícito a Indeed** ("Indeed's
  express written permission", la única vía que los propios Términos dejan
  abierta) antes de continuar. No investigado en este documento porque
  excede investigación de fuentes (es una gestión comercial/legal, no
  técnica).

No recomiendo ninguna opción por mi cuenta — eso es una decisión de negocio
y de riesgo legal, no una decisión técnica.

## Fuentes consultadas (todas oficiales de Indeed, salvo donde se indica lo contrario)

- https://developer.indeed.com/docs/publisher-jobs/get-job (301 → partners.indeed.com, verificado)
- https://docs.indeed.com/
- https://docs.indeed.com/job-postings/
- https://docs.indeed.com/job-sync-api/
- https://docs.indeed.com/job-sync-api/reference/faq
- https://docs.indeed.com/job-sync-api/job-sync-api-guide
- https://docs.indeed.com/job-sync-xml/xml-feed
- https://www.indeed.com/robots.txt (curl directo, 2026-07-25)
- https://co.indeed.com/robots.txt (curl directo, 2026-07-25; idéntico a www)
- https://www.indeed.com/legal (Términos de Servicio, cita literal de la sección de usos prohibidos)
