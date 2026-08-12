# Plan — Descripción completa de vacantes de LinkedIn (BuscoTrabajo.co)

> **SUPERSEDED (2026-08-12).** No continuar este plan. El worktree
> hermano `Job-finder-vacantes-detalle` (rama `feat/vacantes-detalle`,
> mismo repo) ya tiene una implementación real y más completa del mismo
> problema — multi-fuente (LinkedIn/Computrabajo/Magneto) vía un parser
> genérico de `schema.org JobPosting` (`src/lib/job-posting-jsonld.ts`),
> `technologies` guardado en vez de recalculado, salario estructurado
> (`salary_min`/`salary_max`/`salary_currency`/`salary_raw`) y
> `applicant_count`. Ya corrió su propia migración contra la BD real de
> producción (confirmado 2026-08-12 vía `information_schema`). Este
> documento se conserva solo por el hallazgo técnico real de §1
> (estructura de la página de detalle de LinkedIn, JSON-LD vs fallback
> HTML) — útil como referencia, pero no como plan de implementación
> activo. El usuario decidirá cómo/cuándo mergear `feat/vacantes-detalle`.
>
> Dos columnas quedaron en `jobs` por la Fase 1 de este plan y no
> encajan con el diseño de la otra rama: `salary` (VARCHAR, redundante
> con `salary_min/max/currency/raw`) y `description_fetched_at` (sin
> equivalente ahí). Se dejaron sin usar a propósito — nullable, sin
> costo real — hasta que se reconcilien las dos ramas.

Estado original: **plan, nada implementado todavía**. Sin commits, sin
push, mientras se construye y prueba (mismo criterio que
`CV-GENERATION-PLAN.md` §0).

## 0. Por qué existe este documento

`JobDetailPanel.tsx` (rama `feat/cv-generation`) ya tiene construidas las
secciones Descripción/Requisitos/Tecnologías y el extractor determinista
`extract-technologies.ts` — pero están dormidas: **ninguna fuente
scrapeada hoy captura el texto completo de una vacante**, solo la
tarjeta de resultados de búsqueda (título/empresa/ubicación/URL/fecha).
Confirmado en vivo el 2026-08-12 contra 50 vacantes reales del API
(`GET /api/jobs?limit=50`): 0 traían `description`. Este plan agrega esa
captura para **una sola fuente, LinkedIn**, elegida porque es la que
usa el mockup de referencia y porque su página de detalle (a diferencia
de Indeed/Glassdoor) es accesible sin login (`co.linkedin.com/jobs/view/
<slug>-<id>`, mismo patrón no autenticado que ya usa `scrapeLinkedIn()`
en `src/index.ts` contra el endpoint de búsqueda).

## 1. Hallazgos técnicos reales (verificados hoy, no supuestos)

Antes de diseñar nada se probó `fetch()` directo (mismo User-Agent que
`scrapeLinkedIn()` ya usa) contra 6 URLs de detalle reales tomadas del
API en vivo (Colombia y Venezuela, varias empresas/roles):

| Dato | ¿Viene? | Dónde | Notas |
|---|---|---|---|
| Descripción completa | **Sí**, casi siempre | JSON-LD `<script type="application/ld+json">` campo `description` (HTML escapado: `<br>`, `<strong>`, `<ul><li>`) | 5/6 URLs probadas lo traían. La 6ª no tenía JSON-LD en absoluto (ver fallback abajo). |
| Requisitos/bullets | **Sí**, cuando hay descripción | Los `<li>` dentro del HTML de `description` | LinkedIn no separa "requisitos" de "responsabilidades" como secciones con tipo propio — son todos `<li>` sueltos. Ver §3 sobre la decisión de tratarlos todos como una sola lista. |
| Tecnologías | **Sí, indirecto** | Se re-usa `extractTechnologies()` (ya construido) sobre descripción+requisitos combinados | El campo `skills` del propio JSON-LD existe pero vino **vacío (`""`) en las 6 pruebas** — no es una fuente utilizable, se descarta. |
| Tipo de empleo ("Tiempo completo") | **Sí** | JSON-LD `employmentType` (`"FULL_TIME"`, etc.) **y también** en el HTML, `<h3 class="description__job-criteria-subheader">Tipo de empleo</h3>` seguido de un `<span>` con el valor ya en español ("Jornada completa") | Presente en las 6/6 pruebas. Esto resuelve el gap que había flaggeado antes ("Tiempo completo" sin fuente) — si existe, sí hay fuente real. |
| Salario | **Rara vez** | JSON-LD `baseSalary` (`minValue`/`maxValue`/`currency`) | **0/6 pruebas lo traían** — normal, poca oferta en Colombia declara salario. Cuando SÍ está presente, es el valor que el empleador declaró (campo estándar de Schema.org), no una estimación. |
| Postulantes | **Sí** | HTML, texto libre cerca de la clase `num-applicants__figure` (ej. `"25 solicitantes"`) | Confirmado en al menos 1/6. Resuelve el otro gap que había flaggeado ("Postulantes" sin fuente). |

