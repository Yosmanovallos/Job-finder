# Freelancer.com — catálogo de fuente

> Fuente: **Freelancer.com API v0.1** (API pública documentada, OAuth2 o Personal Access Token).
> Documentación oficial: <https://developers.freelancer.com/>. Términos de la API:
> <https://www.freelancer.com/about/apiterms>.
> Última verificación empírica: 2026-07-19.
>
> **BLOQUEADO para producción hasta resolver conflicto de ToS (ver §9).** La API es técnicamente
> API-first y de buena calidad, pero el modelo de persistencia de este proyecto (Postgres como
> fuente de verdad + `job_versions` inmutable, retención indefinida) entra en conflicto directo
> con la cláusula de almacenamiento de los API Terms & Conditions (solo permiten *caché* refrescado
> cada 24 h, no almacenamiento persistente). No implementar un adapter habilitado por defecto sin
> (a) aclaración escrita de `api-support@freelancer.com`, o (b) una ruta de almacenamiento
> específica que cumpla el límite de 24 h y borrado en terminación. Mismo patrón que ADR 0002
> (feature flag `disabled`), pero aquí el motivo es contractual.
>
> **Nota de formato:** mapea al schema `opportunity` (Prompt…, líneas 298-336), no al
> `canonical-job-schema` del repo.

## 1. Resumen

| Aspecto | Valor |
|---|---|
| Tipo de fuente | API pública JSON v`0.1` (nivel más ligero §2.3, pero bloqueada por ToS) |
| Host | `https://www.freelancer.com/api/...` (prod) / `https://www.freelancer-sandbox.com/api/...` (sandbox) |
| Autenticación (lectura) | Documentada como requerida (OAuth2 o PAT) — **observado**: búsqueda de proyectos activos responde 200 sin auth (§4.4) |
| Autenticación (escritura: pujar) | OAuth2 + scopes avanzados + aprobación (~5 días) — fuera de alcance (regla 7) |
| Paginación | `limit` (techo efectivo 100) + `offset`; `result.total_count` |
| Rate limits | Cabeceras `RateLimit-Limit`/`RateLimit-Remaining`; varían por endpoint (§6) |
| Formato | JSON; `description` texto libre del cliente (**no confiable**, regla 6) |
| Estado en este proyecto | **No habilitado.** Solo documentación; implementación bloqueada por §9 |

## 2. Endpoints relevantes

| Endpoint | Método | Descripción |
|---|---|---|
| `/projects/0.1/projects/active/` | GET | Búsqueda de proyectos **activos** — recomendado por la doc para descubrir |
| `/projects/0.1/projects/` | GET | Todos los proyectos (incluye cerrados) |
| `/projects/0.1/projects/{id}/` | GET | Detalle por id |
| `/projects/0.1/jobs/search/` | GET | Búsqueda de skills/categorías (`?job_names[]=QA`) |
| `/projects/0.1/bids/` | GET/POST | Pujas (POST fuera de alcance — regla 7) |

### 2.1 Parámetros y skills

Filtros verificados: `query`, `project_types[]` (`fixed`|`hourly`), `min/max_avg_price`,
`min/max_avg_hourly_rate`, `jobs[]` (ids de skill), proyecciones `compact`/`full_description`/
`job_details`/`user_details`. Parámetros del SDK Python (`countries[]`, `languages[]`,
`from_time`/`to_time`, `sort_field`) **no confirmados** contra la API — por-verificar.

Skills QA/AI confirmadas vía `/jobs/search/` (2026-07-19): `67` "Testing / QA", `167` "Software
Testing", `292` "Machine Learning (ML)", `913` "Artificial Intelligence".
**Verificado**: `?jobs[]=67&limit=1&full_description` → `total_count: 46` proyectos activos QA.

## 3. Formato de respuesta

### 3.1 Envolvente

`{ "status": "success", "request_id": "...", "result": {...} }`; en error `status: "error"`,
`message`, `error_code`, `request_id`.

### 3.2 Campos de proyecto (`result.projects[]`, observado 2026-07-19)

`id`, `owner_id` (**observado siempre `null`** desde breaking change dic-2025/ene-2026 → sin datos
de cliente), `title`, `status`, `seo_url` (URL pública `https://www.freelancer.com/projects/<seo_url>`,
verificada 200), `currency` (objeto; `currency.country` es país de la **moneda**, NO del cliente),
`description` (solo con `full_description=true`; si no `null`), `preview_description` (~100 car.),
`jobs[]` (`{id,name,category}` → skills), `type` (`fixed`|`hourly`), `bidperiod` (días, semántica
parcial), `budget` (`{minimum,maximum}`; en `hourly` es tarifa/hora), `hourly_project_info`,
`bid_stats`, `submitdate`/`time_submitted` (epoch → `published_at`), `time_free_bids_expire`
(sin doc, por-verificar), `location` (**observado todo `null`**), `local` (bool), `language`.

