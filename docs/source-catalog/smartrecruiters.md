# SmartRecruiters — catálogo de fuente

> Fuente: **SmartRecruiters Posting API** (API pública de vacantes publicadas, sin autenticación para lectura).
> No confundir con la Customer API / Job API (privadas, `X-SmartToken`/OAuth) ni con el feed `/feed/publications` para partners.
> Documentación oficial: <https://developers.smartrecruiters.com/docs/posting-api> · Spec OpenAPI: <https://api.smartrecruiters.com/posting-api/v1/api-docs>
> Última verificación empírica: 2026-07-18. **Ver ADR-0002 antes de habilitar este adaptador** (robots.txt del host).

## 1. Resumen

| Aspecto | Valor |
|---|---|
| Tipo de fuente | API pública JSON |
| Host | `https://api.smartrecruiters.com` |
| Autenticación | Ninguna para GET (spec: `security: [{}, key]`) |
| Paginación | Sí — `limit` (máx **100**, se recorta silenciosamente) / `offset`, con `totalFound` |
| Rate limits | Documentados para SmartAPIs: 10 req/s, 8 concurrentes, 429 + `Retry-After` |
| Formato | JSON; `jobAd.sections.*.text` es HTML **crudo** |
| Ámbito | Por `companyIdentifier`; sin listado global |
| Ventajas | `location.remote`/`hybrid` booleanos estructurados; `experienceLevel.id` enum documentado; `releasedDate` UTC |
| Peculiaridad crítica | **Empresa inexistente devuelve 200 con `totalFound: 0`**, no 404 |

## 2. Endpoints

| Endpoint | Descripción | Params |
|---|---|---|
| `GET /v1/companies/{companyIdentifier}/postings` | Lista (`{offset, limit, totalFound, content[]}`) | `limit` (≤100), `offset`, `q`, `locationType` (`REMOTE\|HYBRID\|ONSITE\|ANY`), `country`, `city`, `department`, `language`, `releasedAfter`, `destination` |
| `GET /v1/companies/{companyIdentifier}/postings/{postingId}` | Detalle (`Posting`); acepta id o uuid | — |
| `GET /v1/companies/{companyIdentifier}/departments` | Departamentos | — |

## 3. Formato

### 3.1 Lista (`PostingItem` — en la spec TODO es opcional; tratar todo como potencialmente ausente)

Campos observados siempre: `id` (string numérica), `uuid`, `name` (título), `refNumber`, `company {identifier, name}`, `releasedDate` (ISO UTC `Z`), `location`, `ref` (URL API del detalle), `visibility` (`PUBLIC|INTERNAL`). Observados a menudo: `industry/function/typeOfEmployment/experienceLevel` (todos `{id, label}` — la spec dice `name` pero llega `label`), `customField[]`, `language {code}`. `department` puede ser `{}` vacío; `creator` puede faltar.

### 3.2 Detalle (`Posting`)

Añade: `jobId`, `applyUrl` (con `?oga=true`), `postingUrl` (página pública), `active` (bool), `jobAd.sections` — `{companyDescription, jobDescription, qualifications, additionalInformation}`, cada una `{title, text}` con `text` HTML crudo — y `compensation {min, max, currency, period: HOURLY|DAILY|WEEKLY|MONTHLY|YEARLY}` (documentado, **ausente en todos los detalles probados**).

### 3.3 `location`

`country` (ISO-2 **minúsculas**), `city` (texto libre del cliente — basura observada tipo `city: "United Kingdom"`), `region` (opcional, a veces `"REMOTE"`), `remote` (**boolean**), `hybrid` (**boolean**), `fullLocation` (observado, no documentado), `latitude/longitude` (a veces).

## 4. Paginación

`limit` máx 100 (un `limit=200` se recorta a 100 sin error). Iterar `offset += 100` mientras `offset < totalFound`. Offset fuera de rango → 200 con `content: []`. `limit` no numérico → 400 **texto plano** `Bad Request`.

## 5. Rate limits

10 req/s y 8 concurrentes documentados para SmartAPIs (429 + backoff exponencial + `Retry-After`); sin cabeceras `X-RateLimit-*` observadas en anónimo — asumir que aplican igual. Cloudflare delante. Política nuestra: ≤30 req/min, detalle solo de candidatos filtrados por lista.

## 6. Errores

- **Empresa inexistente → 200 con `totalFound: 0`** (¡no 404!): un typo es indistinguible de "sin vacantes". Verificado: `bosch` (typo) 0 vs `BoschGroup` 4764.
- Posting inexistente → 404 JSON `{id, httpCode: 404, code: "RESOURCE_NOT_FOUND", message}`.
- Cruce empresa/posting → 400 `ILLEGAL_ARGUMENT`.
- Errores en dos formatos (JSON estructurado y texto plano): no asumir JSON.

## 7. Mapeo al schema canónico

