# Greenhouse — catálogo de fuente

> Fuente: **Greenhouse Job Board API** (API pública de tableros de empleo, sin autenticación).
> No confundir con la **Harvest API** (API privada de Greenhouse, con API key y rate limits propios): este documento cubre únicamente la Job Board API.
> Documentación oficial: <https://developers.greenhouse.io/job-board.html>
> Última verificación empírica: 2026-07-17/18.

## 1. Resumen

| Aspecto | Valor |
|---|---|
| Tipo de fuente | API pública JSON (nivel más ligero de la prioridad del plan §2.3) |
| Host | `https://boards-api.greenhouse.io` |
| Autenticación (GET) | Ninguna — datos públicos |
| Autenticación (POST solicitudes) | Basic Auth con API key (fuera de alcance: no auto-aplicamos, regla 7) |
| Paginación en `/jobs` | No — devuelve el board completo en una respuesta |
| Rate limits | **No documentados** para esta API (ver §5) |
| Formato | JSON; `content` viene **HTML-escapado** (entidades) |
| Ámbito | Por empresa (`board_token`); no hay listado global de empresas |

## 2. Endpoints

Todos son `GET`, sin autenticación, bajo `https://boards-api.greenhouse.io`:

| Endpoint | Descripción | Query params |
|---|---|---|
| `/v1/boards/{board_token}` | Nombre y contenido del board | — |
| `/v1/boards/{board_token}/jobs` | Lista de vacantes publicadas | `content=true` añade `content`, `departments`, `offices` a cada job |
| `/v1/boards/{board_token}/jobs/{job_id}` | Detalle de una vacante (incluye `content`) | `questions=true` añade campos del formulario; `pay_transparency=true` añade `pay_input_ranges` |
| `/v1/boards/{board_token}/departments` | Departamentos (con sus jobs) | `render_as=list` (default) o `tree` |
| `/v1/boards/{board_token}/offices` | Oficinas (con departamentos y jobs) | `render_as=list\|tree` |
| `/v1/boards/{board_token}/sections` | Secciones de "prospect posts" (posts con `internal_job_id: null`) | — |
| `/v1/boards/{board_token}/education/{degrees\|disciplines\|schools}` | Catálogos educativos para formularios | `term`, `page` (estos **sí** paginan, 100/página) |

Existe también `POST /v1/boards/{board_token}/jobs/{id}` para enviar solicitudes (Basic Auth). **No lo usamos**: el proyecto no auto-aplica (regla 7 de AGENTS.md). Hay soporte JSONP vía `callback` (irrelevante para nosotros).

## 3. Formato de respuesta

### 3.1 Lista — `GET /v1/boards/{token}/jobs`

```json
{
  "jobs": [ { "...": "..." } ],
  "meta": { "total": 167 }
}
```

Campos por job **observados** en la lista sin `content=true` (boards gitlab/stripe/cloudflare, 2026-07-17):

| Campo | Tipo | Nullable | Notas |
|---|---|---|---|
| `id` | integer | no | ID del job post (se usa en `/jobs/{job_id}`) |
| `internal_job_id` | integer | sí | `null` en "prospect posts" (documentado) |
| `title` | string | no | |
| `updated_at` | string ISO 8601 con offset | no | ej. `"2026-07-17T08:48:22-04:00"` |
| `first_published` | string ISO 8601 con offset | sí (asumir) | **Sí existe.** Documentado en el detalle; observado también en la lista |
| `requisition_id` | string | sí | ej. `"6263"` |
| `absolute_url` | string (URL) | no | URL pública del post |
| `location` | objeto `{ "name": string }` | no | Texto libre, ej. `"Remote, Italy"` |
| `company_name` | string | no | Observado en lista y detalle (la doc solo lo lista en el detalle → "observado, no garantizado" en la lista) |
| `language` | string | no | ej. `"en"` |
| `application_deadline` | ? | sí | Observado siempre `null` en los boards probados |
| `metadata` | array de `{id, name, value, value_type}` \| null | sí | Campos custom del cliente |
| `data_compliance` | array | no | ej. `[{"type":"gdpr", "requires_consent":false, "...":"..."}]` |
| `education`, `employment` | array (opcional) | — | Observados solo en algunos jobs; no documentados en la lista |

Con `?content=true` cada job añade: `content` (string, HTML-escapado — §3.3), `departments` (array de `{id, name, parent_id, child_ids[]}`), `offices` (array de `{id, name, location, parent_id, child_ids[]}`, `location`/`parent_id` nullables) y campos de disclaimers de IA (`ai_disclaimer`, `include_ai_disclaimer`, `ai_opt_out_request_url` — observados 2026, no documentados).

