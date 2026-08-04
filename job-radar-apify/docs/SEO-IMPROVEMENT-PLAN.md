# Plan de mejora SEO con claude-seo — BuscoTrabajo.co

Estado: **plan activo, fases 0-1 hechas**. Este documento es la
continuación operativa de `docs/SEO-PLAN.md` (que queda como el registro
histórico del diagnóstico y de lo ya arreglado — secciones §9 y §10) una
vez instalado el plugin [claude-seo](https://github.com/AgriciDaniel/claude-seo)
(25 skills, 18 agentes, `/seo <comando>`, scope `local`, no comprometido
al repo).

## 0. Cómo usar este documento (léelo primero, siempre)

**Regla no negociable:** antes de tocar cualquier cosa relacionada con
SEO en este proyecto (rutas de `server.ts`, `job-seo.ts`, sitemap,
schema, robots.txt, hreflang, contenido de vacantes, etc.), leer este
archivo completo. Después de terminar un cambio, actualizar la tabla de
fases (sección 3) con el resultado — mismo patrón que ya usa
`docs/SEO-PLAN.md`.

**Regla de seguridad, la razón de que "no dañar nada" sea posible de
verificar y no solo una intención:** correr `/seo drift compare` (sección
2) contra las URLs de baseline **antes y después** de cualquier cambio
que toque una página pública. Si `/seo drift compare` marca algo
`CRITICAL` que el cambio no explica intencionalmente, parar y revisar
antes de seguir — no asumir que "los tests pasan" es suficiente, `test:seo`
verifica forma/regresión funcional, no señales de SEO que Google
realmente lee (título, canonical, hreflang, schema, CWV).

**Los no-negociables de siempre siguen aplicando, sin excepción:**

1. **Nunca inventar datos** (AGENTS.md #5) — ni un salario, ni una
   descripción, ni un volumen de búsqueda de keywords. Si claude-seo o
   cualquier fuente externa no da un dato real y verificable, se omite o
   se pide al usuario — nunca se rellena con una estimación disfrazada de
   hecho.
2. **Solo lectura por defecto.** `test:seo` es de solo lectura contra la
   BD real (no hay BD de test separada, ver `docs/SEO-PLAN.md` §0). Los
   scripts del plugin (`content_quality.py`, `sitemap_discovery.py`, etc.)
   son de solo lectura salvo que se pida explícitamente lo contrario
   (`indexnow_submit.py`, `indexing_notify.py` escriben hacia afuera —
   confirmar antes de correrlos).
3. **Migraciones de esquema, siempre aditivas** (`ALTER TABLE ... ADD
   COLUMN IF NOT EXISTS`, mismo estilo que
   `scripts/migrate-last-seen-at.ts`/`scripts/migrate-indexing-queue.ts`)
   y corridas explícitamente, nunca automáticas.
4. **Una fase por sesión**, verificable antes de seguir con la siguiente
   — no encadenar varias fases de la tabla de la sección 3 en una sola
   sesión solo porque el presupuesto de contexto alcance.
5. **Verificación propia antes de decir "listo"**: `npx tsc --noEmit`,
   `npm run build`, `npm run test:seo` (+ `test:dashboard-filters` /
   `test:companies-search` si se tocó `server.ts`), y `/seo drift
   compare` contra el baseline — nunca delegar esa verificación al
   usuario como si fuera un gate pendiente.
6. **`/seo setup` para dependencias, nunca un `pip install` manual** — el
   plugin usa su propio venv aislado (`~/.claude/skills/seo/.venv/` o el
   equivalente de plugin data), igual que el resto de este proyecto nunca
   instala nada global sin necesidad.

## 1. Qué ya está hecho (no repetir)

Ver `docs/SEO-PLAN.md` §9 (diagnóstico completo, 2026-08-04) y §10 (fixes
aplicados, mismo día): bug de churn de URL (`last_seen_at`, migrado en
producción), hreflang + canonical real entre `/` y `/ve`, descripción del
JobPosting enriquecida y medida con `content_quality.py` (69→83
`overall_quality`). Los tres verificados con `tsc`, `build`, `test:seo`,
`test:dashboard-filters`, `test:companies-search` en verde.

**Bloqueante real que ningún paso de este plan reemplaza:** el desglose
de Search Console → Indexación → Páginas (motivos de exclusión + conteos
reales). Solo el usuario puede sacarlo (UI, sin equivalente en la API).
Decide si la Fase 3 (crawl budget / autoridad) o la Fase 4 (calidad de
contenido) importa más a partir de aquí — no bloquea empezar ninguna de
las dos, pero sí decide en cuál invertir más tiempo primero.

## 2. Primer paso al reiniciar sesión: baseline de `seo-drift`

Antes de cualquier fase nueva de la tabla de abajo, capturar un baseline
de las páginas que representan cada patrón real del sitio (no las 22,000
una por una — una muestra representativa, igual que hace
`scripts/check-search-console.ts` con `SAMPLE_URLS`):

```
/seo drift baseline https://buscotrabajo.co/
/seo drift baseline https://buscotrabajo.co/ve
/seo drift baseline https://buscotrabajo.co/dashboard
/seo drift baseline https://buscotrabajo.co/empleos/bogota
/seo drift baseline https://buscotrabajo.co/ve/empleos/project-manager
/seo drift baseline https://buscotrabajo.co/empleos/<un-id-real>/<slug>
```

Guardado en SQLite local (`~/.cache/claude-seo/drift/baselines.db`), no
en este repo. Después de esto, **cualquier sesión futura que toque una de
estas rutas (o su lógica compartida en `job-seo.ts`/`server.ts`) corre
`/seo drift compare` contra la(s) URL(es) afectada(s) antes de dar el
cambio por terminado.**

## 3. Fases propuestas (una por sesión)

| Fase | Qué hace | Skill/agente | Exit criteria | Estado |
| --- | --- | --- | --- | --- |
| 0 | Diagnóstico de causa raíz (bug de churn, thin content, hreflang) | (manual, pre-plugin) | Confirmado con evidencia en vivo | ✅ Hecho — `SEO-PLAN.md` §9 |
| 1 | Fixes de mayor apalancamiento ya identificados | (manual) | `test:seo` + `tsc` + `build` en verde | ✅ Hecho — `SEO-PLAN.md` §10 |
| 2 | Baseline de drift (sección 2 de este doc) | `seo-drift` | Baseline guardado para las 6 URLs de muestra | ⬜ Pendiente |
| 3 | Confirmar causa raíz con datos reales de Google | `seo-google` (`gsc query`, `inspect`, `sitemaps`) | Requiere que el usuario traiga el desglose de Search Console, o las credenciales `GOOGLE_INDEXING_CLIENT_EMAIL`/`GOOGLE_INDEXING_PRIVATE_KEY` en el entorno local | ⬜ Bloqueado — depende del usuario |
| 4 | Auditoría de contenido programático a escala | `seo-programmatic`, `seo-content` | Score de unicidad real sobre una muestra de páginas de vacante; decidir si la Fase 4 del plan viejo (descripciones reales por fuente) se vuelve necesaria | ⬜ Pendiente |
| 5 | Auditoría técnica completa | `seo-technical`, `seo-sitemap` | 9 categorías revisadas contra el sitio real; confirmar que nada de lo nuevo (hreflang, `last_seen_at`) introdujo una regresión técnica | ⬜ Pendiente |
| 6 | Schema.org — validación y oportunidades | `seo-schema` | JobPosting validado contra Rich Results; confirmar cero tipos deprecados | ⬜ Pendiente |
| 7 | Core Web Vitals con datos de campo reales | `seo-google` (`pagespeed`, `crux`) | LCP/INP/CLS con CrUX real, no solo lab data | ⬜ Pendiente (necesita credenciales Google) |
| 8 | GEO / AI Overviews — superficie sin tocar hoy | `seo-geo` | Reporte de citability score sobre una página de vacante y una de categoría | ⬜ Pendiente |
| 9 | Investigación de keywords (solo si hay fuente de datos real) | `seo-google` (`keywords`, Tier 3) o extensión DataForSEO | **No arranca sin credenciales reales** — nunca un volumen inventado | ⬜ Bloqueado — depende de credenciales que el usuario decida conectar |

No hay una fase "10" ya definida — cualquier trabajo más allá de esto
(backlinks, contenido adicional, un tercer país) es exploratorio y
necesita su propio diagnóstico antes de entrar a esta tabla, mismo
criterio que ya usa `docs/SEO-PLAN.md` §8.

## 4. Qué NO hacer

- No correr `/seo audit` (el orquestador de 15 subagentes en paralelo)
  como primer paso — es caro en tiempo/contexto y la mayoría de sus
  hallazgos ya están cubiertos por el diagnóstico manual de `SEO-PLAN.md`
  §9. Usarlo más adelante, una vez agotadas las fases específicas de la
  tabla, como auditoría de cierre.
- No instalar extensiones pagas (DataForSEO, Ahrefs, SE Ranking,
  Profound) sin que el usuario decida explícitamente traer sus propias
  credenciales — ninguna es necesaria para las fases 2-8.
- No tocar `robots.txt`/`sitemap*.xml` fuera de lo que una fase concreta
  de la tabla justifique — ya están verificados sanos (`SEO-PLAN.md` §9.1).