**Riesgo identificado en el propio LinkedIn, importante para "nunca
inventar datos":** además del `baseSalary` real (declarado por el
empleador), LinkedIn a veces muestra en la página un widget separado de
"salario estimado" (algorítmico, no declarado). Ese widget **no se
toca** — el parser solo lee `baseSalary` del JSON-LD, nunca ese otro
elemento. Se documenta aquí explícitamente para que nadie lo conecte
por error más adelante pensando que es "más cobertura de salario".

**Fallback necesario:** la URL sin JSON-LD sí tenía el HTML clásico
(`div.description__text`, mismos `description__job-criteria-*`), así
que el parser necesita dos caminos: JSON-LD primero (más limpio),
HTML crudo como respaldo cuando no hay JSON-LD. Las 6 páginas probadas
se descargaron a `/tmp` solo para esta investigación y no quedaron
guardadas en el repo — la Fase 2 (§4) las vuelve a capturar como
fixtures reales, esta vez sí persistidas en `tests/fixtures/`.

## 2. Diseño

### 2.1 Esquema (migración aditiva, mismo patrón que `country`/`last_seen_at`)

```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS requirements JSONB DEFAULT '[]'::jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS employment_type VARCHAR(50);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary VARCHAR(100);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS applicant_count INTEGER;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS description_fetched_at TIMESTAMPTZ;
```

Todas nullable, todas `IF NOT EXISTS`, corridas explícitamente (mismo
script `scripts/migrate-*.ts`, nunca automático). `getJobs`/
`getJobsCached` usan `SELECT *` (`job-repository.ts`), así que estas
columnas viajan al frontend sin tocar esas queries — el `Job` type ya
tiene `[key: string]: any`.