### 3.3 `description` no confiable

Texto libre del cliente. **Observado 2026-07-19**: descripciones pidiendo automatizar sistemas de
terceros para evadir límites ("bot ... appointment slots ... facial verification using pre-recorded
videos"). Es contenido adversarial de un tercero (regla 6): nunca ejecutar ni seguir; solo indexar
con delimitadores si se pasa a un LLM.

## 4. Autenticación

- **OAuth2**: registro de cliente + scopes avanzados + aprobación ~5 días hábiles
  (`api-support@freelancer.com`). Header `freelancer-oauth-v1: <token>` (no `Bearer`).
- **Personal Access Token (autoservicio)**: generado en la cuenta sin aprobación; 1 token activo
  por entorno, válido 30 días. **No exime de los API T&C.**
- **Sandbox**: `freelancer-sandbox.com`, reinicios sin garantía de persistencia.
- **§4.4 — lectura anónima observada**: `GET /projects/0.1/projects/active/` sin auth devolvió
  `200` con datos reales, pese a que la doc dice `401 sin auth`. **No usar como estrategia**: no
  documentado, puede cambiar, y sigue sujeto a los T&C. Autenticar siempre con PAT/OAuth2.

## 5. Paginación

`limit` (techo efectivo 100: `limit=9999999` → 100), `offset` (default 0), `result.total_count`.
Doc recomienda refinar filtros (`jobs[]`, `query`, `from_time`) antes que paginar. `total_count`
observado: 6097 activos globales, 46 en "Testing / QA".

## 6. Rate limits

Cabeceras `RateLimit-Limit`/`RateLimit-Remaining`, varían por endpoint. **Observado** en
`/projects/0.1/projects/active/`: `ratelimit-limit: 200, 200;window=60, 1000;window=3600` (distinto
del ejemplo genérico 50/60s de la doc → confirma variación por endpoint). `429` ante exceso;
backoff exponencial (regla 12).

## 7. Códigos de error

`status`, `request_id` en todas. `status_code`, `message` (no programático), `error_code`
(ej. `RestExceptionCodes.BAD_JSON`, `.NOT_AUTHENTICATED`). Versión única `0.1`, sin deprecación
anunciada. Breaking changes: 2025-12-23 / 2026-01-26 `owner_id`/`project_owner_id` pueden ser
`null` (explica la ausencia de datos de cliente, §3.2).

## 8. Mapeo al schema `opportunity` (Prompt…, líneas 298-336)

| Campo `opportunity` | Origen Freelancer.com | Notas |
|---|---|---|
| `source_name` | — | `"freelancer.com"` |
| `source_url` | `seo_url` | `https://www.freelancer.com/projects/<seo_url>` (verificado 200) |
| `source_category` | — | `"freelance_marketplace"` |
| `external_id` | `id` | integer → string |
| `title` | `title` | No confiable (regla 6) |
| `organization` | **NO PROVISTO** | `owner_id` siempre `null` → `null` |
| `description` | `description` (`full_description=true`) / `preview_description` | No confiable (§3.3) |
| `opportunity_type` | — | `"freelance_project"` |
| `employment_type` | `type` | `fixed`→`project-based`; `hourly`→`contract` |
| `service_category` | `jobs[].category.name` | Normalización propia |
| `skills` | `jobs[].name` | "Testing / QA", "Machine Learning (ML)", etc. |
| `seniority` | **NO PROVISTO** | → `null` |
| `industry` | **NO PROVISTO** | → `null` |
| `country` | **NO fiable** | `location.country.*` siempre `null`; **NO usar `currency.country`** (país de la moneda) |
| `city` | **NO PROVISTO** | → `null` |
| `remote_status` | `local` (bool) | `local:false` observado (remoto); "observado, no garantizado" |
| `language` | `language` | ej. `"en"` |
| `compensation_min/max` | `budget.minimum/maximum` | Fijo: total; hora: tarifa/hora |
| `currency` | `currency.code` | `"USD"`, `"INR"` |
| `budget_text` | **NO crudo** | Compuesto (normalización nuestra) |
| `published_at` | `submitdate`/`time_submitted` | epoch → ISO 8601 UTC |
| `expires_at` | **NO fiable** | `bidperiod`/`time_free_bids_expire` sin semántica documentada — por-verificar, no inventar |
| `contact_name`/`contact_method` | **NO PROVISTO fuera de plataforma** | Único canal: pujar (acción humana, regla 7) |
| `application_url` | = `source_url` | Puja en la página pública tras login |
| `*_score` | — | Aguas abajo |
| `compliance_method` | — | **`"blocked_pending_tos_review"`** (§9) |
| `raw_source_reference` | JSON crudo + endpoint + timestamp | Auditoría |

## 9. Términos de uso, robots.txt y conflicto de ToS (crítico)

### 9.1 robots.txt

`https://www.freelancer.com/robots.txt` (verificado): **no** bloquea `/api/` ni `/projects/<seo_url>`.

### 9.2 API Terms & Conditions (verbatim relevante, verificado)

- **Restricciones (sección 4)**: *"You may not use the API to replicate or compete with the
  services offered by Freelancer."* (riesgo alto para un agregador de leads); *"You may not sell,
  rent, lease, sublicense, redistribute, or syndicate access to the API."*
- **Almacenamiento (sección 5) — la cláusula que bloquea**:
  > *"Where Data is cached, you should refresh the cache at least every 24 hours... All Data should
  > be stored and served using strong encryption. You may not copy or store any Data... except to
  > the extent permitted by these API T&Cs."*
  Permite **caché de rendimiento ≤24 h cifrado**; **no** almacenamiento persistente/histórico como
  el modelo del proyecto (Postgres fuente de verdad + `job_versions` retención indefinida).
- **Terminación (sección 7)**: borrar permanentemente toda Data al terminar el acuerdo.

### 9.3 Integraciones prohibidas (doc de producto)

Tabla oficial: **Automatic Bidder** (bots que pujan — **refuerza la regla 7**), **Illegal**,
**Questionable**, **Replacement** (*"replace functionality... without providing any added value to
the community"* — **riesgo real** para un agregador), **Spammy**. Contacto para aclarar:
`api-support@freelancer.com`.

### 9.4 Conclusión

No hay uso compliant para alimentar el pipeline **tal como está diseñado hoy** (retención
indefinida + presentación agregada) sin (a) aclaración escrita de `api-support@freelancer.com`, y/o
(b) ruta de almacenamiento específica (caché cifrado ≤24 h, purga en terminación) distinta del
modelo permanente. Mientras tanto: `compliance_method = "blocked_pending_tos_review"`, conector
**deshabilitado por defecto**.

## 10. Riesgos y limitaciones

1. **Conflicto de ToS de almacenamiento (§9.2, §9.4) — bloqueante.** Hallazgo principal.
2. **Riesgo "Replacement"/anti-competencia (§9.2, §9.3)** — agregador puede interpretarse como
   replicar/competir con su marketplace.
3. **Datos de cliente ausentes**: `owner_id`/`location.*` siempre `null`; único "contacto" es pujar
   (acción humana, regla 7).
4. **Contenido no confiable** (§3.3): posible instrucción incrustada.
5. **Semántica no documentada de `bidperiod`/`time_free_bids_expire`**: no calcular `expires_at` sin
   confirmar (regla 5).
6. **Lectura sin auth no documentada** (§4.4): no depender; usar PAT/OAuth2.
7. **Rate limits variables por endpoint**: leer cabeceras `RateLimit-*` reales.
8. **PAT expira cada 30 días, 1 por entorno; OAuth2 ~5 días de aprobación**: fricción operativa.
9. **Sin alternativa más ligera** (RSS/sitemap de proyectos apto para ingestión) — no explorado a
   fondo por quedar la API bloqueada por ToS.

---

## Notas del investigador

**Documentación oficial**: `developers.freelancer.com` (contenido embebido en el bundle JS público,
equivalente a leer el HTML renderizado — sin endpoints no documentados ni reverse-engineering);
`freelancer.com/about/apiterms` (HTML estático, verbatim §9.2); SDK Python oficial (consultado, no
ejecutado).

**Verificado empíricamente (GET reales, 2026-07-19, sin auth, user-agent identificable)**:
`/projects/0.1/projects/active/` (200, `total_count: 6097`, cabeceras rate-limit); `?jobs[]=67`
(46 QA, `owner_id`/`location` null); `?project_types[]=hourly` (budget = tarifa/hora);
`/jobs/search/` (ids 67/167/292/913); URL pública derivada de `seo_url` (200); `robots.txt`.

**Documentado no verificado**: flujo OAuth2 completo; `user_details` con `owner_id` poblado;
endpoints `contests`/`messaging`; tabla completa de `error_code`.
