# Lever — catálogo de fuente

> Fuente: **Lever Postings API** (API pública de listados, sin autenticación).
> No confundir con la **Lever Data API** (privada, con API key): este documento cubre únicamente la Postings API pública.
> Documentación oficial: <https://github.com/lever/postings-api> (referencia oficial de Lever para la Postings API).
> Última verificación empírica: 2026-07-18.

## 1. Resumen

| Aspecto | Valor |
|---|---|
| Tipo de fuente | API pública JSON (nivel más ligero del plan §2.3) |
| Host | `https://api.lever.co` (clientes EU: `https://api.eu.lever.co`) |
| Autenticación | Ninguna — datos públicos |
| Paginación | Sí — `skip` y `limit` (verificado; sin campo de total, fin = página corta o `[]`) |
| Rate limits | **No documentados**; robots.txt pide `Crawl-delay: 1` → ≥1 s entre requests (nuestro default de 30/min lo respeta) |
| Formato | JSON; `description`/`lists[].content` son HTML **sin escapar**; existen variantes `*Plain` en texto plano |
| Ámbito | Por sitio de empresa (`site` slug); no hay listado global |
| Ventaja clave | `workplaceType` estructurado (remote/hybrid/onsite) y `country` ISO-2 |

## 2. Endpoints

| Endpoint | Descripción | Query params |
|---|---|---|
| `GET /v0/postings/{site}?mode=json` | Lista de vacantes publicadas | `skip`, `limit`, y filtros `location`, `commitment`, `team`, `department` |
| `GET /v0/postings/{site}/{id}?mode=json` | Detalle de una vacante (objeto único) | — |

Sin `mode=json` la API devuelve HTML embebible. Solo usamos JSON.

## 3. Formato de respuesta

### 3.1 Lista

La raíz es un **array** de postings (sin objeto contenedor ni total). Campos observados (Spotify, 2026-07-18):

| Campo | Tipo | Nullable | Notas |
|---|---|---|---|
| `id` | string UUID | no | |
| `text` | string | no | Título |
| `hostedUrl` | string URL | no | Página pública del post |
| `applyUrl` | string URL | no | `hostedUrl` + `/apply` |
| `createdAt` | number (epoch **ms**) | no | Fecha de creación del posting |
| `workplaceType` | string | no (observado siempre) | La doc dice `on-site`; **la API devuelve `onsite` sin guion** (verificado). Valores: `remote`, `hybrid`, `onsite`, `unspecified`. El adaptador acepta ambas grafías |
| `country` | string ISO 3166-1 alpha-2 | sí (asumir) | ej. `"GB"` |
| `categories` | objeto | no | `{commitment, department, location, team, allLocations: string[]}` — todos opcionales |
| `description` | string HTML | no | Cabecera/apertura en HTML |
| `descriptionPlain` | string | no | Versión texto plano de `description` |
| `descriptionBody`/`descriptionBodyPlain` | string | opcional | Cuerpo |
| `lists` | array `{text, content}` | no | Secciones (responsabilidades, requisitos…); `content` es HTML de `<li>` |
| `additional`/`additionalPlain` | string | opcional | Cierre (EEO, etc.) |
| `opening`/`openingPlain` | string | opcional | Apertura |
| `salaryRange` | objeto `{min, max, currency, interval}` | opcional | Verificado real en `octoenergy` (46/140) y `matchgroup` (52/83): `{currency:"USD", interval:"per-year-salary", min, max}`; 0/111 en spotify — depende del cliente |
| `salaryDescription`/`salaryDescriptionPlain` | string | opcional | Texto salarial |

### 3.2 Detalle

Mismo objeto que un elemento de la lista (verificado: `GET /v0/postings/spotify/{id}?mode=json` devuelve el posting completo).

## 4. Paginación

`skip` + `limit` verificados empíricamente (`skip=1&limit=1` devuelve el segundo posting). No hay campo de total: iterar hasta recibir menos elementos que `limit`. Boards observados devuelven todo si no se pasan parámetros (Spotify: 111 postings en una respuesta).

## 5. Rate limits

No documentados. Sin cabeceras `X-RateLimit-*` observadas. Política del adaptador: páginas de 100, espaciado conservador, backoff ante 429/5xx, User-Agent identificable.

## 6. Códigos de error

Verificado (2026-07-18):

- Site inexistente → `404` con cuerpo JSON `{"ok":false,"error":"Document not found"}`.
- Posting inexistente → mismo formato (asumir; mismo mecanismo de documento).
- 404 ambiguo: site mal escrito ≡ empresa que dejó Lever.

