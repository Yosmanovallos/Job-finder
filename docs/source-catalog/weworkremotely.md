# We Work Remotely — catálogo de fuente

> Fuente: **We Work Remotely (weworkremotely.com)** — listado de vacantes remotas, acceso público sin login vía RSS (nivel "feed estructurado" de la prioridad del plan §2.3) + JSON-LD `JobPosting` en la página de detalle.
> Documentación oficial consultada: <https://weworkremotely.com/remote-job-rss-feed> (página oficial "Public RSS Feed"), <https://weworkremotely.com/terms-and-conditions>, `https://weworkremotely.com/robots.txt`, `https://weworkremotely.com/sitemap.xml`.
> Última verificación empírica: 2026-07-19.

## 1. Resumen

| Aspecto | Valor |
|---|---|
| Tipo de fuente | Feed RSS público (nivel 2 de la prioridad del plan, tras API pública) + JSON-LD `JobPosting` en la página de detalle (nivel 3) |
| Host | `https://weworkremotely.com` |
| Autenticación (lectura) | Ninguna — RSS, sitemap y páginas de detalle son públicas sin login |
| Autenticación (aplicar) | El botón "Apply now" a veces requiere cuenta ("geolocked position" / "Create an account…" — observado, no documentado); no relevante porque el proyecto no auto-aplica (regla 7) |
| Paginación | **No** documentada; observado que `?page=` no cambia el resultado (§4) |
| Rate limits | No documentados (ver §5) |
| Formato | RSS 2.0 (`application/rss+xml`) con campos custom (`region`, `country`, `state`, `skills`, `category`, `type`, `expires_at`) + JSON-LD `JobPosting` en HTML de detalle |
| Cobertura | Feed general ≈96 items recientes; feeds por categoría ≈25 items; sitemap ≈1447 URLs de vacantes con `lastmod` horario — backstop de cobertura, más pesado (una petición por URL) |
| Categorías | Ninguna categoría dedicada a QA/testing ni a AI/ML (confirmado, ver §8) |
| Anti-bot | Servido tras Cloudflare (`server: cloudflare`); GET simples devuelven 200 de forma consistente en las pruebas — sin retos observados |

## 2. Endpoints / URLs

Todos son `GET`, sin autenticación:

| URL | Descripción |
|---|---|
| `https://weworkremotely.com/remote-jobs.rss` | Feed RSS con **todas** las categorías, ítems recientes |
| `https://weworkremotely.com/categories/remote-programming-jobs.rss` | Feed RSS — "All Programming" (agrega front/back/full-stack/software dev) |
| `https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss` | Feed RSS — Full-Stack Programming |
| `https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss` | Feed RSS — Back-End Programming |
| `https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss` | Feed RSS — Front-End Programming |
| `https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss` | Feed RSS — DevOps and Sysadmin |
| `https://weworkremotely.com/categories/remote-design-jobs.rss` | Feed RSS — Design |
| `https://weworkremotely.com/categories/remote-product-jobs.rss` | Feed RSS — Product |
| `https://weworkremotely.com/categories/remote-management-and-finance-jobs.rss` | Feed RSS — Management and Finance |
| `https://weworkremotely.com/categories/remote-sales-and-marketing-jobs.rss` | Feed RSS — Sales and Marketing |
| `https://weworkremotely.com/categories/remote-customer-support-jobs.rss` | Feed RSS — Customer Support |
| `https://weworkremotely.com/categories/all-other-remote-jobs.rss` | Feed RSS — "All Other Remote" (catch-all) |
| `https://weworkremotely.com/sitemap.xml` | Sitemap XML: home + hasta ~1447 URLs `/remote-jobs/<slug>` con `<lastmod>` y `<changefreq>hourly</changefreq>` |
| `https://weworkremotely.com/remote-jobs/<slug>` | Página de detalle HTML; contiene JSON-LD `JobPosting` |
| `https://weworkremotely.com/robots.txt` | robots.txt |

Todas las URLs de feeds por categoría están **listadas oficialmente** en <https://weworkremotely.com/remote-job-rss-feed> (verificado 2026-07-19, contenido textual extraído de la página: "Anyone can use the feed, all we ask is that you attribute the links back to We Work Remotely"). Esa misma página menciona una **API privada para publicar vacantes** ("Looking to post a job via the WWR API? Please reach out to hello@weworkremotely.com") — es para *emisores* de vacantes, no para consumo de datos, y requiere partnership; fuera de alcance de este catálogo.