### 3.2 Detalle — `GET /v1/boards/{token}/jobs/{job_id}`

Mismos campos que la lista con `content=true`. Adicionalmente:

- Con `?questions=true`: `questions` (array de `{description, label, required, fields:[{name, type, values[]}]}`), `location_questions`, `demographic_questions` (si el cliente usa Greenhouse Inclusion), `compliance`.
- Con `?pay_transparency=true`: `pay_input_ranges` — según doc oficial, array de `{min_cents, max_cents, currency_type, title, blurb}`. **Observado**: `[]` en todos los jobs probados; solo se llena si el cliente activa pay ranges. Sin el query param, el campo **no aparece** (observado).

### 3.3 Escapado HTML de `content` (importante)

Documentado oficialmente: el contenido se convierte automáticamente a entidades HTML. Observado real:

```text
"&lt;h2&gt;Who we are&lt;/h2&gt;\n&lt;p&gt;Stripe is a financial infrastructure platform..."
```

El adaptador debe: (1) des-escapar entidades → HTML real, (2) convertir a texto plano para `descriptionText`. Tratar siempre como contenido no confiable (posible inyección de prompts — regla 6).

## 4. Paginación

- `/jobs`, `/departments`, `/offices`, `/sections`: **sin paginación**. Una sola respuesta con el board completo; `meta.total` da el conteo. Verificado: Stripe devuelve 525 jobs en una respuesta (~118 KB sin `content`; con `content=true` puede ser de varios MB).
- Solo los endpoints `education/*` paginan (`page`, 100 por página).

## 5. Rate limits

- La documentación oficial de la **Job Board API no especifica ningún rate limit** (verificado).
- Observado: sin cabeceras `X-RateLimit-*` (a diferencia de la Harvest API, que documenta 50 req/10 s — no aplica aquí).
- Política del adaptador (nuestra, no de Greenhouse): 1 request de lista por board por corrida; detalle solo de jobs seleccionados; espaciado conservador y backoff ante 429/5xx. Observado: la API devuelve `ETag` (posible `If-None-Match`) — "observado, no garantizado".

## 6. Códigos de error

Verificado empíricamente (2026-07-17):

- Board inexistente → `404` con cuerpo `{"status":404,"error":"Job not found"}` (sí, dice "Job not found" también para boards).
- Job inexistente → `404` con el mismo cuerpo.
- Formato general observado: `{"status": <int>, "error": "<mensaje>"}`.
- La doc oficial no publica tabla de códigos para los GET. Asumir posibles `429`/`5xx` no documentados; reintentos acotados (regla 12).
- Un token mal escrito es indistinguible de "la empresa dejó de usar Greenhouse" — ambos dan 404. Distinguir "board desapareció" de "job desapareció" por contexto.

## 7. Mapeo al schema canónico (`packages/domain/src/job/canonical-job-schema.ts`)

| Campo canónico | Campo Greenhouse | Notas |
|---|---|---|
| `sourceId` | — | Id de instancia, ej. `greenhouse:<board_token>` |
| `sourceJobId` | `id` | integer → string |
| `sourceUrl` | endpoint de detalle | `https://boards-api.greenhouse.io/v1/boards/<token>/jobs/<id>` |
| `canonicalUrl` | `absolute_url` | |
| `applyUrl` | `absolute_url` | La página pública incluye el formulario; no hay apply URL separada |
| `titleRaw` | `title` | |
| `titleNormalized` | — | Normalización mínima determinista (lowercase/espacios); familias aguas abajo |
| `titleFamily` | — | → `null` (fase posterior) |
| `seniority` | **NO provisto** | → `"unknown"` (§9.1: nunca inferir en el adaptador) |
| `companyNameRaw` | `company_name` | Fallback: nombre configurado junto al board_token |
| `companyId`, `companyDomain` | **NO provisto** | → `null` |
| `descriptionText` | `content` des-escapado + strip HTML | Ver §3.3 |
| `responsibilities`, `requiredSkills`, `preferredSkills`, `educationRequirements`, `languageRequirements` | **NO provisto** (solo prosa en `content`) | → `[]`; extracción semántica es fase posterior |
| `requiredExperienceYears` | **NO provisto** | → `null` |
| `locations[].raw` | `location.name` | Texto libre |
| `locations[].city/region/countryCode` | **NO provisto estructurado** | → `null`; parsing posterior, nunca adivinado |
| `workMode` | **NO provisto** | → `"unknown"` aunque `location.name` diga "Remote" — eso es parsing de texto, no un campo de la fuente |
| `remoteRegion` | **NO provisto** | → `null` |
| `employmentTypes` | **NO provisto** | → `[]` (`metadata` varía por cliente — no confiable) |
| `compensation` | `pay_input_ranges` (solo detalle + `?pay_transparency=true`) | Si viene: `min_cents/100`, `max_cents/100`, `currency_type`, `source: "explicit"`, `period: null` (no documentado). Si vacío/ausente (lo habitual): todo `null` + `source: "unknown"` |
| `visaSponsorship` | **NO provisto** | → `"unknown"` |
| `publishedAt` | `first_published` | Normalizar a UTC ISO 8601 |
| `expiresAt` | `application_deadline` si no es null | Observado siempre `null`. Nunca inventar |
| `firstSeenAt`, `lastSeenAt` | — | Momento de captura (fetch) |
| `lastVerifiedAt` | — | Lo pone `verify`/pipeline |
| `status` | — | `"active"` si aparece en el listado; desaparición ⇒ candidato a `closed` (lógica de Fase 3) |
| `extractionMethod` | — | `"api"` |
| `extractionConfidence` | — | Alta para campos directos de la API (0.95) |
| `contentHash` | — | sha256 del cuerpo crudo del detalle |
| `evidence` | — | Citas de `title`/`location`/`content` con `sourceUrl` del job |

