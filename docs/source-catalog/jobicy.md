# Jobicy — catálogo de fuente

> Fuente candidata: **Jobicy Remote Jobs API v2** (`https://jobicy.com/api/v2/remote-jobs`) + RSS
> (`https://jobicy.com/feed/job_feed`). Job board remoto de tamaño medio.
> Documentación oficial: <https://jobi.cy/apidocs> (**no accesible en vivo**, §7 — contenido
> confirmado vía espejo oficial en GitHub: <https://github.com/Jobicy/remote-jobs-api>).
> Última verificación empírica: 2026-07-20.
>
> **No habilitar por defecto**: `robots.txt` de `jobicy.com` no se pudo verificar en vivo en
> ningún intento (§7, Cloudflare challenge). El proyecto verifica `robots.txt` en vivo para toda
> fuente antes de construir un conector; sin esa verificación no se puede confirmar que `/api/v2`
> esté permitido a un crawler declarado, aunque la API responda `200` a GET directos.

## 1. Resumen

| Aspecto | Valor |
|---|---|
| Tipo de fuente | API JSON pública sin auth + RSS complementario |
| Host API | `https://jobicy.com` (`/api/v2/remote-jobs`) |
| Host docs | `https://jobi.cy` (dominio **distinto** — no gobierna `robots.txt` de `jobicy.com`) |
| Autenticación | Ninguna |
| `robots.txt` de `jobicy.com` | **No verificable en vivo** — Cloudflare Managed Challenge en cada intento (§7) |
| Filtro `industry=` | **Roto** (verificado, §3.2) — filtrar client-side por el campo `jobIndustry` |
| `jobType` (campo, no filtro) | Real y estructurado: `Full-Time`, `Part-Time`, `Contract`, `Internship`, `Freelance`; observado `Full-Time` 97/100, `Part-Time` 2/100, `Contract` 1/100 |
| Atribución | Obligatoria, embebida en cada respuesta (`friendlyNotice`) |
| Retraso de publicación | RSS: 6 h documentado (`legalNotice`) |

## 2. Endpoints

| Endpoint | Descripción | Parámetros verificados |
|---|---|---|
| `GET /api/v2/remote-jobs` | Listado | `count` (1-100), `geo`, `industry` (roto), `tag` (mín. 3 car.) |
| `GET /api/v2/remote-jobs?get=industries` | Catálogo de slugs válidos | — (27 industrias, incluye `qa-testing`) |
| `GET /feed/job_feed` | RSS 2.0 con `<legalNotice>` | Sin filtros observados |

## 3. Formato y verificación del filtro

### 3.1 Envolvente

```json
{"apiVersion":"2.2.15","documentationUrl":"https://jobi.cy/apidocs","friendlyNotice":"...","jobCount":N,"lastUpdate":"...","appliedFilters":{...},"jobs":[...]}
```

### 3.2 Filtro `industry=qa-testing` — ROTO (verificado)

```
?industry=qa-testing        → appliedFilters lo refleja, pero solo 1/10 jobs es "QA & Testing"
?industry=nonexistent-xyz   → 400 (valida el slug pero NO filtra el conjunto)
```

Mismo patrón "filtro documentado pero no funcional" de Remotive (`category`). **Estrategia**: pedir
el conjunto general y filtrar client-side por el campo `jobIndustry` (correcto por job).

### 3.3 Campo `jobType` — real, no roto

Muestra 100 jobs (2026-07-20): `Full-Time 97, Part-Time 2, Contract 1`. `Freelance` en el enum
documentado pero 0/100 en la muestra del día. Volumen contract QA/AI bajo — requiere monitoreo
continuo, no una sola muestra.

### 3.4 RSS — retraso de 6 h

`<legalNotice>...published with a 6-hour delay... accessing the Feed a few times daily is
sufficient... excessive querying may lead to restricted access...</legalNotice>`

## 4–6. Paginación / rate limit / errores

- `count` 1-100 (sin `offset`/`page`; ventana de recientes, patrón RemoteOK/Remotive).
- Rate limit: "polling more than once per hour is discouraged"; sin valor numérico.
- `industry` inválido → 400 con URL de ayuda; `tag` corto → 400; `/apidocs` → inaccesible (§7).

## 7. robots.txt — no verificable en vivo (bloqueante)

Cuatro intentos a `https://jobicy.com/robots.txt` (2026-07-20, dos user-agents): todos `403` con
Cloudflare Managed Challenge (`Just a moment...`). `https://jobi.cy/robots.txt` (dominio de docs)
sí responde `200`, pero **no gobierna** `jobicy.com/api/v2`. La API responde `200` a GET directos,
pero eso no sustituye la verificación de `robots.txt` que el proyecto exige. **No habilitar hasta
resolver** (reintentar en otra sesión, o aceptar el riesgo vía decisión humana).

## 8. Términos de uso

Solo el aviso embebido (`friendlyNotice` en API, `legalNotice` en RSS): atribución con enlace
directo y botones de aplicación que redirijan a la URL original — patrón RemoteOK/Remotive. Sin
página de ToS dedicada accesible (docs bloqueadas por Cloudflare).

## 9. Mapeo al schema `opportunity`

`external_id` ← `id` (entero estable). `employment_type` ← `jobType` (array, real). `service_category`
← `jobIndustry` (correcto por job; **no** confiar en el parámetro `industry=`). `compensation_*` ←
`annualSalaryMin`/`annualSalaryMax`/`salaryCurrency` (documentados por el repo, no verificados con
caso poblado). `compliance_method` = `blocked_pending_robots_verification`.

## 10. Riesgos

1. `robots.txt` no verificable (§7) — **bloqueante** hasta confirmarlo por otra vía.
2. Filtro `industry=` roto — requiere filtrado client-side.
3. `/apidocs` inaccesible — dependencia del espejo de GitHub como fuente de verdad.
4. Volumen `Contract`/`Freelance` bajo en muestra puntual — necesita muestreo repetido.