No existe un feed de búsqueda por término: `GET /remote-jobs/search.rss?term=...` devuelve **406** (verificado). La búsqueda de texto (`/remote-jobs/search?term=QA`) solo está disponible como HTML.

## 3. Formato de respuesta

### 3.1 RSS — item completo (verificado, feed general, 2026-07-19)

```xml
<item>
  <media:content url="https://wwr-pro.s3.amazonaws.com/logos/.../logo.gif" type="image/png"/>
  <title>LawnStarter: Data Governance &amp; Platform Manager</title>
  <region>Anywhere in the World</region>
  <country></country>
  <state></state>
  <skills></skills>
  <category>All Other Remote</category>
  <type>Full-Time</type>
  <description>&lt;img .../&gt; &lt;p&gt;&lt;strong&gt;Headquarters:&lt;/strong&gt; Brazil ... (HTML-escapado, prosa completa) ...</description>
  <pubDate>Fri, 17 Jul 2026 20:07:06 +0000</pubDate>
  <expires_at>Sun, 16 Aug 2026 20:07:06 +0000</expires_at>
  <guid>https://weworkremotely.com/remote-jobs/lawnstarter-data-governance-platform-manager</guid>
  <link>https://weworkremotely.com/remote-jobs/lawnstarter-data-governance-platform-manager</link>
</item>
```

Campos por item, **verificados empíricamente**:

| Campo | Tipo | Notas |
|---|---|---|
| `title` | string | Formato **"Empresa: Título del puesto"** — no hay elemento separado para el nombre de empresa; requiere parseo determinista del prefijo antes de `": "` (frágil si el nombre de empresa contiene `:`) |
| `region` | string | Texto libre, ej. `"Anywhere in the World"` — no es un código de país/región normalizado |
| `country` | string | Observado casi siempre vacío (`""`) en la muestra |
| `state` | string | Observado vacío o con ciudad/estado de la sede de la empresa (ej. `"Stockholm"`), no del candidato |
| `skills` | string | Lista separada por comas, **observado a menudo vacío** (ej. LawnStarter: `""`); cuando está presente es texto libre sin taxonomía (ej. `"JavaScript, Node.js, React, and Full Stack Dev"`) |
| `category` | string | Una de las 9-10 categorías fijas del sitio (§8) — **no hay categoría de QA ni de AI/ML** |
| `type` | string | Observado: `"Full-Time"`, `"Contract"` |
| `description` | string | HTML-escapado (entidades), contiene la publicación completa (incluye a veces el rango salarial en prosa, ej. "Base salary: $75k-$100k/year") |
| `pubDate` | string RFC 822 | Fecha de publicación/renovación del post |
| `expires_at` | string RFC 822 | Fecha de expiración; coincide con `validThrough` del JSON-LD del detalle |
| `guid` | string (URL) | Igual al `link` — URL canónica de WWR |
| `link` | string (URL) | URL canónica pública de la vacante en weworkremotely.com — **no** es la URL externa de aplicación |
| `media:content` | atributo `url` | Logo de la empresa |

No hay campo de compañía separado, ni de compensación estructurada, ni de ubicación estructurada del candidato, ni de seniority, ni de URL de aplicación externa en el RSS.

### 3.2 JSON-LD `JobPosting` en la página de detalle (verificado, 3 vacantes distintas, 2026-07-19)

Presente en `<script type="application/ld+json">` de `GET /remote-jobs/<slug>`. **Nota técnica**: el JSON contiene saltos de línea literales dentro de strings (la `description`), lo cual **rompe un parseo JSON estricto** (`json.loads` falla con "Invalid control character"); un parser tolerante (o pre-limpieza de whitespace de control) es necesario.

Campos observados:

| Campo | Notas |
|---|---|
| `title` | Título del puesto (sin el prefijo de empresa) |
| `description` | HTML-escapado, prosa completa |
| `datePosted` | `"YYYY-MM-DD HH:MM:SS UTC"` |
| `validThrough` | Mismo formato; coincide con `expires_at` del RSS |
| `employmentType` | Ej. `"Full-Time"`, `"Contract"` |
| `directApply` | Observado siempre `"False"` (string, no boolean) en la muestra |
| `occupationalCategory` | Igual a `category` del RSS |
| `jobLocationType` | Observado `"TELECOMMUTE"` |
| `baseSalary.currency`, `.value.minValue`, `.value.maxValue`, `.value.unitText` | **Observado: `minValue`/`maxValue` = `"0"` en el 100% de la muestra (3/3)**, incluso en vacantes cuya `description` menciona un rango salarial explícito en prosa (ej. "$55,000 - $80,000 USD"). Es decir: **el campo estructurado de salario no es confiable y no debe usarse como fuente de `compensation_min/max`** salvo que sea distinto de 0 (no observado en esta muestra) |
| `applicantLocationRequirements` | Array de `{"@type":"Country","name": "<código ISO>"}` — lista extensa de países permitidos (a veces prácticamente todos los códigos ISO) |
| `hiringOrganization.name`, `.address`, `.sameAs`, `.logo` | Nombre de empresa, `address` observado como texto libre (`"Remote"`), `sameAs` = URL del sitio de la empresa |
| `identifier.value` | Slug de la vacante |
| `image` | URL del logo |

## 4. Paginación

- **No documentada** en la página oficial del feed. Observado: `GET /remote-jobs.rss?page=2` devuelve el mismo canal (mismo `<title>` de canal y mismo conteo de items) que sin el parámetro → el parámetro se ignora (observado, no garantizado).
- Feed general: 96 items en la corrida de verificación. Feeds de categoría: ~25 items (ej. `remote-programming-jobs.rss`: 25). Son ventanas de "recientes", no un histórico completo.
- El **sitemap** (`sitemap.xml`) sí cubre más volumen (~1447 URLs de vacantes con `<lastmod>` horario) pero no es RSS: es una lista plana de URLs sin metadatos de la vacante — habría que pedir cada página de detalle (HTML + JSON-LD) para extraer datos, lo cual es más pesado (nivel 3 de la prioridad, no nivel 2). Recomendado como estrategia: RSS (general + categorías relevantes) como fuente primaria de descubrimiento incremental, sitemap como backstop de cobertura si se necesita completitud.

## 5. Rate limits

- No documentados oficialmente en ninguna página consultada (RSS feed page, Terms, robots.txt).
- `robots.txt` no define `Crawl-delay`.
- Observado: peticiones GET moderadas (RSS general, 6 categorías, 3 páginas de detalle, sitemap, terms — ~15 requests en la sesión de verificación) devolvieron 200 de forma consistente, servidas vía Cloudflare (`server: cloudflare`, `cf-cache-status: DYNAMIC`) sin cabeceras `X-RateLimit-*` ni desafíos de verificación. Esto es "observado, no garantizado": Cloudflare puede introducir retos (CAPTCHA/JS challenge) ante tráfico más agresivo o patrones detectados como bot; el proyecto **no debe intentar evadirlos** (regla 8) — si aparecen, se trata como fallo duro de la fuente para ese ciclo, no como obstáculo a sortear.
- Política del adaptador (nuestra, no de WWR): 1 request al feed general + feeds de categoría relevantes por corrida; detalle HTML/JSON-LD solo de vacantes candidatas tras filtro por palabra clave; User-Agent identificable; backoff ante 429/503/5xx.

## 6. Códigos de error

Verificado empíricamente (2026-07-19):

- Slug de vacante inexistente (`/remote-jobs/nonexistent-job-slug-xyz-123`) → **301** redirect a `https://weworkremotely.com/` (no 404). **Ambiguo**: no hay forma de distinguir por código de estado "la vacante nunca existió" de "el slug cambió"; solo se sabe que ya no es accesible en esa URL.
- Feed de categoría con slug inventado (`/categories/remote-qa-jobs.rss`) → también **301** a la home, mismo patrón ambiguo.
- Búsqueda RSS (`/remote-jobs/search.rss?term=...`) → **406 Not Acceptable** (no soportado; solo HTML).
- No se observó ningún 404 explícito ni tabla de errores documentada. Tratar cualquier 301 hacia la home como señal de "recurso ya no disponible en esta URL", nunca como confirmación de que el job cerró (evidencia insuficiente sin una segunda señal — igual que la política de 2 señales negativas de Fase 3).
- Sin cabecera `Retry-After` observada en las respuestas probadas.

