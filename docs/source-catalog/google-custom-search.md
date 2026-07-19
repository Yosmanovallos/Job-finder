# Google Custom Search JSON API (Programmable Search Engine) — catálogo de fuente

> Fuente candidata: **Custom Search JSON API** (`www.googleapis.com/customsearch/v1`), motor de
> *discovery* de señales de demanda pública (no un ATS ni una vacante estructurada).
> Documentación oficial: <https://developers.google.com/custom-search/v1/overview>,
> <https://developers.google.com/custom-search/v1/using_rest>,
> <https://developers.google.com/custom-search/v1/reference/rest/v1/cse/list>
> Vía obligatoria: llamar a la API oficial de Google. **Nunca** scrapear
> `google.com/search` (viola ToS de Google Search; distinto de esta API).
> Última verificación: 2026-07-19.

## 1. Resumen

| Aspecto | Valor |
|---|---|
| Tipo de fuente | API pública JSON de pago con cuota gratis (nivel "API pública" del plan §2.3, pero de bajo volumen) |
| Host | `https://www.googleapis.com/customsearch/v1` |
| Autenticación | API key (`key`) + Search Engine ID (`cx`) de un Programmable Search Engine |
| **Disponibilidad (crítico)** | **Cerrada a clientes nuevos**; descontinuación anunciada para **1 de enero de 2027** (documentado en la overview oficial) |
| Cuota gratis | **100 queries/día** |
| Costo adicional | **$5 USD por 1000 queries**, hasta **10 000 queries/día como tope máximo absoluto** (con o sin pago) |
| Resultados por request | `num`: 1–10 (máx. 10) |
| Resultados totales alcanzables por query | `start + num ≤ 100` → **máximo 100 resultados por consulta** |
| `pagemap`/JSON-LD | No garantiza `JobPosting` (subconjunto documentado de tipos schema.org no lo incluye) |
| Términos de uso | ToS de PSE prohíbe crawl/spider/almacenamiento no transitorio de "Results" — aplicable también a la JSON API (ver §7). **Por-verificar su alcance exacto para uso interno en base de datos** |
| Alternativa oficial de migración de Google | Vertex AI Search / "Agent Search" — orientada a *site search* de hasta 50 dominios, **no** sustituye el descubrimiento en toda la web abierta |

## 2. Endpoint y autenticación

