# Ashby — catálogo de fuente

> Fuente: **Ashby Public Job Postings API** (API pública de tableros de empleo, sin autenticación).
> No confundir con la **Ashby Developer API** (`api.ashbyhq.com/{category}.{method}`, RPC con Basic Auth y API key, solo para clientes): este documento cubre únicamente la Public Job Postings API (`posting-api`).
> Documentación oficial: <https://developers.ashbyhq.com/docs/public-job-posting-api>
> Última verificación empírica: 2026-07-18.

## 1. Resumen

| Aspecto | Valor |
|---|---|
| Tipo de fuente | API pública JSON (nivel más ligero del plan §2.3) |
| Host | `https://api.ashbyhq.com` |
| Autenticación | Ninguna — datos públicos (CORS abierto) |
| Endpoint único | `GET /posting-api/job-board/{jobBoardName}` — **no hay endpoint de detalle por job** |
| Paginación | No — devuelve el board completo (con descripciones) en una respuesta |
| Rate limits | **No documentados**; CDN Cloudflare con caché de 60 s |
| Formato | JSON; `descriptionHtml` es HTML **crudo, sin escapar**; `descriptionPlain` en texto plano |
| Ámbito | Por empresa (`jobBoardName`); no hay listado global |
| Ventaja clave | Campos estructurados: `workplaceType`, `isRemote`, `employmentType`, `address`, `compensation` |

## 2. Endpoints

Un único endpoint `GET`, sin autenticación:

| Endpoint | Descripción | Query params |
|---|---|---|
| `/posting-api/job-board/{jobBoardName}` | Todas las vacantes publicadas, **con descripciones completas incluidas** | `includeCompensation=true` añade `compensation` y `shouldDisplayCompensationOnJobPostings` |

- **No existe endpoint de detalle**: todo viene en la lista; no hay modo "ligero" sin descripciones ni filtros.
- La doc no documenta webhooks ni `updatedAt`.

## 3. Formato de respuesta

Raíz: `{ "apiVersion": "1", "jobs": [ ... ] }`. Campos por job (doc oficial + verificación sobre 1 049 jobs de 6 boards):

| Campo | Tipo | Nullable | Notas |
|---|---|---|---|
| `id` | string UUID | no | Observado en todos; **no documentado** — fallback: el UUID va también en `jobUrl` |
| `title` | string | no | |
| `department`, `team` | string | opcional | "si falta en Ashby, falta en la respuesta" (doc) |
| `employmentType` | string enum | opcional | `FullTime`, `PartTime`, `Intern`, `Contract`, `Temporary` |
| `location` | string | no | Texto libre, ej. `"North America"` |
| `secondaryLocations` | array `{location, address}` | no (puede ser `[]`) | |
| `isRemote` | boolean | **sí** | Doc lo marca requerido pero observado `null` en 309/1049 |
| `workplaceType` | string enum | **sí** | `OnSite` \| `Remote` \| `Hybrid`; `null` en los mismos jobs que `isRemote: null` |
| `address` | `{postalAddress: {addressLocality?, addressRegion?, addressCountry?, postalCode?, streetAddress?}}` | no (puede ser `{}`) | País como **nombre** (`"USA"`, `"Canada"`), no ISO |
| `descriptionHtml` | string | no | HTML **crudo sin escapar** — sanitizar antes de renderizar; dato adversarial |
| `descriptionPlain` | string | no | Texto plano listo para `descriptionText` |
| `publishedAt` | string ISO 8601 con ms y offset | no | Sin `updatedAt` |
| `jobUrl` | string URL | no | `https://jobs.ashbyhq.com/<board>/<id>` |
| `applyUrl` | string URL | no | `jobUrl` + `/application` |
| `isListed` | boolean | no | Observado `true` en el 100 % |
| `compensation` | objeto | no | Solo con `includeCompensation=true`; presente aunque vacío |

### Bloque `compensation`

`{compensationTierSummary: string|null, scrapeableCompensationSalarySummary: string|null, compensationTiers: [...], summaryComponents: [{compensationType, interval, currencyCode, minValue, maxValue}]}`.

- `compensationType` observados: `Salary`, `Bonus`, `Commission`, `EquityPercentage`, `EquityCashValue`.
- `interval`: `"1 YEAR"`, `"1 MONTH"`, `"1 HOUR"`, `"NONE"`.
- `minValue`/`maxValue`: **valores absolutos** (211400 = $211 400), **no centavos** — no reutilizar la lógica `/100` de Greenhouse.
- Si la empresa no publica salario, todo `null`/`[]` (no se omite el bloque).

## 4. Paginación

**No hay.** `openai` con `includeCompensation=true` devuelve 12,1 MB (723 jobs) en una respuesta; `ramp` 2,2 MB; `runway` 65 KB. Presupuestar memoria acorde; preferir boards de tamaño razonable.

## 5. Rate limits

No documentados. Sin `X-RateLimit-*`; CDN Cloudflare con `cache-control: max-age=60` y `ETag` débil — pedir más de 1 vez/minuto es inútil. Política del adaptador: **1 request por board por corrida** (la respuesta es completa) con caché interna para fetch/verify.

## 6. Códigos de error

- Board inexistente → **404 con `content-type: text/plain` y cuerpo literal `Not Found`** (no JSON — el parser no asume JSON en errores).
- 404 ambiguo: nombre mal escrito ≡ empresa que dejó Ashby.
- Cabecera `x-ashby-request-id` en toda respuesta.