## 7. Mapeo al esquema `opportunity` (`Prompt_QA_AI_Opportunity_Discovery_Compliant.md`, líneas 298-336)

> Nota: el resto de catálogos de este repo (`greenhouse.md`, `lever.md`, etc.) mapean a `packages/domain/src/job/canonical-job-schema.ts`, usado por los conectores API-first ya implementados en Fase 2. Este catálogo se investiga para el flujo de descubrimiento `opportunity` descrito en `Prompt_QA_AI_Opportunity_Discovery_Compliant.md`; se mapea a **ese** esquema explícitamente, según lo solicitado. Si en una fase futura WWR se integra como fuente del pipeline principal, este mapeo tendría que rehacerse sobre `canonical-job-schema.ts` con el mismo cuidado que `greenhouse.md`.

| Campo `opportunity` | Origen en WWR | Notas |
|---|---|---|
| `opportunity_id` | — | Lo genera el pipeline (no viene de la fuente) |
| `source_name` | — | Constante `"weworkremotely"` |
| `source_url` | `link`/`guid` (RSS) o `og:url`/`<link rel="canonical">` (HTML) | URL canónica de WWR, siempre presente |
| `source_category` | `category` (RSS) / `occupationalCategory` (JSON-LD) | Una de las ~9-10 categorías fijas del sitio (§8); **no** es una categoría de QA/AI |
| `external_id` | Slug al final de `link`/`guid` (ej. `lawnstarter-data-governance-platform-manager`) | No hay un ID numérico separado; el slug es estable mientras la URL no cambie |
| `title` | `title` del JSON-LD (ya sin prefijo de empresa) o `title` del RSS **menos el prefijo `"Empresa: "`** parseado | Preferir JSON-LD si se pide el detalle; si solo se usa RSS, requiere parseo determinista del separador `": "` (primera aparición) |
| `organization` | Prefijo de `title` del RSS (antes de `": "`) o `hiringOrganization.name` del JSON-LD | JSON-LD es más confiable — evita el parseo ambiguo del RSS |
| `description` | `description` (RSS o JSON-LD), HTML-escapado | Des-escapar entidades + strip HTML para texto plano; **tratar como contenido no confiable** (regla 6) — nunca alimentar a un LLM sin delimitadores |
| `opportunity_type` | — | No provisto por la fuente; sería constante `"job"` a nivel de pipeline si aplica |
| `employment_type` | `type` (RSS) / `employmentType` (JSON-LD) | Ej. `"Full-Time"`, `"Contract"` |
| `service_category` | — | No provisto; requiere clasificación downstream (QA/AI vs. otro) — ver §8 |
| `skills` | `skills` (RSS) | **Observado con frecuencia vacío**; cuando presente, texto libre sin taxonomía — no confiar como única señal |
| `seniority` | **NO provisto** | → `unknown`; nunca inferir del título en el adaptador (regla 5) |
| `industry` | **NO provisto** | → `null` |
| `country` | `country` (RSS, casi siempre vacío) / `applicantLocationRequirements[].name` (JSON-LD, lista de códigos ISO permitidos — no es "el país del puesto" sino países elegibles para aplicar) | Distinguir explícitamente estos dos significados; no confundir "países permitidos para aplicar" con "país de la vacante" |
| `city` | `state` (RSS) — observado con datos de la sede de la empresa, no del candidato | Texto libre, poco confiable |
| `remote_status` | `region` (RSS, ej. `"Anywhere in the World"`) / `jobLocationType` (JSON-LD, observado `"TELECOMMUTE"`) | WWR es 100% remoto por diseño del sitio; aun así, texto libre — no inventar una normalización a códigos propios sin evidencia |
| `language` | **NO provisto** | → `null` |
| `compensation_min`, `compensation_max` | `baseSalary.value.minValue/maxValue` (JSON-LD) | **Observado `"0"`/`"0"` en el 100% de la muestra (3/3)**, incluso cuando la prosa menciona un rango real → nunca usar si es `0`; mapear a `null` en ese caso. Nunca derivar min/max parseando la prosa de `description` (regla 5: no inventar cifras) |
| `currency` | `baseSalary.currency` (JSON-LD) | Solo tiene sentido si `compensation_min/max` son no-cero (no observado) |
| `budget_text` | Extracto textual de `description` cuando menciona compensación en prosa (ej. `"Base salary: $75k-$100k/year"`) | Guardar como **cita textual con evidencia** (`source_url` + snippet), nunca como campo numérico parseado |
| `published_at` | `pubDate` (RSS) / `datePosted` (JSON-LD) | Normalizar a UTC ISO 8601 |
| `expires_at` | `expires_at` (RSS) / `validThrough` (JSON-LD) | Verificado cruzado en la misma vacante (LawnStarter, 2026-07-19): RSS `expires_at` = `Sun, 16 Aug 2026 20:07:06 +0000` = JSON-LD `validThrough` = `2026-08-16 20:07:06 UTC` — mismo instante, mismo formato semántico |
| `discovered_at` | — | Momento de captura del pipeline (fetch), no de la fuente |
| `contact_name` | **NO provisto** | → `null` |
| `contact_method` | **NO provisto** | → `null` |
| `application_url` | `link`/`guid` (URL canónica de WWR) siempre disponible; URL externa de aplicación **a veces** visible en el HTML de detalle (botón "Apply now" con `href` externo, ej. `https://career.proxify.io/apply?...`) | **Observado mixto**: en algunas vacantes el botón de aplicar es un enlace externo directo sin login (verificado: Proxify AB); en otras, el CTA está bloqueado tras `/job-seekers/account/login` o `/job-seekers/account/register` ("Sign in to verify your eligibility for this geolocked position." / "Create an account to view full job details.") — **observado, no garantizado**, condición no documentada oficialmente (posible antigüedad del post o configuración del cliente). El proyecto nunca crea cuentas ni inicia sesión (regla 8); cuando el enlace externo no está en el HTML público, `application_url` cae de vuelta a la URL canónica de WWR |
| `qa_relevance_score`, `ai_relevance_score`, `commercial_intent_score`, `overall_score` | — | Los calcula el pipeline de matching, no la fuente |
| `duplicate_group_id` | — | Lo calcula el pipeline de dedupe |
| `compliance_method` | — | Constante `"rss"` (si se llenó desde el feed) o `"json-ld"` (si se enriqueció desde el detalle) |
| `raw_source_reference` | El `<item>` RSS crudo o el bloque JSON-LD crudo | Para trazabilidad/evidencia |

