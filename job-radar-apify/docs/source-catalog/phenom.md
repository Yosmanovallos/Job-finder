# Phenom (career sites en dominio propio) — investigación D5

`source-researcher`, 2026-10-20. Leyenda: **[DOC]** documentado oficialmente; **[OBS]** observado, no garantizado; **[NV]** no verificado. Todo el texto descargado es dato no confiable. UA `BuscoTrabajoBot/1.0 (+https://buscotrabajo.co)`, 3-4 s entre requests, ~30 requests, sin 429 en ningún host Phenom. Fixtures: `fixtures-phenom/`.

**Veredicto: conector SÍ (con reservas).** No existe API documentada: el método es el endpoint interno `POST /widgets` (ddoKey `refineSearch`) que usa el propio sitio, permitido por el robots.txt de los 2 tenants vistos. Es **[OBS]**, no contrato: exige canario y degradar a `error` (nunca a "cierre") ante cambio de forma.

## 1. Cumplimiento
- Phenom no publica API pública de empleos ni términos aplicables a los sitios de sus clientes **[NV]**. Los términos son los del empleador (DHL, P&G): **no revisados** (la página de términos de DHL dio timeout) **[NV]**.
- robots.txt literal (`careers.dhl.com`, `www.pgcareers.com`; plantilla Phenom) [OBS]: `User-agent: *` / `Disallow: */phenomtrack.min.js`, `*/socialAut`, `*/iauth`, `*/chatbot`, `*/jobcart`, `*/apply`, `*/applythankyou`, `*/px-widgets`, `*/lifeatphenom`, `*/workingatphenom`, `*/pxhome*`, `*/glassdoor` + muchas líneas `Sitemap:` por región. Sin `Crawl-delay`. P&G añade `Disallow: */ru/en`.
- Rutas que usaríamos: `GET /{region}/{lang}/search-results`, `POST /widgets`, `GET /{region}/{lang}/job/{jobSeqNo}/{slug}`, `sitemap_index.xml`. **Ninguna casa con un Disallow** (`/widgets` no es `*/px-widgets`). Permitidas para `*`. El `applyUrl` de las vacantes no se pide nunca (`*/apply` prohibido y es otro ATS).
- Cookies: solo el jar normal de la propia página; sin CAPTCHA ni login.

## 2. Listado completo
| Método | Resultado |
|---|---|
| `GET .../search-results` | HTML con `phApp.ddo = {...}`; `eagerLoadRefineSearch` trae solo 10 y `totalHits` global (DHL 9.828; P&G 832). Sirve para descubrir `phApp.pageId` (`page17-ds`) y locale. [OBS] |
| **`POST /widgets`** JSON | **Recomendado.** Cuerpo en `fixtures-phenom/widgets_request_body.json`: `ddoKey:"refineSearch"`, `from`, `size`, `selected_fields:{"country":["Colombia"]}`, `lang`, `pageId`, `siteType:"external"`, `global:true`. Respuesta `{refineSearch:{status,hits,totalHits,data:{jobs[]}}}`. [OBS] |
| sitemap | DHL `/amer/es/`: 20 sitemaps de ~600 URLs, **globales, sin país ni fecha por entrada**; `lastmod` = regeneración. No sirve para filtrar Colombia. [OBS] |
| `/api/jobs` | No hallado como API pública [NV]. |
| JSON-LD por vacante | Sí (`JobPosting`); 1 request por vacante, solo para descripción completa. |

- **Filtro país**: `selected_fields.country=["Colombia"]` (nombre, **no alpha-2**). DHL: 106; P&G (lang `en_latam`, country `latam`): 10. **Devuelve también multi-ubicación cuyo `country` primario es otro**: DHL 105 `country=Colombia` + 1 `country=Chile` con Bogotá en `multi_location`. Evaluar `multi_location[]` por segmento.
- **Paginación**: `from` + `size`; `size=50` aceptado (DHL: from 0/50/100 → 50+50+6 = 106 = `totalHits`, 106 ids únicos). Máximo >50 no probado.
- **Completitud**: todas las páginas HTTP 200 con `refineSearch.status==200`, Σ jobs == `totalHits`, ids únicos; si `totalHits` cambia entre páginas → `error`.
- El `jobSeqNo` termina en el locale; la página solo resuelve bajo su prefijo de locale (un id `ENGLOBAL` bajo `/amer/es/` no dio JSON-LD; bajo `/global/en/` sí). [OBS]