| Campo canónico | Campo SmartRecruiters | Notas |
|---|---|---|
| `sourceId` | — | `smartrecruiters:<companyIdentifier>` |
| `sourceJobId` | `id` | string numérica tal cual |
| `sourceUrl` | endpoint de detalle | |
| `canonicalUrl` / `applyUrl` | `postingUrl` / `applyUrl` (detalle) | |
| `titleRaw` | `name` | |
| `seniority` | `experienceLevel.id` | **Solo mapeo determinista de ids documentados**: `internship`→intern, `entry_level`→entry, `director`→director, `executive`→executive; `associate`/`mid_senior_level`/`not_applicable`/ausente → `unknown` (ampliar requiere ADR). Mapear por `id`, nunca por `label` (localizable) |
| `companyNameRaw` | `company.name` | fallback: configurado / identifier |
| `descriptionText` | `jobAd.sections` en orden company→job→qualifications→additional, `.text` → strip HTML | Dato adversarial (regla 6) |
| `locations[].raw` | `location.fullLocation` (fallback: `city, region, country`) | |
| `locations[].city/region` | `location.city/region` | texto del cliente, puede ser basura; no derivar país de `city` |
| `locations[].countryCode` | `location.country` → MAYÚSCULAS | |
| `workMode` | `remote`/`hybrid` booleanos | `remote∧¬hybrid`→remote; `hybrid∧¬remote`→hybrid; `¬remote∧¬hybrid`→onsite (el propio filtro de la API modela `REMOTE\|HYBRID\|ONSITE`); ambos true o ausentes → unknown |
| `employmentTypes` | `[typeOfEmployment.label]` | ausente → `[]` |
| `compensation` | `compensation` (detalle) | si viene: min/max/currency, `period` enum → minúsculas, `source: "explicit"`; ausente (lo habitual) → unknown |
| `visaSponsorship` | **NO provisto** | → `"unknown"` |
| `publishedAt` | `releasedDate` | ya UTC |
| `expiresAt` | **NO provisto** | → `null` |
| `status` | `active` (detalle) | true → active |
| `extractionMethod` / confianza | — | `"api"` / 0.95 |
| `evidence` | — | `name`/`fullLocation`/secciones con `postingUrl` |

## 8. Descubrimiento de empresas

Por `companyIdentifier` (slug de `jobs.smartrecruiters.com/<identifier>/...`; case-insensitive observado). Verificado 2026-07-18:

| Identifier | Estado | totalFound |
|---|---|---|
| `smartrecruiters` | OK 200 | 9 |
| `BoschGroup` | OK 200 | 4764 |
| `Devoteam` | OK 200 | 1058 |
| `Visa` | OK 200 | 2 |
| `bosch`, `ikea`, `mcdonalds`, `adidas`, `ubisoto` | 200 **vacío** (indistinguible de "sin vacantes") | 0 |

Canary recomendado: `smartrecruiters` (su propio board, pequeño). Al dar de alta una fuente, exigir una primera corrida con `totalFound > 0` verificada por humano; alertar si cae a 0 de golpe.

## 9. Términos y robots (ver ADR-0002)

- La spec y la doc describen la API como pública para career sites de terceros. Sin términos específicos de la Posting API; términos generales en smartrecruiters.com/legal.
- **`api.smartrecruiters.com/robots.txt`: `User-agent: * / Disallow: /`** con `Allow: /v1/companies/` solo para LinkedInBot. Contradice la doc pública. Decisión registrada en **ADR-0002**: consumo del API documentado ≠ crawling, pero el adaptador va **deshabilitado por defecto** y el usuario lo habilita tras leer esto.

## 10. Riesgos y limitaciones

1. 200 vacío para empresa inexistente: fuente que "muere" sin error — alertar transiciones N>0 → 0.
2. robots.txt contradictorio (ADR-0002): opt-in explícito.
3. Detalle = 1 request por posting; empresas enormes (BoschGroup 4764) → filtrar por lista y pedir detalle solo de candidatos.
4. `city`/`region` con datos sucios; booleanos `remote`/`hybrid` sí confiables.
5. Spec sin `required`: todo opcional; `department.id` cambia de tipo entre lista y detalle.
6. `compensation` casi siempre ausente.
7. HTML crudo en `jobAd`; errores en dos formatos; Cloudflare puede interponer 403/429.

---

## Notas del investigador

**Doc oficial:** posting-api (overview), api-docs (spec OpenAPI 3.1 — fuente del enum `experienceLevel.id`: `associate|director|entry_level|executive|internship|mid_senior_level|not_applicable`, del máx `limit=100`, de `security: [{}, key]` y del schema `Compensation`), rate-limiting y throttling-policies (10 req/s, 8 concurrentes, 429/backoff/Retry-After), legal. Descartada get-job-postings (otro endpoint, para partners).

**Verificado empíricamente (2026-07-18):** listas de smartrecruiters/BoschGroup/Devoteam/Visa; recorte de limit; iteración offset hasta totalFound (1058); offset fuera de rango → 200 vacío; detalle por id y uuid con jobAd HTML crudo; 404 RESOURCE_NOT_FOUND; 400 ILLEGAL_ARGUMENT (cruce) y 400 texto plano (limit inválido); empresa inexistente → 200 vacío; sin X-RateLimit-*; ETag débil; robots.txt de ambos hosts.

**Documentado no verificado:** filtros (`q`, `locationType`, `releasedAfter`…), `Accept-Language`, sección `videos`, `compensation` con valores reales, 429/Retry-After.