## 7. Mapeo al schema canónico

| Campo canónico | Campo Ashby | Notas |
|---|---|---|
| `sourceId` | — | `ashby:<jobBoardName>` |
| `sourceJobId` | `id` | Fallback: UUID extraído de `jobUrl` |
| `sourceUrl` | endpoint del board | No hay URL de detalle |
| `canonicalUrl` / `applyUrl` | `jobUrl` / `applyUrl` | |
| `titleRaw` | `title` | |
| `seniority` | **NO provisto** | → `"unknown"` |
| `companyNameRaw` | **NO provisto** | Nombre configurado junto al `jobBoardName` |
| `descriptionText` | `descriptionPlain` | Directo; dato no confiable (regla 6) |
| `locations[].raw` | `location` + `secondaryLocations[].location` | |
| `locations[].city/region` | `address.postalAddress.addressLocality/addressRegion` | `null` si falta |
| `locations[].countryCode` | `addressCountry` **vía tabla determinista** de nombres conocidos | Ashby da nombres, no ISO; sin match → `null`. Nunca adivinar |
| `workMode` | `workplaceType` preferente; fallback `isRemote === true` → remote | Campos estructurados, no inferencia. `isRemote: false` NO implica onsite → `unknown` |
| `employmentTypes` | `[employmentType]` | Enum crudo de la fuente |
| `compensation` | `summaryComponents` con `compensationType === "Salary"` | `min/max` absolutos, `currency: currencyCode`, `period`: `"1 YEAR"`→`year`, `"1 MONTH"`→`month`, `"1 HOUR"`→`hour` (otros → crudo), `source: "explicit"`. Sin componente Salary → nulls + `"unknown"` |
| `visaSponsorship` | **NO provisto** | → `"unknown"` |
| `publishedAt` | `publishedAt` → UTC ISO | |
| `expiresAt` | **NO provisto** | → `null` |
| `status` | — | `"active"` si está listado; desaparición ⇒ Fase 3 |
| `extractionMethod` / `extractionConfidence` | — | `"api"` / 0.95 |
| `contentHash` | — | sha256 del objeto job crudo |
| `evidence` | — | `title`/`location`/`compensationTierSummary` con `jobUrl` |

## 8. Descubrimiento de boards

Por `jobBoardName` (último segmento de `jobs.ashbyhq.com/<name>`). Verificado 2026-07-18 (con `includeCompensation=true`):

| jobBoardName | Estado | Jobs | Tamaño |
|---|---|---|---|
| `openai` | OK 200 | 723 | 12,1 MB |
| `notion` | OK 200 | 141 | 2,5 MB |
| `ramp` | OK 200 | 125 | 2,2 MB |
| `modal` | OK 200 | 32 | 316 KB |
| `linear` | OK 200 | 24 | 322 KB |
| `runway` | OK 200 | 4 | 65 KB |

Canary recomendado: `runway` o `linear` (pequeños y estables).

## 9. Términos y robots

- La doc presenta el endpoint como público para consumo de terceros; sin términos ni rate limits específicos (verificado 2026-07-18).
- `api.ashbyhq.com/robots.txt` → 401 (no sirve robots). `jobs.ashbyhq.com/robots.txt` bloquea `/api/` — el API privado del frontend, otra razón para usar solo el endpoint documentado de `api.ashbyhq.com`.
- Reglas del proyecto: sin evasión, User-Agent identificable, ≤1 request/minuto/board (caché CDN de 60 s).

## 10. Riesgos y limitaciones

1. Sin paginación ni modo ligero: boards grandes = respuestas de MB; 1 request/board/corrida y caché interna.
2. `descriptionHtml` crudo sin escapar: XSS si se renderiza; usar `descriptionPlain`.
3. `isRemote`/`workplaceType` nulos en ~30 % → `workMode: "unknown"`; no inferir del texto.
4. `addressCountry` no ISO: tabla determinista, resto `null`.
5. Campos pueden faltar además de ser null (política doc explícita): parser tolerante.
6. `id` no documentado: fallback vía `jobUrl`.
7. Errores en `text/plain`: no asumir JSON fuera del 200.
8. Sin `updatedAt`/`expiresAt`: cambios por `contentHash`, cierres por desaparición.
9. Compensación en valores absolutos, no centavos.

---

## Notas del investigador

**Doc oficial:** <https://developers.ashbyhq.com/docs/public-job-posting-api> (endpoint, `includeCompensation`, tabla de campos, enums `workplaceType`/`employmentType`, estructura de compensación; no documenta rate limits, errores, `id` ni `updatedAt`) y <https://developers.ashbyhq.com/docs/introduction> (Developer API RPC separada, fuera de alcance).

**Verificado empíricamente (2026-07-18):** 6 boards (1 049 jobs) con análisis de tipos/nulabilidad; `isRemote`/`workplaceType` nulos en 309; bloque `compensation` completo con valores absolutos; sin `includeCompensation` el bloque desaparece; 404 `text/plain` "Not Found"; cabeceras (ETag débil, cache 60 s, sin `X-RateLimit-*`, CORS `*`); robots de ambos hosts.

**Documentado pero no verificado:** `PartTime`/`Temporary` (no aparecieron); semántica exacta de campo omitido vs null.