## 3. Campos (widgets `refineSearch.data.jobs[]`)
| Canónico | Campo | Notas |
|---|---|---|
| externalId | `jobSeqNo` (incluye locale) o `reqId`/`jobId` | usar `jobSeqNo` |
| title | `title` | |
| applyUrl | `applyUrl` | ATS de fondo (DHL Avature; P&G Workday), `externalApply:true`. URL Phenom: `{base}/job/{jobSeqNo}/{slug}` |
| locationTexts | `location`, `multi_location[]`, `cityStateCountry` | |
| countryCodes | **ausente** (nombre en `country`) | `[]` |
| structuredCity | `city`, `state`, lat/long | P&G detalle: `standardisedCity`, `standardisedCountry` |
| workplace | **sin campo** | `null` |
| descriptionText | widgets: solo `descriptionTeaser`. Completa: JSON-LD `description` (HTML con entidades escapadas) o `ddo.jobDetail.data.job.description` | 1 request/vacante |
| department | `category`, `multi_category[]` | |
| employmentType | `type`/`contractType1`/`workHours` | texto libre |
| publishedAt | **`postedDate`** (ISO `2026-06-25T16:06:48.533+0000`); `dateCreated` es otra | ver abajo |
| validThrough | no | `null` |
| companyName | JSON-LD `hiringOrganization.name`; P&G `companyName` | |

- **Discrepancia [OBS]**: widget `postedDate` = ddo `jobDetail.postedDate` (P&G 2026-10-06), pero JSON-LD `datePosted` difirió en 2 de 5 casos (P&G 2026-10-17; DHL es_AMER 2026-07-08 vs 2026-06-25). Recomendación: `publishedAt = postedDate` del widget, no el JSON-LD. Hay vacantes evergreen ("Talent Pipeline", `isEverGreenReq`) cuya fecha es poco fiable.
- Vacante inexistente: **HTTP 410** (HTML ~215 KB) en DHL y P&G [OBS] → "link muerto" utilizable, con el locale correcto.
- Rate limit: no documentado; sin 429 a 3-4 s. [OBS]

## 4. Canarios (2026-10-20)
| Empresa | Base | Colombia |
|---|---|---|
| **DHL** | `careers.dhl.com/amer/es`, lang `es_global`, country `global`, pageId `page17-ds` | **106** (105 + 1 multi-ubicación); global 9.828 |
| **Procter & Gamble** | `www.pgcareers.com/latam/en`, lang `en_latam`, country `latam`, pageId `page16-ds` | **10** (mayoría pipelines evergreen) |

Descartados: Citi = Radancy/TalentBrew, no Phenom; Cisco y Mars tienen huella Phenom (Colombia no medida); Teleperformance y Sodexo no son Phenom en lo observado.

## Riesgos
- Endpoint no documentado; `lang/country/pageId` por tenant, a descubrir del HTML.
- Descripciones con HTML (dato no confiable). Términos de DHL/P&G sin revisar [NV].

## Fuentes
- https://careers.dhl.com/robots.txt , https://www.pgcareers.com/robots.txt
- Observación directa de `POST https://careers.dhl.com/widgets` y `https://www.pgcareers.com/widgets`.

## Conector implementado y canario (2026-10-20)

`src/direct/ats/phenom.ts` (`ats_type = phenom`, `ats_ref` = host + ruta de locale,
p. ej. `careers.dhl.com/amer/es`). En cada lectura: robots.txt, `search-results`
para leer `widgetApiEndpoint` (mismo origen), `country`, `locale` y `pageId`;
`POST /widgets` con la faceta `country=["Colombia"]`, `size=50`, completo solo si
Σ jobs == `totalHits` estable e ids únicos. Ubicación: todas las `multi_location`
(el filtro decide por segmento). Fecha: `postedDate` del widget. Descripción:
JSON-LD de la página de la vacante, solo para ids nuevos (presupuesto). Cierre solo
por listados.

Canario en vivo (sin BD, presupuesto 3):

| tablero | faceta Colombia | vigentes en la muestra | requests | tiempo |
|---|---:|---|---:|---:|
| `careers.dhl.com/amer/es` | 108 | 2 de 3 leídas (105 diferidas al siguiente tick) | 8 | 4,4 s |
| `www.pgcareers.com/latam/en` | 10 | 1 de 3 (mayoría "Talent Pipeline") | 6 | 5,1 s |