## 8. Identificación de vacantes de QA, testing, automatización, AI/ML

**No existe categoría dedicada** en WWR para QA/testing ni para AI/ML. Las categorías fijas observadas en el sitio (nav, RSS `category`, y JSON-LD `occupationalCategory`) son únicamente:

`Full-Stack Programming`, `Front-End Programming`, `Back-End Programming`, `Software Development` (bajo "Programming"), `Design`, `DevOps and Sysadmin`, `Management and Finance`, `Product`, `Customer Support`, `Sales and Marketing`, `All Other Remote`.

Verificado con dos vacantes reales de QA:

| Vacante | `category`/`occupationalCategory` observado |
|---|---|
| "Senior QA Engineer" (Cortes 23) | `Full-Stack Programming` |
| "QA Automation Engineer — UI & API" (Toptal) | `All Other Remote` |

Es decir, la categorización la elige quien publica la vacante y **es inconsistente** para roles de QA: pueden caer en Programming, DevOps and Sysadmin o "All Other Remote" indistintamente. Lo mismo aplica a AI/ML (ej. "Senior Independent AI Engineer / Architect" y "Toptal: AI Engineers" observados bajo `All Other Remote`).

**Estrategia recomendada** (determinista, sin inferencia semántica no evidenciada):

1. Consumir el feed **general** (`remote-jobs.rss`) en vez de depender de una categoría — es la única forma de no perder vacantes de QA/AI mal categorizadas.
2. Aplicar un filtro de palabras clave determinista sobre `title` + `description` (des-escapado), ej.: `QA`, `Quality Assurance`, `Test Engineer`, `Test Automation`, `SDET`, `Manual Test`, `Automation Engineer`, `Machine Learning`, `ML Engineer`, `AI Engineer`, `Artificial Intelligence`, `LLM`, `Prompt Engineer` — como paso de descubrimiento, no como clasificación semántica final (eso es fase de matching, no de este catálogo).
3. No confiar en `skills` para el filtro: observado vacío en gran parte de la muestra.
4. El campo `category`/`occupationalCategory` puede usarse como señal secundaria (p. ej. descartar categorías claramente no técnicas como `Sales and Marketing`, `Customer Support`), pero no como filtro único, dado que QA apareció en `Full-Stack Programming` y en `All Other Remote`.
5. Dado que el feed general es una ventana de ~96 recientes y el ritmo de publicación es alto (sitemap con ~1447 URLs vivas), un polling frecuente (según regla 12, con presupuesto/backoff) es necesario para no perder vacantes que salgan de la ventana antes de ser leídas.

