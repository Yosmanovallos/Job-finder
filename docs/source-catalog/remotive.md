# Remotive — catálogo de fuente

> Fuente: **Remotive Job API** (JSON, pública, sin login) y **Remotive XML/RSS feeds por categoría**.
> Documentación oficial: <https://github.com/remotive-io/remote-jobs-api> (a donde redirige
> `https://remotive.com/api-documentation`, HTTP 302 verificado) y
> <https://github.com/remotive-io/remote-jobs-feed>.
> Última verificación empírica: 2026-07-19.
>
> **Nota de formato:** este catálogo, por instrucción de la tarea, mapea al schema `opportunity`
> de `Prompt_QA_AI_Opportunity_Discovery_Compliant.md` líneas 298-336, no al `canonical-job-schema`
> del repo. Si se integra como `SourceAdapter` real, hará falta un mapeo adicional
> `opportunity` → `CanonicalJob` (o una ADR que adopte `opportunity` como destino).

## 1. Resumen

| Aspecto | Valor |
|---|---|
| Tipo de fuente | Dos métodos: **API JSON pública** y **RSS/XML feeds por categoría** |
| Host | `https://remotive.com` (`remotive.io` deprecado) |
| Autenticación | Ninguna en ambos métodos — datos públicos |
| **Conflicto crítico** | `robots.txt` de remotive.com **prohíbe `/api/*`** (§9). Los feeds RSS (`/remote-jobs/<slug>/feed`) **no** están prohibidos. |
| Filtrado por categoría | **API JSON: roto** (verificado, §3.1). **Feeds RSS: funciona** (verificado). |
| Paginación | Ninguna; cada respuesta devuelve el conjunto completo |
| Volumen observado hoy | 42 vacantes totales (2026-07-19); por-verificar si es el board completo |
| Atribución | **Obligatoria**, con corte de acceso explícito si no se cumple (§9) |
| Método recomendado | **RSS feed por categoría** (ligero, cumple robots.txt, filtra bien); la API JSON queda deshabilitada hasta que humano/ADR resuelva el conflicto de robots.txt |

## 2. Endpoints

### 2.1 API JSON (documentada, pero bloqueada por robots.txt — §9)

`GET` sin auth bajo `https://remotive.com`:

| Endpoint | Descripción | Params documentados |
|---|---|---|
| `/api/remote-jobs` | Lista de vacantes activas | `category`, `company_name`, `search`, `limit` (opcionales) |
| `/api/remote-jobs/categories` | Catálogo de categorías (id, name, slug) | — |

### 2.2 RSS/XML feeds por categoría (documentados, **no** bloqueados por robots.txt)

`GET https://remotive.com/remote-jobs/<category-slug>/feed`

Slugs verificados (200 OK) que **coinciden con `/api/remote-jobs/categories`**, no con el README
(desactualizado) de `remote-jobs-feed`:

| Slug verificado (200) | Slug del README antiguo (404 hoy) |
|---|---|
| `qa` | `qa` |
| `software-development` | `software-dev` (**404**) |
| `artificial-intelligence` | (no listado) |
| `data` | `data` |
| `devops` | `devops/sysadmin` |
| `all-others` | `all-others` |

**Usar los slugs de `/api/remote-jobs/categories`** para construir las URLs de feed.

## 3. Formato de respuesta

### 3.1 API JSON — `GET /api/remote-jobs`

Objeto con `job-count`, `total-job-count`, `jobs[]`. Campos por job (documentados): `id`, `url`,
`title`, `company_name`, `company_logo`, `category`, `job_type`
(`full_time|contract|part_time|freelance|internship`, opcional/a menudo vacío),
`publication_date`, `candidate_required_location`, `salary` (texto libre, opcional), `description`
(HTML). `tags` (array) observado pero **no documentado**.

**Hallazgo crítico (verificado con cache-buster)**: los parámetros `category`, `limit` y `search`
**no filtran** — siempre devuelven las 42 jobs completas. Contradice la doc oficial. El campo
`category` de cada job sí es correcto; filtrar del lado del cliente o usar los feeds RSS.