- Endpoint único: `GET https://www.googleapis.com/customsearch/v1`
  (fuente: <https://developers.google.com/custom-search/v1/using_rest>).
- Requiere:
  - `key`: API key de un proyecto de Google Cloud/API Console con la Custom Search API habilitada.
  - `cx`: ID del Programmable Search Engine (PSE) — se crea y gestiona en
    <https://programmablesearchengine.google.com/controlpanel/all>.
- Para buscar en toda la web (no solo dominios específicos configurados): en el panel del PSE,
  sección **Overview → Search features**, activar el interruptor **"Search the entire web"**
  (documentado en <https://support.google.com/programmable-search/answer/70392>). Nota: hilos de
  la comunidad de soporte de Google reportan restricciones recientes (2026) a esta opción para
  engines nuevos y un límite de 50 dominios en modo *site search*; **no confirmado en doc oficial
  con fecha exacta — marcar como "observado, no garantizado"**.
- Aun con "Search the entire web" activo, la documentación de soporte aclara que el PSE
  **prioriza** resultados de los sitios configurados y que el índice al que accede es un
  **subconjunto** del índice completo de Google Web Search (sin Oneboxes, resultados en tiempo
  real, *universal search*, ni personalización) — fuente:
  <https://support.google.com/programmable-search/answer/70392>.
- Existe también la **Custom Search Site Restricted JSON API**
  (<https://developers.google.com/custom-search/v1/site_restricted_api>), limitada a ≤10 sitios
  fijos y que exige que "Search the entire web" esté **OFF**. No aplica a nuestro caso de uso
  (discovery abierto).

## 3. Parámetros de query (documentados, `cse.list`)

Fuente: <https://developers.google.com/custom-search/v1/reference/rest/v1/cse/list>.

| Parámetro | Tipo | Notas oficiales |
|---|---|---|
| `q` | string | Término(s) de búsqueda; longitud máx. de request 2048 caracteres |
| `cx` | string | ID del Programmable Search Engine |
| `key` | string | API key |
| `num` | integer | "Valid values are integers between 1 and 10, inclusive" — máx. 10 por request |
| `start` | uint32 | Índice del primer resultado; la API **"never returns more than 100 results"** |
| `dateRestrict` | string | Restringe por antigüedad: `d[N]`, `w[N]`, `m[N]`, `y[N]` (días/semanas/meses/años) |
| `gl` | string | Geolocalización del usuario final, código de país de 2 letras |
| `lr` | string | Restringe por idioma del documento, ej. `lang_en`, `lang_es` |
| `siteSearch` | string | Dominio a incluir/excluir |
| `siteSearchFilter` | enum `i`\|`e` | Incluir (`i`) o excluir (`e`) el dominio de `siteSearch` |
| `exactTerms` | string | Frase que todos los documentos deben contener |
| `excludeTerms` | string | Palabra/frase que no debe aparecer |
| `fileType` | string | Restringe por extensión de archivo |
| `rights` | string | Filtro por licencias Creative Commons |
| `safe` | enum `active`\|`off` | SafeSearch |
| `sort` | string | Expresión de orden (ej. por fecha) |

El valor por defecto de `num` si se omite **no está documentado explícitamente** en la página de
referencia consultada — por-verificar empíricamente antes de depender de él (asumir siempre pasar
`num` explícito).

## 4. Formato de respuesta

Fuente: <https://developers.google.com/custom-search/v1/reference/rest/v1/Search>.

Estructura de nivel superior: `kind`, `url` (plantilla OpenSearch), `queries` (`request`,
`nextPage`, `previousPage` — cada uno con `totalResults`, `startIndex`, etc.), `context` (nombre
del engine y facetas), `searchInformation` (`searchTime`, `totalResults`), `spelling`
(corrección sugerida), `promotions`, y `items[]`.

Cada elemento de `items[]`:

| Campo | Notas |
|---|---|
| `title` / `htmlTitle` | Texto plano / HTML del título |
| `link` | URL completa del resultado |
| `displayLink` | URL abreviada para mostrar |
| `snippet` / `htmlSnippet` | Fragmento de texto (plano / HTML) |
| `cacheId` | Identificador de la versión cacheada de Google (no la usamos: ver §7 ToS) |
| `formattedUrl` / `htmlFormattedUrl` | Variantes de URL para mostrar |
| `pagemap` | Datos estructurados extraídos de la página (ver abajo) |
| `mime`, `fileFormat` | Cuando el resultado es un archivo |
| `image` | Metadatos de imagen si aplica |
| `labels` | Etiquetas de refinamiento |

### `pagemap` y JSON-LD — limitación importante

Documentado en <https://developers.google.com/custom-search/docs/structured_data>: `pagemap`
puede incluir PageMap explícito de la página, `metatags` generados automáticamente de tags
`<meta>`, e información de "rich snippets" extraída de JSON-LD/Microformats/RDFa/Microdata —
pero **solo para un subconjunto documentado de tipos schema.org** (el árbol de tipos de `Event`,
`ClaimReview`, `EducationalOrganization`, entre otros listados oficialmente). **`JobPosting` no
forma parte de ese subconjunto documentado.** Conclusión: no asumir que `pagemap` traerá una
vacante estructurada aunque la página de origen tenga JSON-LD `JobPosting` — un resultado de esta
API debe tratarse siempre como **señal/lead a partir de `title`+`snippet`+`link`**, nunca como una
vacante ya parseada.

## 5. Paginación

- `num` (resultados por request): 1–10, documentado.
- `start` (índice del primer resultado): la doc dice explícitamente que la API **"will never
  return more than 100 results"**. En la práctica esto significa `start + num ≤ 100` →
  **10 páginas de 10 resultados como máximo por consulta** (`start` = 1, 11, 21, ... 91).
- No existe forma documentada de superar los 100 resultados totales por una misma `q`/`cx`; para
  más cobertura hay que variar los términos de búsqueda (fecha, sitio, frase), no paginar más allá.

## 6. Cuotas, precios y disponibilidad (crítico)

Fuente primaria, citada verbatim de <https://developers.google.com/custom-search/v1/overview>
(consultada 2026-07-19):

> "The Custom Search JSON API is closed to new customers. Vertex AI Search is a favorable
> alternative for searching up to 50 domains."
>
> "Custom Search JSON API provides 100 search queries per day for free. If you need more, you may
> sign up for billing in the API Console. Additional requests cost $5 per 1000 queries, up to
> 10k queries per day."

Puntos clave:

1. **Cerrada a clientes nuevos.** Reportes de terceros (foros de desarrolladores de Google,
   2026) describen errores `403 PERMISSION_DENIED` al intentar habilitar la API en proyectos
   nuevos. Esto es consistente con el aviso oficial pero **no está verificado empíricamente por
   mí** (no intenté habilitarla) — marcar "observado por terceros, no verificado directamente".
2. **Fecha de descontinuación: 1 de enero de 2027** para clientes existentes, según el mismo
   aviso oficial.
3. Cuota gratis: 100 queries/día. Costo: $5/1000 queries adicionales. **Tope duro: 10 000
   queries/día**, incluso pagando — no hay forma de superar este límite diario.
4. Alternativa recomendada por Google (Vertex AI Search / "Agent Search") está orientada a
   *site search* interno de hasta 50 dominios propios — **no reemplaza** un caso de uso de
   descubrimiento en la web abierta como el de este proyecto. Cualquier cifra sobre Vertex debe
   tratarse como "por-verificar".

**Implicación para el proyecto**: antes de invertir en un conector, confirmar si ya existe una
API key con acceso habilitado (de antes del cierre a nuevos clientes). Si no existe, esta fuente
**no es viable de dar de alta hoy**, independientemente del resto de hallazgos.

## 7. Términos de uso (crítico — no resuelto, marcar "por-verificar")

Tres documentos aplican simultáneamente, según los propios "Custom Search JSON API Additional
Terms of Service" (<https://developers.google.com/custom-search/terms>, verbatim, consultado
2026-07-19):

> "To use this Custom Search JSON API (the "API"), you must accept the Google APIs Terms of
> Service ("API ToS"), the Programmable Search Engine Terms of Service, and these Custom Search
> JSON API Additional Terms of Service (the "Additional Terms")."

### 7.1 Custom Search JSON API Additional Terms (<https://developers.google.com/custom-search/terms>)

Solo cubre cargos/facturación y política de descontinuación (avisos de cambios incompatibles);
**no menciona** almacenamiento, caché, scraping ni republicación.

### 7.2 Google APIs Terms of Service (<https://developers.google.com/terms>)

Cláusulas relevantes (sección "Prohibitions"):

> "keep cached copies longer than permitted by the cache header"
> "Scrape, build databases, or otherwise create permanent copies of such content"
> "you agree to display any attribution(s) required by Google as described in the documentation
> for the API"

### 7.3 Programmable Search Engine Terms of Service (<https://support.google.com/programmable-search/answer/1714300>)

Sección **"1.4 Appropriate Conduct"**, verbatim:

> "You shall not, and shall not allow any third party to: ... (l) "crawl", "spider", index or in
> any non-transitory manner store or cache information obtained from the Service (including, but
> not limited to, Results, or any part, copy or derivative thereof)"

Y en "1.3 Your Obligations":

> "You may not in any way frame, cache or modify the Results produced by Google, except as
> otherwise agreed to between You and Google."

**Contexto**: el documento define "Site" como el sitio donde se coloca el widget de la caja de
búsqueda y "End User" como quien teclea la consulta — está redactado pensando en el producto
embebible, no explícitamente en el uso server-side de la JSON API. **Sin embargo**, los Términos
Adicionales de la JSON API (§7.1) declaran expresamente que el usuario de la API queda sujeto a
este mismo documento, sin excepción.

**Conclusión (marcada "por-verificar", no resuelta aquí)**: no está claro si guardar
`title`/`link`/`snippet` en base propia (aunque sea para revisión humana interna) constituye
"almacenamiento no transitorio" prohibido por 1.4(l). Es decisión de interpretación legal del
equipo/usuario antes de construir un conector persistente.

**Mitigación recomendada (compatible con AGENTS.md regla 8)**: usar esta API estrictamente como
**descubrimiento de URLs candidatas** — obtener solo `link`, re-obtener cada página desde su
propia fuente por el método más ligero permitido (feed, JSON-LD, HTML, plan §2.3), y **no
persistir el `title`/`snippet` de Google** como registro almacenado.

### 7.4 Distinción explícita: esto NO es scraping de la SERP

Esta investigación cubre exclusivamente el uso de la **API oficial JSON** (`googleapis.com`) con
`key`/`cx` válidos. **No** cubre ni recomienda extraer resultados de `google.com/search`, lo cual
violaría los ToS de Búsqueda de Google y las reglas del proyecto (AGENTS.md regla 8).

## 8. Códigos de error

- La referencia oficial de `cse.list` **no documenta** tabla de errores específicos (verificado
  2026-07-19).
- Se puede asumir comportamiento genérico de Google APIs (`400`, `403` con
  `dailyLimitExceeded`/`rateLimitExceeded`, `429`, `5xx`) por convención — **no confirmado para
  este endpoint; por-verificar empíricamente**.
- Sin límite de QPS documentado separado del tope diario; solo confirmado el tope diario.

## 9. Mapeo al schema `opportunity` (Prompt_QA_AI_Opportunity_Discovery_Compliant.md, líneas 298-336)

Un resultado de esta API es una **señal/lead**, no una vacante estructurada. La mayoría de campos
resuelven a `null`/`unknown` salvo un paso posterior humano o de re-fetch a la fuente original.

| Campo `opportunity` | Origen en la respuesta | Notas |
|---|---|---|
| `opportunity_id` | — | Generado por el pipeline |
| `source_name` | — | `"google-custom-search"` |
| `source_url` | `link` | URL del resultado (candidata a re-fetch) |
| `source_category` | — | `"search-signal"` |
| `external_id` | `cacheId` o `link` normalizada | `cacheId` sin garantía de estabilidad — opcional |
| `title` | `title` | Texto de Google, no del emisor — confianza baja |
| `organization` | **NO provisto** | → `null`; requiere re-fetch o inferencia humana |
| `description` | `snippet` | Truncado por Google — nunca tratar como lead completo |
| `opportunity_type` | **NO provisto** | → `unknown` |
| `employment_type`, `service_category`, `skills`, `seniority`, `industry` | **NO provisto** | → `null`/`[]`; extracción semántica posterior |
| `country`, `city`, `remote_status` | **NO provisto** | `gl`/`lr` filtran la búsqueda, no describen el resultado |
| `language` | Inferible de `lr` de la query | Parámetro de búsqueda, no dato del lead |
| `compensation_*`, `currency`, `budget_text` | **NO provisto** | → `null` |
| `published_at` | **NO fiable** | `pagemap.metatags` a veces; nunca inventar |
| `discovered_at` | — | Timestamp de la llamada |
| `contact_name`, `contact_method` | **NO provisto** | → `null` |
| `application_url` | `link` | |
| `qa_relevance_score`, `ai_relevance_score`, `commercial_intent_score`, `overall_score` | — | Calculados aguas abajo |
| `duplicate_group_id` | — | Vía `packages/dedupe` sobre `link` normalizado |
| `compliance_method` | — | `"official-api"` |
| `raw_source_reference` | — | Ver §7: decidir si se guarda el `item` crudo o solo el `link` |

**Conclusión de mapeo**: de ~34 campos, esta API llena de forma directa solo `title`,
`description` (parcial) y `link`. Funciona como **generador de candidatos de URL**, no como fuente
de datos de vacante.

## 10. Uso de las plantillas de query (Prompt, líneas 174-190)

Las plantillas (`"looking for" "{{SERVICE}}" "{{LOCATION}}"`, `site:greenhouse.io "{{SERVICE}}"`,
`"buscamos" "{{SERVICE}}" remoto`, etc.) son compatibles con `q` sin modificación.

Si el equipo decide usar esta fuente pese a §6/§7:

1. Usar `site:` para descubrir *nuevos* `board_token` de las fuentes ya soportadas
   (`site:boards.greenhouse.io`, `site:jobs.ashbyhq.com`), no como sustituto de los conectores
   API-first (Fase 2).
2. Las plantillas de señal en lenguaje natural solo funcionan con **"Search the entire web"**
   activo.
3. Usar `dateRestrict` (`d7`, `m1`) para acotar a señales recientes.
4. Presupuestar: ~16 plantillas × 2 idiomas × variaciones agotan la cuota gratuita (100/día) en
   menos de un día; rotar/priorizar, no ejecutar todo a diario.
5. Requiere decisión explícita del equipo sobre (a) construir sobre una API en descontinuación y
   (b) resolver la ambigüedad de 1.4(l) antes de persistir nada.

## 11. Riesgos y limitaciones

1. **Cerrada a nuevos clientes + descontinuación 1-ene-2027** (documentado): domina sobre todo lo
   demás.
2. **Tope de 100 resultados/consulta**: bajo para discovery a escala.
3. **Cláusula ToS de no-almacenamiento (§7), no resuelta**: máximo riesgo de cumplimiento.
4. **`pagemap` sin garantía de `JobPosting`**: no sirve como fuente estructurada de vacantes.
5. **`snippet` truncado**: re-obtener la página original por la vía más ligera permitida.
6. **Sin QPS ni tabla de errores documentada**: backoff genérico acotado (AGENTS.md regla 12).
7. **Vertex AI Search no cubre el caso de uso** (site search ≤50 dominios): migrar exige otra
   fuente distinta.

---

## Notas del investigador

**Documentación oficial consultada (2026-07-19)**: overview (cuota, precio, cierre a nuevos
clientes, descontinuación 2027), using_rest (endpoint, `key`/`cx`/`q`), reference cse.list (tabla
de parámetros, tope 100), Search (schema de respuesta), structured_data (`pagemap`, exclusión de
`JobPosting`), custom-search/terms (Additional Terms — `curl` directo), PSE ToS answer/1714300
(cláusula 1.4(l), `curl` directo), answer/70392 ("Search the entire web").

**Verificado directamente vía `curl`**: cláusula 1.4(l), 1.1/1.3 de la PSE ToS y preámbulo de los
Additional Terms de la JSON API.

**Por-verificar**: disponibilidad de "Search the entire web" para engines nuevos; códigos de
error de `cse.list`; QPS; si Google concede acceso a proyectos nuevos; interpretación legal final
de 1.4(l).
