# Plan de reputación de empleador — BuscoTrabajo.co

Estado: **Fases R0 y R1 completas.** Igual que `SEO-PLAN.md`,
esto se ejecuta en fases, una por sesión, cada una verificable antes de
seguir con la siguiente — no es un commit de una sola vez.

## 0. Proceso de QA (aplica a todas las fases, no solo a la primera)

Misma regla que ya usa `SEO-PLAN.md` §0: cada fase que toque código entrega
verificación automatizada (`tests/validate-*.ts`) de solo lectura contra la
tabla `jobs`, más un checklist manual para lo que no se puede probar sin
ojos humanos. **Este proyecto no tiene base de datos de test separada** — el
mismo `DATABASE_URL` de `.env` es el de producción — así que cualquier
prueba nueva de reputación debe ser de solo lectura contra `jobs`, y puede
escribir/borrar únicamente sus propias filas de prueba en la tabla nueva
`company_reputation` (nunca en `jobs`), en un `finally` que las limpie
siempre.

## 1. Qué se pidió y por qué

El usuario pidió mostrar la reputación de cada empresa como empleador junto
a sus vacantes, agregada de varias fuentes (mínimo 10, con el logo de cada
una junto a su puntaje) — mejora reportada comparándola con lo que hacen
Indeed/Glassdoor. Antes de escribir una línea de código se lanzó una
investigación profunda: 3 agentes en paralelo (`source-researcher`,
solo lectura + web), 15 fuentes candidatas repartidas en 3 grupos
(mainstream global, Colombia/LatAm, alternativas/nicho), cada una evaluada
contra: ¿API pública?, ¿ToS sobre scraping/reuso?, ¿widget oficial
embebible por terceros?, ¿dato numérico real y matcheable por empresa?,
¿política de uso de logo?

## 2. Resultado de la investigación (15 fuentes)

| Fuente | Veredicto | Motivo |
|---|---|---|
| **Merco Talento** (Colombia) | ✅ GO-CON-CUIDADO | Índice real 0-10000, ~200 empresas grandes, HTML plano sin JS, sin cláusula anti-scraping hallada. Sin política de logo (tratar como no autorizado). |
| **Computrabajo** (ya se scrapea para vacantes) | ✅ GO-CON-CUIDADO | Rating real 1-5 + conteo de reseñas, verificado en vivo (ej. Alpina 4.6★/9.305 reseñas). Su Aviso Legal prohíbe scraping y logo expresamente — mismo riesgo ya aceptado hoy para vacantes. |
| **Great Place to Work Colombia** | ✅ GO-CON-CUIDADO (alcance reducido) | Solo insignia certificado/no certificado (~357 orgs/ciclo), sin score continuo. ToS prohíbe reuso comercial y logo sin permiso escrito. |
| **LinkedIn** | ✅ GO-CON-CUIDADO (solo badge en vivo) | No tiene rating, solo conteo de seguidores. Único widget oficial de los 15 pensado para terceros ("Follow Company Plugin") — pero renderiza client-side, no es un número que el backend pueda guardar/cachear. |
| **Google Places API** | ❌ Descartado | Mide satisfacción de clientes, no de empleados (dato equivocado). Su ToS prohíbe cachear el valor del rating — choca con la arquitectura ya acordada. Campo `rating` solo en el SKU Enterprise (de pago). |
| Glassdoor | ❌ NO-GO | Sin API self-serve; WAF bloquea con 403 el 100% de solicitudes verificadas, incluidas páginas de reviews (no solo vacantes); ToS exige "permiso escrito expreso". |
| Indeed (reviews) | ❌ NO-GO | Mismo patrón que Glassdoor: robots.txt permite la ruta pero el WAF bloquea en la práctica; ToS prohíbe scraping/IA explícitamente. |
| Comparably | ❌ NO-GO | "Culture API" es partnership gestionado por ventas, sin pricing público; widget solo self-serve para la propia empresa. |
| Trustpilot | ❌ NO-GO | No es de reputación de empleador (es de consumidor); API de pago Enterprise; TrustBox solo lo genera la empresa dueña de su propio perfil. |
| Kununu | ❌ NO-GO | Sin API oficial; cobertura confirmada solo DACH, sin evidencia de Colombia/LatAm. |
| AmbitionBox | ❌ NO-GO | Sin API/widget; anti-bot agresivo (403 hasta en robots.txt); foco India, irrelevante para Colombia. |
| RepTrak | ❌ NO-GO | API enterprise sin precio público; ranking gratuito limitado a ~100 marcas globales. |
| Crunchbase | ❌ NO-GO (automatizado) | Ya no tiene tier gratuito de API (desde 2025); es dato de legitimidad/tamaño, no de reputación de empleador. |
| Universum | ❌ NO-GO | Verificado en vivo: cero datos públicos de Colombia hoy, en ningún segmento. |
| Elempleo | ❌ NO-GO | No tiene sistema de reviews/rating propio (solo microsites pagados de marca empleadora). ToS también prohíbe explícitamente scraping/entrenamiento de IA. |
| Rankings de revistas colombianas (Semana/Portafolio/Dinero) | ❌ NO-GO | Solo cubren periodísticamente los resultados de Merco/GPTW — redundante, sin metodología propia. |