## 8. Descubrimiento de boards

- La API es **por board_token de empresa**; no existe endpoint público para listar todas las empresas.
- El usuario configura los tokens en `config/sources.local.yaml`. El token suele coincidir con el slug en `job-boards.greenhouse.io/<token>`.

Boards verificados con petición real (2026-07-17):

| Token | Estado | Jobs (`meta.total`) |
|---|---|---|
| `gitlab` | OK 200 | 167 |
| `stripe` | OK 200 | 525 |
| `cloudflare` | OK 200 | 263 |
| `elastic` | OK 200 | 177 |
| `doordash` | **404** — no es un token válido hoy | — |

Canary recomendado: `gitlab` (tamaño manejable). Los conteos cambian a diario — foto del día de verificación.

## 9. Términos de uso y robots

- La doc oficial declara los GET del job board como públicos y sin autenticación; no publica términos específicos de la Job Board API (verificado 2026-07-17). Si aparece una página de términos dedicada, actualizar este catálogo.
- `robots.txt` de `boards-api.greenhouse.io` (verificado): `User-agent: * / Disallow: /embed/`. Los paths `/v1/...` no están bloqueados.
- Reglas del proyecto igualmente: sin evasión de controles, User-Agent identificable, frecuencia moderada.

## 10. Riesgos y limitaciones

1. **Sin paginación en `/jobs`**: boards grandes llegan en una sola respuesta; con `content=true` pueden ser varios MB. Mitigación: lista **sin** `content`; detalle solo de jobs seleccionados.
2. **`content` HTML-escapado y no confiable**: des-escape + strip; tratar como dato adversarial — nunca alimentar a un LLM sin delimitadores y sin instrucción de tratarlo como datos.
3. **Muchos campos canónicos ausentes**: seniority, workMode, salario (salvo `pay_input_ranges`, casi siempre vacío), tipo de empleo, visa, expiración → `unknown`/`null`/`[]` por política §9.1.
4. **`metadata` es por cliente**: no construir lógica genérica sobre él.
5. **404 ambiguo**: mismo cuerpo para board y job inexistentes; un rebranding del token rompe la fuente silenciosamente como 404.
6. **Esquema no versionado**: Greenhouse añade campos sin aviso (`ai_disclaimer`, `education`/`employment` observados 2026). El parser tolera campos desconocidos y valida solo lo que usa.
7. **Timestamps con offset variable** (`-04:00` observado): normalizar siempre a UTC.
8. **Discrepancias doc vs. realidad**: `company_name`/`first_published`/`language`/`data_compliance` aparecen en la lista sin estar documentados ahí; no depender de campos extra sin fallback.

---

## Notas del investigador

**Documentación oficial consultada:** <https://developers.greenhouse.io/job-board.html> (única página oficial de la Job Board API; no documenta rate limits ni tabla de errores) y <https://developers.greenhouse.io/> (separación Job Board / Harvest / Onboarding).

**Verificado empíricamente (GET reales, 2026-07-17/18):** listas de gitlab/stripe/cloudflare/elastic (200, estructura `{jobs, meta.total}`); `doordash` 404; `content=true` con entidades HTML y `offices[].location: null`; detalle con `questions=true&pay_transparency=true` (`pay_input_ranges: []` en todos los probados); job inexistente 404 idéntico al de board; sin cabeceras `X-RateLimit-*`; `ETag` presente; robots.txt solo bloquea `/embed/`.

**Documentado pero no verificado:** `sections/{id}`, endpoints `education/*` y su paginación, `demographic_questions`, JSONP, `render_as=tree`.