### 3.2 RSS feed — `GET /remote-jobs/<slug>/feed`

RSS 2.0. Campos por `<item>`: `title`, `jobId`, `company`, `location`, `type`, `guid`, `link`,
`pubDate`, `dc:creator`, `category`, `description` (HTML en CDATA). **No** hay campo `<salary>`
estructurado (solo texto libre en `description` — no parsear, regla 5). **El filtro por categoría
en los feeds SÍ funciona** (verificado).

## 4. Paginación

Ninguno de los dos métodos pagina. Conjunto completo por petición (API JSON 42 jobs ~548 KB;
feeds 1-10 items por categoría el 2026-07-19).

## 5. Rate limits

Documentado (aviso legal embebido en cada respuesta JSON):

- Consultar máx. ~4 veces/día; **más de 2 req/min será bloqueado**.
- Sin cabeceras `X-RateLimit-*`; `cache-control: no-store` en API pero Cloudflare cachea en edge.
- Feeds: `cache-control: max-age=14400` (4 h) en `qa` — respetar reduce frecuencia real.
- Existe API privada de pago ($5k/mo) — fuera de alcance.

## 6. Códigos de error (verificado)

- Slug de feed inexistente → `HTTP 404` HTML (ej. `software-dev`; correcto: `software-development`).
- `category` inválido en API JSON → `HTTP 200` con conjunto completo (filtro roto, §3.1).
- Sin tabla de errores documentada.

## 7. Mapeo al schema `opportunity` (Prompt…, líneas 298-336)

Basado en el **feed RSS** (método recomendado); se anota la diferencia con la API JSON.

| Campo `opportunity` | Origen (Feed) | Origen (API, si difiere) | Notas |
|---|---|---|---|
| `source_name` | — | — | `"remotive"` |
| `source_url` | `link`/`guid` | `url` | Detalle público |
| `source_category` | — | — | `"job_board_remote"` |
| `external_id` | `jobId` | `id` | Integer → string |
| `title` | `title` | `title` | |
| `organization` | `company`/`dc:creator` | `company_name` | |
| `description` | `description` (CDATA) | `description` | No confiable (regla 6); strip a texto plano |
| `opportunity_type` | — | — | `"job_listing"` |
| `employment_type` | `type` | `job_type` | Opcional, a menudo ausente → `null`, no inferir |
| `service_category` | `category` | `category` | Ej. "Quality Assurance"; mapear a taxonomía propia de forma determinista |
| `skills` | **NO estructurado** | `tags` (no oficial) | Feed: `[]`; API: `tags` baja confianza |
| `seniority` | **NO provisto** | **NO provisto** | → `"unknown"`; no inferir del título |
| `industry` | **NO provisto** | — | → `null` |
| `country` | `location` (texto libre) | `candidate_required_location` | Sin estructura; parsing determinista |
| `city` | **NO estructurado** | — | → `null` |
| `remote_status` | Implícito 100% remoto (ToS del board) | igual | `"remote"` solo porque Remotive lo exige, no por inferencia |
| `language` | — | — | Board en inglés (`<language>en-US</language>`) |
| `compensation_min/max` | **NO provisto** | `salary` texto libre (`"$36k"`) | → `null` salvo parseo confiable |
| `currency` | **NO provisto** | Implícito en `salary` (USD) | → `null` si no es inequívoco |
| `budget_text` | Texto en `description` | `salary` (campo dedicado) | Preferir `salary` de la API si se usa |
| `published_at` | `pubDate` (RFC 822) | `publication_date` (ISO sin offset) | Normalizar a UTC |
| `expires_at` | **NO provisto** | — | → `null` |
| `contact_name` | **NO provisto** | — | → `null` |
| `contact_method`/`application_url` | `link`/`guid` | `url` | Redirige a detalle en remotive.com |
| `*_score` | — | — | Aguas abajo |
| `compliance_method` | — | — | `"feed_rss_public"` o `"api_json_public"` |
| `raw_source_reference` | `<item>` XML | objeto JSON | Crudo para auditoría, no confiable |