**Hallazgo transversal** (se repitió, sin coordinación, en los 3 grupos de
investigación): los "widgets oficiales embebibles" de estas plataformas
están diseñados para que **la propia empresa reseñada** los publique en
**su propio sitio**, tras reclamar y verificar su perfil — no existe (salvo
el caso puntual de LinkedIn, que no es un score) un servicio pensado para
que un agregador externo muestre el rating de empresas arbitrarias sin su
cooperación.

## 3. Decisiones tomadas (usuario, 2026-08-01)

1. **Logos**: atribución en texto + link de vuelta a la fuente real, nunca
   renderizar el logo de terceros. Ninguna fuente con dato real autoriza su
   reuso (o no tiene política pública, lo que se trata igual).
2. **Computrabajo**: se incluye pese a su prohibición explícita de scraping
   de evaluaciones — mismo criterio de riesgo ya aceptado para su scraping
   de vacantes (ver `docs/QA-CHECKLIST-*` y decisiones previas del
   proyecto).
3. **Google Places**: descartado por completo (dato equivocado + conflicto
   de ToS con el cacheo).
4. **Alcance real: 4 fuentes, no 10+.** El pedido original de "mínimo 10"
   se contrastó contra el research: la mayoría de los NO-GO no son una
   cuestión de tolerancia al riesgo (como Computrabajo) sino bloqueos
   técnicos duros que `AGENTS.md` regla 8 ya prohíbe evadir (403 en el 100%
   de solicitudes honestas, sin API, sin dato para Colombia). El usuario
   confirmó construir con las 4 fuentes reales — Merco, Computrabajo, GPTW,
   LinkedIn — dejando la gestión de permisos escritos con más plataformas
   (GPTW, Merco, Comparably, Trustpilot) como una vía paralela humana/de
   negocio, no algo que se ejecute en código.

## 4. Arquitectura

### 4.1 Tabla `company_reputation` (nueva, aditiva)

```sql
CREATE TABLE IF NOT EXISTS company_reputation (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name  VARCHAR(255) NOT NULL,   -- nombre EXACTO tal como aparece en la fuente
    source        VARCHAR(50) NOT NULL,    -- 'merco' | 'computrabajo' | 'gptw'
    score         NUMERIC,                 -- NULL para fuentes sin score continuo (GPTW)
    score_scale   VARCHAR(50) NOT NULL,    -- ej. 'merco-talento-index-2025', '1-5', 'certified' — nunca comparable entre escalas distintas
    review_count  INTEGER,
    source_url    TEXT NOT NULL,           -- link real de atribución, obligatorio
    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_name, source)
);
```