## 9. Términos de uso y robots

- **robots.txt** (`https://weworkremotely.com/robots.txt`, verificado 2026-07-19):
  ```
  User-agent: *
  Allow: /
  Disallow: /admin/
  Disallow: /account/
  Disallow: /job-seekers/account/
  Disallow: /job-seekers/profile/
  Disallow: /manage-company/
  Disallow: /*edit?token=/
  Disallow: /*cancel?token=/
  Sitemap: https://weworkremotely.com/sitemap.xml
  ```
  Los feeds RSS (`/remote-jobs.rss`, `/categories/*.rss`), el sitemap y las páginas de detalle (`/remote-jobs/<slug>`) **no están bloqueados**. Sí están bloqueados los paths de cuenta/administración (`/admin/`, `/account/`, `/job-seekers/account/`, `/job-seekers/profile/`, `/manage-company/`) — coherente con que el proyecto nunca necesita esas rutas (no auto-aplica, no crea cuentas).
- **Página oficial "Public RSS Feed"** (<https://weworkremotely.com/remote-job-rss-feed>, verificado 2026-07-19): declara explícitamente que el feed es de uso público — cita textual: *"Anyone can use the feed, all we ask is that you attribute the links back to We Work Remotely."* Esto es la única condición de uso explícita y documentada oficialmente para el consumo del RSS: **atribución con enlace de vuelta a We Work Remotely**. El proyecto debe conservar `source_url`/`link` apuntando a WWR en cualquier salida (Notion, exports) como forma de cumplir esta condición.
- **Términos y condiciones** (`https://weworkremotely.com/terms-and-conditions`, verificado 2026-07-19): documento genérico de ToS de plataforma (suscripciones, pagos, arbitraje JAMS/Delaware, cumplimiento de sanciones OFAC). Cláusula de propiedad intelectual relevante (cita textual): *"We Work Remotely grants to you a non-transferable, non-sublicensable, non-exclusive, revocable, limited-purpose right to access and use the Materials that we make available to you."* **No se encontró** ninguna cláusula específica sobre scraping, bots, crawling, "data mining" o límites de tasa en el texto de Terms (búsqueda dirigida por palabras clave sin resultados: `scrape`, `crawl`, `bot`, `spider`, `data mining`, `harvest`, `resell`, `exploit`). La única política operativa concreta y explícita sobre acceso programático es la de la página del RSS (atribución), que se toma como la vigente para este uso. No inventar restricciones no encontradas ni asumir permisos más amplios de los declarados.
- El proyecto igualmente aplica sus propias reglas: sin evasión de controles (Cloudflare u otros), User-Agent identificable, frecuencia moderada, sin creación de cuentas ni login (regla 8).

## 10. Riesgos y limitaciones

1. **Sin categoría de QA/AI**: requiere filtro por palabra clave sobre título+descripción del feed general; riesgo de falsos negativos/positivos que debe resolver la fase de matching, no este adaptador.
2. **`title` sin campo de empresa separado en RSS**: parseo de `"Empresa: Título"` es frágil si el nombre de empresa contiene `:` — usar JSON-LD (`hiringOrganization.name`) cuando se pida el detalle.
3. **`baseSalary` de JSON-LD no confiable**: observado siempre `0`/`0` en la muestra, incluso con salario explícito en prosa. Nunca derivar cifras parseando la prosa (regla 5); usar `budget_text` como cita, no como número.
4. **URL externa de aplicación inconsistente**: a veces visible sin login en el HTML (ej. Proxify), a veces bloqueada tras registro/login ("geolocked"/"Create an account") — condición no documentada. El adaptador nunca debe intentar sortear el login; cuando no esté disponible, usar la URL canónica de WWR como `application_url` de respaldo.
5. **Errores ambiguos (301 a home)**: no hay 404 explícito para slugs o feeds de categoría inexistentes; no se puede distinguir "nunca existió" de "cambió de URL" solo por el código de estado — igual que Greenhouse, requiere la política de "2 señales negativas antes de cerrar" de Fase 3.
6. **Ventana de recencia limitada**: feed general ≈96 items, feeds de categoría ≈25, sin paginación documentada (`?page=` observado sin efecto) → riesgo de perder vacantes entre corridas si el polling es poco frecuente frente al volumen de publicación (sitemap con ~1447 URLs vivas). Mitigación: polling frecuente con backoff acotado (regla 12) y/o uso del sitemap como backstop de cobertura (más costoso).
7. **JSON-LD no es JSON estricto**: contiene saltos de línea de control sin escapar dentro de `description`, rompe `json.loads` estándar — el parser debe tolerar esto (regex/limpieza previa) o usar un parser JSON permisivo, documentando la desviación del estándar.
8. **Cloudflare**: sin retos observados en las pruebas de este catálogo, pero es una capa de anti-bot activa (`server: cloudflare`); cualquier futuro reto/CAPTCHA debe tratarse como fallo duro de la fuente para ese ciclo, nunca evadido (regla 8).
9. **Sin rate limits documentados**: política de frecuencia moderada y backoff queda enteramente a criterio del adaptador (nuestro, no de la fuente).

---

## Notas del investigador

**Documentación oficial consultada (2026-07-19):**
- <https://weworkremotely.com/remote-job-rss-feed> — página oficial que lista todas las URLs de feeds RSS por categoría y declara la condición de uso (atribución).
- <https://weworkremotely.com/robots.txt> — reglas de acceso automatizado.
- <https://weworkremotely.com/sitemap.xml> — sitemap con ~1447 URLs de vacantes.
- <https://weworkremotely.com/terms-and-conditions> — términos generales de la plataforma.

**Verificado empíricamente (peticiones `GET` reales con User-Agent identificable, 2026-07-19):**
- `remote-jobs.rss` (200, `application/rss+xml`, 96 items, item completo inspeccionado campo por campo).
- 6 feeds de categoría confirmados con 200 (`remote-programming-jobs`, `remote-full-stack-programming-jobs`, `remote-back-end-programming-jobs`, `remote-front-end-programming-jobs`, `remote-devops-sysadmin-jobs`, `all-other-remote-jobs`), más 3 adicionales listados en la página oficial no re-verificados individualmente en esta sesión (`remote-design-jobs`, `remote-product-jobs`, `remote-management-and-finance-jobs`, `remote-sales-and-marketing-jobs`, `remote-customer-support-jobs` — mismos parámetros, mismo dominio, riesgo bajo de que difieran).
- 3 páginas de detalle con JSON-LD `JobPosting` completo inspeccionado (`cortes-23-senior-qa-engineer-2`, `toptal-qa-automation-engineer-ui-api`, `proxify-ab-senior-fullstack-developer-react-js-node-js-2`), más una cuarta (`toptal-ai-engineers`) para confirmar categorización de AI.
- Comportamiento de "Apply now" bloqueado tras login/registro observado en 2 de 3 vacantes de detalle inspeccionadas; enlace externo directo sin login observado en 1 de 3 (Proxify).
- Errores: slug inexistente → 301 a home; feed de categoría inventado (`remote-qa-jobs.rss`) → 301 a home; `search.rss?term=` → 406.
- `?page=2` en el feed general no cambia el resultado (mismo canal/conteo).

**Verificado cruzado en la misma vacante (2026-07-19):** LawnStarter — RSS `pubDate`/`expires_at` coinciden exactamente con JSON-LD `datePosted`/`validThrough` de la misma URL (mismo instante, confirmando que ambos campos representan lo mismo, no solo "mismo formato").

**Documentado pero no verificado en profundidad:** existencia y condiciones exactas de la "API para publicar vacantes" mencionada en la página del RSS (requiere contacto directo con WWR, fuera de alcance — es para emisores de vacantes, no para consumo).

**Observado, no garantizado (marcado explícitamente en el cuerpo del documento):** ausencia de rate limits/challenges de Cloudflare en las pruebas; condición que determina el bloqueo de "Apply now"; ausencia de `?page=` funcional; `baseSalary` siempre `0`/`0`.