`description_fetched_at` es la clave de selección del tick (§2.3): NULL
= nunca se intentó, no NULL = ya se intentó (con o sin éxito — un
`NULL` en `description` después de intentarlo significa "LinkedIn no
tenía JSON-LD ni HTML parseable para esta URL", no "todavía no se
probó"; sin esta columna el tick reintentaría esas mismas URLs sin fin).

### 2.2 Módulo de parsing — `src/lib/parse-linkedin-job-detail.ts`

Puro, sin red, testeable con fixtures reales (las 6 páginas ya
descargadas durante la investigación de este plan, sanitizadas — son
datos públicos de LinkedIn, mismo criterio que ya aplica a cualquier
vacante scrapeada hoy).

```ts
interface LinkedInJobDetail {
  description: string;       // prose, tags stripped, entities decoded
  requirements: string[];    // todos los <li> del HTML de description
  employmentType?: string;   // ya en español si vino del HTML criteria
  salary?: string;           // solo si baseSalary existe; nunca estimado
  applicantCount?: number;
}

export function parseLinkedInJobDetail(html: string): LinkedInJobDetail | null
```

Dos caminos internos, en orden: (1) JSON-LD `JobPosting` vía regex +
`JSON.parse` (mismo patrón regex-sobre-HTML que ya usa `src/index.ts`
para el resto del scraping, no se introduce una librería de parsing HTML
nueva); (2) si no hay JSON-LD o el parse falla, `div.description__text`
+ bloques `description__job-criteria-subheader/text` con la misma
extracción de `<li>`. Reutiliza el `htmlEntities()` que ya existe en
`src/index.ts` (exportarlo si no lo está). Devuelve `null` solo si
ninguno de los dos caminos encontró nada — nunca un objeto con campos
inventados.

### 2.3 Tick de enriquecimiento — `scripts/run-linkedin-description-tick.ts`

Mismo patrón exacto que `run-reputation-tick.ts`/`run-cv-retention-tick.ts`:
script standalone, su propio GitHub Actions cron, **separado del scrape
principal** (`scrape-jobs.yml`, cada 15 min) y **separado de cualquier
request de usuario** — nunca se dispara desde `GET /api/jobs/:id` ni
desde una vista SEO (`/empleos/:id`). Motivo: esa página es rastreada
por crawlers a volumen; disparar un fetch a LinkedIn por cada visita de
bot sería el escenario exacto que dispara un bloqueo de IP.

```sql
SELECT id, url FROM jobs
WHERE source = 'LinkedIn' AND description_fetched_at IS NULL AND is_active = TRUE
ORDER BY published_at DESC LIMIT $BATCH_SIZE
```

Jobs más recientes primero — son los que la gente está viendo ahora.

Por cada fila: `executeWithResilience('LinkedIn', ...)` (mismo circuit
breaker que ya protege el scrape de búsqueda — si LinkedIn empieza a
bloquear, ambos flujos se frenan juntos, no compiten) + `jitterDelay()`
entre requests (mismo patrón ya usado). `UPDATE jobs SET description=…,
requirements=…, employment_type=…, salary=…, applicant_count=…,
description_fetched_at=NOW() WHERE id=$1` — un `UPDATE` aislado, nunca
toca el `INSERT … ON CONFLICT` de `saveJobs()` (cero riesgo sobre el
pipeline de dedupe existente).

`BATCH_SIZE` propuesto: 30/corrida, cron horario (mismo patrón que
`indexing-tick.yml`, que también reparte un presupuesto diario en
corridas por hora en vez de un solo lote grande) → ~720/día, un
volumen bajo comparado con el scrape de búsqueda ya aceptado, y
ajustable con datos reales una vez corriendo.

### 2.4 UI

Nada que construir — `JobDetailPanel.tsx` ya consume
`job.description`/`job.requirements` (más `extractTechnologies()` sobre
ambos) y ya cae a la vista actual cuando faltan. Cambio menor
pendiente: agregar `job.salary` (ya soportado como prop) y el tag de
tipo de empleo a la fila de badges cuando `job.employment_type` exista
— hoy esa fila no lo muestra porque no existía la fuente.

## 3. Decisión tomada (2026-08-12)

LinkedIn no distingue "requisitos" de "responsabilidades" — todos los
`<li>` de la descripción quedan en una sola lista `requirements`.
**Decisión del usuario:** mantener el label "Requisitos" tal cual el
mockup, aceptando que en la práctica mezcla responsabilidades del
puesto además de requisitos del candidato — prioridad a la fidelidad
visual con la imagen de referencia sobre la precisión semántica del
label. No reabrir sin razón nueva.

## 4. Fases propuestas (una por sesión, verificable antes de la siguiente)

| Fase | Qué hace | Exit criteria | Estado |
|---|---|---|---|
| 1 | Esquema: 6 columnas aditivas en `jobs` (§2.1) + script de migración | `tsc --noEmit`, migración corrida contra la BD real, confirmada idempotente (correr 2 veces sin error), columnas visibles en `information_schema` | Pendiente |
| 2 | `parse-linkedin-job-detail.ts` + fixtures reales (recapturar 3-6 páginas de detalle reales — las usadas para este plan se descargaron a `/tmp` durante la investigación y no se guardaron en el repo — y guardarlas en `tests/fixtures/`) + `tests/validate-parse-linkedin-job-detail.ts` | Todos los casos pasan: JSON-LD feliz, fallback HTML, página sin ninguno de los dos (`null`), entidades HTML decodificadas, `<li>` extraídos, salario ausente no inventa nada | Pendiente |
| 3 | `updateJobDescription()` en `job-repository.ts` + `getJobsMissingDescription()` + `scripts/run-linkedin-description-tick.ts` + npm script | Corrida real contra la BD de desarrollo (o de prod con `--dry-run` primero) sobre un lote pequeño (5-10 jobs), verificado a mano que los campos guardados coinciden con lo que la página realmente mostraba | Pendiente |
| 4 | Workflow `.github/workflows/linkedin-description-tick.yml` (cron horario, batch 30) | Corrida manual vía `workflow_dispatch` exitosa, logs confirman circuit breaker y jitter activos | Pendiente |
| 5 | Wiring final en `JobDetailPanel.tsx`: tag de tipo de empleo + `job.salary` en la fila de badges cuando existan; decisión de §3 aplicada | Verificación visual en dev contra una vacante real ya enriquecida por la Fase 3/4 — captura mostrando Descripción/Requisitos/Tecnologías/salario poblados con datos 100% reales, cero errores de consola | Pendiente |

Cada fase se implementa y verifica en su propia sesión — no se
encadenan varias en la misma respuesta aunque el presupuesto de
contexto alcance (`AGENTS.md` regla 1).