## 8. Categorías (verificadas, `GET /api/remote-jobs/categories`, 30 total)

Relevantes QA/AI/software: `qa` (Quality Assurance), `artificial-intelligence`,
`software-development`, `data` (Data and Analytics), `devops`, `information-technology`,
`engineering`.

**Volumen observado 2026-07-19** (feeds RSS): `qa` 5, `software-development` 10,
`artificial-intelligence` 3, `data` 1, `devops` 1, `all-others` 1. Coherente con las 42 de la API
(resto en Medical, Marketing, Sales, etc.) → 42 parece el board completo, pero **observado, no
garantizado**; fluctúa día a día.

## 9. Términos de uso y robots.txt

**robots.txt de `remotive.com`** (verbatim, 2026-07-19) incluye entre otros:
`Disallow: /jobs/*`, `Disallow: /job/detail/*`, `Disallow: /api/*`, `Disallow: /*search=`.

**Conflicto que debe resolver humano/ADR antes de habilitar la API JSON**: `Disallow: /api/*`
cubre `/api/remote-jobs` y `/api/remote-jobs/categories` — los endpoints que el propio repo de
GitHub documenta. La regla 8 de AGENTS.md ("nunca bypasses robots.txt") no admite excepción que
yo decida. **Recomendación: no habilitar la API JSON por defecto; usar los feeds RSS
`/remote-jobs/<slug>/feed`**, que no coinciden con ningún patrón `Disallow` y además filtran bien.

**Términos de servicio** (verbatim relevante):

- "Please do not submit Remotive jobs to third Party websites (Jooble, Neuvoo, Google Jobs, LinkedIn Jobs)."
- "**Please link back to the URL found on Remotive AND mention Remotive as a source**... If you don't, we'll terminate your API access."
- "Jobs displayed are delayed by 24 hours" → **no es tiempo real**; afecta a la lógica de frescura
  de Fase 3 (los `first_seen` locales irán 24 h por detrás).
- Mostrar sus vacantes para recolectar signups/emails es incumplimiento.

**Implicación**: cualquier salida visible (CSV, digest, Notion, dashboard) debe incluir enlace de
vuelta a la URL de Remotive y mención como fuente, de forma sistemática — señalado para
`security-reviewer`/humano.

## 10. Riesgos y limitaciones

1. **Conflicto robots.txt vs. doc de la API JSON** (§9): no habilitar sin ADR humano.
2. **Filtro de categoría roto en la API JSON** (§3.1): verificado con cache-buster.
3. **Volumen bajo**: 42 totales, 1-10 por categoría el día verificado — fuente complementaria.
4. **Sin salario estructurado en el feed**: solo texto libre en `description`.
5. **`location` es texto libre** ("Brazil", "Worldwide"): parsing determinista posterior.
6. **Retraso de 24 h**: afecta a "más reciente primero" y a la verificación de frescura.
7. **`description` es HTML externo**: no confiable/posible inyección (regla 6).
8. **`tags` no documentado**: baja confianza.
9. **Slugs del README antiguo desactualizados** (`software-dev` 404): derivar de
   `/api/remote-jobs/categories` o mantener lista local revisada manualmente.
10. **Atribución obligatoria con consecuencia real**: requisito operativo permanente.

---

## Notas del investigador

**Documentación oficial**: `github.com/remotive-io/remote-jobs-api` y `remote-jobs-feed` (README
verbatim); `remotive.com/api-documentation` redirige (302) al primero.

**Verificado empíricamente (`curl`, 2026-07-19)**: `robots.txt` directo (confirma `Disallow:
/api/*`); `/api/remote-jobs` con `?category=`/`?limit=`/cache-buster (filtro no funcional, 42
jobs); `/api/remote-jobs/categories` (200, 30 categorías); feeds RSS de 6 categorías (200, filtro
correcto); `software-dev` 404; cabeceras de ambos métodos.

**Documentado no verificado**: parámetro `company_name`; API privada de pago; bloqueo real ante
>2 req/min (no probado para no arriesgar el acceso).