LinkedIn no tiene fila aquí — es un badge en vivo, solo frontend (Fase R5),
nunca un número guardado (su propio widget oficial no expone ese dato a un
backend, y guardarlo violaría el espíritu de cómo LinkedIn lo diseñó).

### 4.2 Mapeo empresa↔fuente: curado, nunca automático

Merco usa razones sociales en mayúsculas que no siempre coinciden con
`jobs.company` (ej. `PROCAFECOL (JUAN VALDEZ)`). Promediar/adivinar ese
match automáticamente sería inventar un dato (regla 5 de `AGENTS.md`). En
vez de eso: tabla `company_reputation_alias` (`raw_company_name` tal como
aparece en `jobs.company` → `company_name` canónico de la fuente),
poblada a mano, empezando solo por las ~200 empresas de Merco Talento (el
universo más grande y confiable). Una vacante sin alias confirmado
simplemente no muestra reputación.

**Nota de scoping (decidido al ejecutar la Fase R1)**: esta tabla se movió
de R1 a R2 — no tenía sentido crear el esquema de alias antes de tener el
primer fetcher real que la use; R1 quedó acotado a la infraestructura de
escritura genérica (tabla `company_reputation`, circuit breaker, script
batch), sin nada específico de una fuente todavía.

### 4.3 Proceso batch, aparte del scraping de vacantes

`scripts/run-reputation-tick.ts`, mismo espíritu que
`scripts/run-indexing-tick.ts` (SEO Fase 3): corre por su cuenta, workflow
de GitHub Actions propio (`reputation-tick.yml`), cadencia semanal o
mensual (estos rankings cambian con frecuencia anual/semestral, no en
tiempo real — a diferencia del scraping de vacantes cada 15 min).

### 4.4 Reutilizar el circuit breaker existente, no duplicar

`isSourceDegraded`/`recordFailure`/`recordSuccess`
(`src/engine/resilient-fetch.ts`) ya son genéricos sobre
`source_circuit_state` — no son específicos de vacantes. Solo
`executeWithResilience` está tipado a `Promise<Job[]>`; se generaliza a
`<T>(sourceName, fetcher: () => Promise<T[]>): Promise<T[]>` (cambio
mecánico, no rompe ningún adaptador existente) en vez de escribir un
wrapper de reintentos nuevo desde cero.

### 4.5 UI

Nueva sección "Reputación" en `JobDetailPanel.tsx` (panel de detalle del
dashboard) y en `JobLanding.tsx`/la SSR de `/empleos/:id/:slug` en
`server.ts` — esto último también ayuda a la limitación de "contenido
delgado" que `SEO-PLAN.md` Fase 1 §5.2 ya dejó documentada como pendiente:
reputación real es contenido real y variable en la página de cada vacante.
Cada score se muestra con su atribución en texto + link, nunca un logo.
Vacantes sin alias confirmado no muestran la sección en absoluto (nunca un
placeholder ni "unknown" visible).

## 5. Fases (una por sesión, cada una con criterio de salida)

| Fase | Qué entrega | Criterio de salida | Estado |
|---|---|---|---|
| **R0** | Este documento | Aprobado | ✅ Hecho |
| **R1** | Esqueleto: tabla `company_reputation`, generalización de `executeWithResilience`, `run-reputation-tick.ts` (sin fetcher real todavía) + workflow, tests | `npm run build` + tests en verde, cero regresión en scraping/SEO existente | ✅ Hecho |
| **R2** | Fetcher de Merco Talento + tabla `company_reputation_alias` + alias curados iniciales + UI de atribución | Datos reales de Merco visibles en una vacante real, tests, QA manual | Pendiente |
| **R3** | Fetcher de Great Place to Work Colombia (insignia binaria) | Insignia visible, tests, QA manual | Pendiente |
| **R4** | Fetcher de Computrabajo — checkpoint explícito antes de codear, dado el lenguaje específico de su Aviso Legal | Datos reales visibles, tests, QA manual | Pendiente |
| **R5** | Badge de LinkedIn (Follow Company Plugin, solo frontend) | Badge visible, sin cambios en BD | Pendiente |