## 7. Mapeo al schema canónico

| Campo canónico | Campo Lever | Notas |
|---|---|---|
| `sourceId` | — | `lever:<site>` |
| `sourceJobId` | `id` | |
| `sourceUrl` | endpoint de detalle | `https://api.lever.co/v0/postings/<site>/<id>?mode=json` |
| `canonicalUrl` | `hostedUrl` | |
| `applyUrl` | `applyUrl` | |
| `titleRaw` | `text` | |
| `seniority` | **NO provisto** | → `"unknown"` (§9.1) |
| `companyNameRaw` | **NO provisto** | Nombre configurado junto al site; fallback: slug |
| `descriptionText` | `descriptionPlain` + `lists[]` (título + `content`→texto) + `additionalPlain` | Concatenación determinista; HTML tratado como dato no confiable |
| `responsibilities`, `requiredSkills`, … | **NO estructurado** | → `[]` (las `lists` son prosa por sección, sin semántica fiable) |
| `locations[].raw` | `categories.allLocations[]` (o `categories.location`) | |
| `locations[].countryCode` | `country` **solo si hay una única ubicación** | `country` es a nivel de posting; con varias ubicaciones no es atribuible → `null` |
| `workMode` | `workplaceType` | Campo estructurado, no inferencia: `remote`→remote, `hybrid`→hybrid, `onsite`→onsite; `unspecified`/ausente/otro → `unknown` |
| `employmentTypes` | `[categories.commitment]` si existe | Label crudo (`"Permanent"`, `"Intern"`…) |
| `compensation` | `salaryRange` si existe | `min`, `max`, `currency`, `period: interval` (passthrough del valor de la fuente), `source: "explicit"`. Ausente → nulls + `"unknown"` |
| `visaSponsorship` | **NO provisto** | → `"unknown"` |
| `publishedAt` | `createdAt` (epoch ms → UTC ISO) | Fecha declarada por la fuente para el posting |
| `expiresAt` | **NO provisto** | → `null` |
| `status` | — | `"active"` si está listado; verify 404 ⇒ `closed` |
| `extractionMethod` | — | `"api"` |
| `contentHash` | — | sha256 del cuerpo crudo del detalle |
| `evidence` | — | Citas de `text`/`location`/descripción con `hostedUrl` |

## 8. Descubrimiento de sites

Por slug (`jobs.lever.co/<site>`). Verificado 2026-07-18:

| Site | Estado | Postings |
|---|---|---|
| `spotify` | OK 200 | 111 |
| `palantir` | OK 200 | 274 |
| `octoenergy` | OK 200 | 140 (46 con `salaryRange`) |
| `matchgroup` | OK 200 | 83 (52 con `salaryRange`) |
| `netflix`, `plaid`, `kraken`, `voleon` | 200 pero **`[]`** (sites vacíos o migrados) | 0 |
| `ramp`, `haus`, `quora`, `attentive` | **404** — no son sites válidos hoy | — |

Canary recomendado: `spotify`. Un site con `[]` responde 200 — no confundir con error, pero un site que pasa de N>0 a 0 de golpe merece alerta (puede haber abandonado Lever silenciosamente). Un slug con 404 en el host global puede existir en `api.eu.lever.co`.

## 9. Términos y robots

Sin términos específicos publicados para la Postings API; es la vía oficial para embeber vacantes. Reglas del proyecto: sin evasión, User-Agent identificable, frecuencia moderada.

## 10. Riesgos y limitaciones

1. Boards vacíos (200 + `[]`) son frecuentes — empresas que migraron de ATS; distinguir de 404.
2. HTML sin escapar en `description`/`lists[].content`: tratar como adversarial; usar variantes `*Plain` cuando existan.
3. `salaryRange.interval` con vocabulario propio: passthrough a `period`, no normalizar adivinando.
4. Sin `updatedAt`: detectar cambios por `contentHash`.
5. Esquema no versionado: parser tolerante, validar solo lo usado.

---

## Notas del investigador

Verificado empíricamente (curl, 2026-07-18): estructura de lista y detalle en `spotify` (111 postings, campos listados arriba), paginación `skip`/`limit`, 404 JSON `{"ok":false,"error":"Document not found"}`, boards vacíos con `[]` (netflix, plaid, kraken, voleon). Referencia oficial: repositorio `lever/postings-api` en GitHub (parámetros `skip`, `limit`, `mode`, filtros y campos). `salaryRange` documentado pero no observado en los sitios probados — mapeo implementado sobre la forma documentada `{min, max, currency, interval}`.
