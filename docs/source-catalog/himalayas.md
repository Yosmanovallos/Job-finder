# Himalayas — catálogo de fuente

> Fuente candidata: **Himalayas Remote Jobs API** (`https://himalayas.app/jobs/api` y
> `/jobs/api/search`) + RSS (`https://himalayas.app/jobs/rss`). Job board remoto con más de
> 100 000 vacantes indexadas, filtro `employment_type` que **sí funciona** (a diferencia de
> Remotive/Jobicy).
> Documentación oficial: <https://himalayas.app/docs/remote-jobs-api>,
> <https://himalayas.app/docs/remote-jobs-rss>, OpenAPI: <https://himalayas.app/docs/openapi.json>.
> Última verificación empírica: 2026-07-20.
>
> **No habilitar por defecto sin resolver §8 (conflicto de ToS general vs. licencia específica de
> la API).** Mismo patrón que ADR 0002 / `freelancer-com.md`: motivo contractual, no técnico.

## 1. Resumen

| Aspecto | Valor |
|---|---|
| Tipo de fuente | API JSON pública, sin auth (nivel más ligero §2.3) + RSS complementario |
| Host | `https://himalayas.app` |
| Autenticación | Ninguna — documentado explícitamente ("No API key or authentication is required") |
| Endpoints | `/jobs/api` (browse, paginado), `/jobs/api/search` (con filtros), `/jobs/rss` (100 más recientes, sin filtros) |
| Filtro `employment_type` | **Funciona de verdad** (verificado, §3) — valores `Full Time\|Part Time\|Contractor\|Temporary\|Intern\|Volunteer\|Other` |
| Volumen total del board | `totalCount: 100841` (browse sin filtro, 2026-07-20) |
| Volumen QA contract | `q=QA&employment_type=Contractor` → **144** |
| Volumen AI contract | `q=AI&employment_type=Contractor` → **582** |
| Volumen contract total | `employment_type=Contractor` sin `q` → **11 764** |
| robots.txt | `Allow: /`, solo `Disallow: /apply` — **no bloquea** `/jobs/api` ni `/jobs/rss` |
| Páginas de detalle HTML | **Bloqueadas por Cloudflare** (`cf-mitigated: challenge`, 403) — no usar |
| Atribución | Obligatoria (link visible + mención "sourced from Himalayas") |
| Licencia (OpenAPI) | `"Free to use with attribution"` |

## 2. Endpoints

| Endpoint | Método | Descripción | Parámetros documentados |
|---|---|---|---|
| `/jobs/api` | GET | Browse paginado del feed completo | `offset` (def. 0), `limit` (máx. 20, def. 20) |
| `/jobs/api/search` | GET | Búsqueda con filtros | `q`, `country`, `worldwide`, `exclude_worldwide`, `seniority`, `employment_type`, `company`, `timezone`, `sort` (`recent`\|`salaryDesc`), `page` |
| `/jobs/rss` | GET | RSS 2.0, 100 más recientes | Ninguno soportado hoy (filtro "planned") |
| `/docs/openapi.json` | GET | Especificación OpenAPI 3.1 | — |

`GET /companies/<slug>/jobs/<slug>` (detalle HTML): **403 `cf-mitigated: challenge`**, confirmado
con dos user-agents. No sortear (regla 8) — el detalle **no** es vía disponible.

## 3. Formato y verificación del filtro (crítico)

### 3.1 `/jobs/api/search` — respuesta

```json
{"updatedAt": 1784528375, "offset": 0, "limit": 20, "totalCount": N, "jobs": [ {...} ]}
```

### 3.2 Campos por job (verificado)

`title`, `excerpt`, `companyName`, `companySlug`, `companyLogo`, `employmentType`, `minSalary`,
`maxSalary`, `salaryPeriod` (`hourly|weekly|fortnightly|monthly|annual`), `currency` (a veces
`null`), `seniority` (array), `locationRestrictions`, `timezoneRestrictions`, `categories`,
`parentCategories`, `description` (HTML saneado — no confiable, regla 6), `pubDate`, `expiryDate`,
`applicationLink`, `guid`.

### 3.3 Filtro `employment_type` — funcional, NO roto

A diferencia de Remotive (`category` roto) y Jobicy (`industry` roto), aquí sí restringe:

```
GET /jobs/api/search?q=QA&employment_type=Contractor  → totalCount 144, 18/18 muestra Contractor
GET /jobs/api/search?employment_type=Freelance        → HTTP 400 (enum inválido; usar "Contractor")
GET /jobs/api/search?bogus=1                           → 200, parámetro desconocido ignorado
```

**Matiz**: `Contractor` mezcla crowdtesting/freelance genuino (Tester Work, cat. `Freelance-QA`)
con contratos de plazo fijo tipo staff-aug ("QA Engineer (12-Month Contract)"). No es "144
proyectos freelance": es "144 postings con relación contractual, no de plantilla". No presentar
como equivalente a un proyecto de Workana.

### 3.4 RSS — sin filtro, sin `employmentType`

`/jobs/rss` (100 items): `title`, `description`, `category` (texto libre granular), `pubDate`,
`link`, namespace `himalayasJobs:`. **No** trae `employmentType` estructurado ni salario — para eso
hace falta la API JSON.

## 4–7. Paginación / rate limit / robots.txt

- Paginación: `/jobs/api` `offset`/`limit` (máx 20); `/jobs/api/search` `page` 1-indexado + `totalCount`.
- Rate limit: documentado `429` al exceder, **sin valor numérico**. Refresco cada 24 h → no pollear más seguido.
- robots.txt (2026-07-20): `Allow: /`, `Disallow: /apply`; no bloquea `/jobs/api*` ni `/jobs/rss`.

## 8. Términos de uso — conflicto sin resolver (bloqueante)

- **Licencia de la API** (OpenAPI, `/docs/openapi.json`): `"Free to use with attribution"`,
  `termsOfService` autorreferencial a la doc; sin cláusula de retención máxima.
- **ToS general** (`/terms`, verbatim 2026-07-20): prohíbe "scrape the Services", "copy, use,
  disclose or distribute any information obtained from the Services".
- **Tensión**: ambos de la misma empresa, sin referencia cruzada. Precedente WWR (ToS general
  silente + doc de RSS que autoriza) es más limpio; aquí el ToS general **sí** tiene cláusula
  anti-scraping explícita. Zona gris real, no un "sí" limpio.
- **Recomendación**: tratar como Freelancer.com §9 — no habilitar por defecto; requiere decisión
  humana (email a `hi@himalayas.app` o ADR). Estado: `blocked_pending_tos_review`.

## 9. Mapeo al schema `opportunity`

`external_id` ← `guid` (RSS) / hash `companySlug`+`title` (API, **sin `id` numérico estable
documentado** — por-verificar antes de usar como clave de dedupe). `employment_type` ←
`employmentType` (filtro funcional, pero `Contractor` ≠ solo freelance). `compensation_*` ←
`minSalary`/`maxSalary`/`salaryPeriod`/`currency` (más rico que RemoteOK/WWR/Remotive).
`compliance_method` = `blocked_pending_tos_review`.

## 10. Riesgos

1. Conflicto de ToS (§8) — **bloqueante**, misma categoría que Freelancer.com.
2. `Contractor` mezcla freelance genuino con contrato de plazo fijo.
3. Sin `id` numérico estable en la API JSON — resolver antes de dedupe.
4. Detalle HTML bloqueado por Cloudflare — enriquecer solo desde API/RSS.
5. Rate limit sin valor numérico — backoff genérico (regla 12).
6. RSS sin filtro implementado ("planned") — no depender de él.