### 5.1 Resultado de la Fase R1

Construido:

- `src/db/schema.sql` — tabla `company_reputation` (RLS habilitado, cero
  políticas, mismo patrón que el resto de tablas del proyecto).
- `src/engine/resilient-fetch.ts` — `executeWithResilience` generalizado a
  `<T>` (antes fijo a `Job[]`); los 13 adaptadores de vacantes existentes
  siguen compilando sin cambios (inferencia de tipos automática).
- `src/sources/reputation/types.ts` + `index.ts` — `ReputationScoreInput`,
  `ReputationSourceAdapter`, y `REPUTATION_SOURCES = []` (vacío a
  propósito — mismo patrón "enviado inactivo" que ya usa el gateway de
  prompts LLM del monorepo).
- `src/db/company-reputation-repository.ts` — `upsertReputationScores()`,
  batcheado, `ON CONFLICT (company_name, source)`.
- `scripts/run-reputation-tick.ts` + `.github/workflows/reputation-tick.yml`
  (cron semanal) + `npm run reputation:tick` — corre limpio hoy con 0
  fuentes registradas.
- `tests/validate-reputation-tick.ts` (`npm run test:reputation`) — circuit
  breaker genérico (probado con un tipo distinto a `Job`), upsert +
  semántica de actualización, `REPUTATION_SOURCES` vacío, y el script real
  corriendo de punta a punta vía subproceso.
- `docs/QA-CHECKLIST-REPUTATION.md` — checklist nuevo, sección 1 (Fase R1)
  completa, sección 2 como placeholder para R2 en adelante.

**Verificado en esta sesión**: `npx tsx scripts/migrate.ts` aplicó la tabla
nueva sin tocar ninguna existente. `npm run build` sin errores. `npm run
test:reputation` en verde (10 checks). Regresión confirmada en verde:
`npm run test:seo` y `npm run test:dashboard-filters`. `npm run
test:adapters` mostró una falla en Indeed (403 real de Indeed, bloqueo ya
documentado en la investigación de reputación de esta misma sesión) — no
relacionada con este cambio, confirmado con el diff de
`resilient-fetch.ts` (solo cambio de tipos, cero cambio de lógica en
runtime).

## 6. Riesgos y cómo se mitigan

- **ToS de Computrabajo**: riesgo aceptado explícitamente por el usuario,
  mismo criterio que ya aplica a su scraping de vacantes.
- **Sin política de logo en Merco**: mitigado mostrando solo atribución en
  texto + link, nunca el logo.
- **Escalas no comparables entre fuentes** (índice Merco 0-10000 vs. rating
  Computrabajo 1-5 vs. insignia binaria GPTW): mitigado con `score_scale`
  explícito por fila — nunca normalizar/promediar a un solo número.
- **Matching empresa↔fuente incierto**: mitigado con la tabla de alias
  curada a mano — nunca fuzzy-match automático.
- **LinkedIn no es un score, es solo un conteo de seguidores**: se presenta
  así en el UI, nunca mezclado visualmente con los scores de reputación
  reales de las otras 3 fuentes.

## 7. Próximo paso

**Fase R2** — primer fetcher real: Merco Talento (la fuente más limpia, sin
cláusula anti-scraping hallada, ~200 empresas en una sola página HTML). Trae
consigo la tabla `company_reputation_alias`, el primer lote de alias
curados a mano, y la sección "Reputación" en `JobDetailPanel.tsx`/
`JobLanding.tsx` con atribución en texto + link (nunca logo).
