# Plan de reputación de empleador — BuscoTrabajo.co

Estado: **Fases R0-R3 completas, R4 y R5 bloqueadas (decisión del usuario: quedarnos en 2 fuentes).** Igual que `SEO-PLAN.md`,
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
| **Great Place to Work Colombia** | ✅ GO-CON-CUIDADO (alcance reducido) | Solo insignia certificado/no certificado, sin score continuo. **Corrección tras implementar (Fase R3)**: sí expone una API REST pública real de WordPress (`wp-json/wp/v2/certificaciones`, sin auth) — mejor de lo que encontró la investigación inicial (que solo veía el AJAX+nonce del front-end). Es un archivo histórico (806 filas desde 2021), no solo el ciclo vigente — filtrado a ±13 meses (certificaciones GPTW valen 12 meses) da ~154 vigentes reales. ToS del sitio sigue prohibiendo reuso comercial y logo sin permiso escrito — sin cambios en ese riesgo. |
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
| **R2** | Fetcher de Merco Talento + tabla `company_reputation_alias` + alias curados iniciales + UI de atribución | Datos reales de Merco visibles en una vacante real, tests, QA manual | ✅ Hecho |
| **R3** | Fetcher de Great Place to Work Colombia (insignia binaria) | Insignia visible, tests, QA manual | ✅ Hecho |
| **R4** | Fetcher de Computrabajo — checkpoint explícito antes de codear, dado el lenguaje específico de su Aviso Legal | Datos reales visibles, tests, QA manual | ❌ Bloqueada (ver §5.4) |
| **R5** | Badge de LinkedIn (Follow Company Plugin, solo frontend) | Badge visible, sin cambios en BD | ❌ Bloqueada (ver §5.5) |

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

### 5.2 Resultado de la Fase R2

Construido:

- `src/db/schema.sql` — tabla `company_reputation_alias`.
- `src/sources/reputation/merco.ts` — fetcher real: maneja el salto de
  cookie de merco.info (`fetch` nativo, sin librería de cookie-jar
  nueva), parser por regex verificado contra el HTML real, y una
  validación de **contenido** (≥150 filas), no solo de status code —
  merco.info responde 200 con "la página no existe" para rutas mal
  formadas, así que confiar solo en el status habría podido guardar
  datos vacíos/corruptos.
- `src/db/company-reputation-repository.ts` — `upsertReputationAliases()`
  y `getReputationForCompanies()` (una sola query batcheada por página,
  nunca N+1; una empresa sin alias confirmado no aparece en el resultado,
  nunca un fuzzy-match en tiempo de lectura).
- `scripts/seed-merco-aliases.ts` — 87 filas de alias (cubriendo 77 de
  las 200 empresas de Merco), cada una verificada a mano cruzando el
  nombre real contra los ~5,000 nombres distintos de `jobs.company`. Un
  cruce más laxo (substring) daba 127 "candidatos" con falsos positivos
  reales (`SURA` → `Truchas Suralá SAS`, `LATAM` → 35 empresas no
  relacionadas) — descartado a propósito.
- `src/server.ts` — `reputation` adjunta a `GET /api/jobs`, `GET
  /api/jobs/:id`, y al `firstPage` que alimenta `window.__SSR_JOBS__` de
  `/dashboard`. La rama SSR de `/empleos/:id/:slug` se dejó **fuera**
  deliberadamente: esa ruta nunca serializa el job (solo arma `<head>`),
  así que no hay ningún consumidor para el dato ahí — agregarlo habría
  sido código sin uso.
- `src/components/ReputationBadges.tsx` — texto + link, nunca logo;
  no renderiza nada si no hay entradas. Montado en `JobDetailPanel.tsx`
  (que ya es compartido por `Dashboard.tsx` y `JobLanding.tsx` vía
  spread del objeto `job` — ninguno de los dos necesitó cambios propios).
- `tests/validate-reputation-tick.ts` — extendido con el parser contra
  dos fixtures reales (`tests/fixtures/merco-talento-sample.html`, un
  recorte fiel de la página pública real con las 200 filas intactas, y
  un fixture corto de fallback) y con la tabla de alias/lookup (filas de
  prueba propias, nunca red real en la suite automática — el fetch en
  vivo se corrió a mano, ver abajo).
- `docs/QA-CHECKLIST-REPUTATION.md` — sección 2 completa.

**Verificado en esta sesión, de punta a punta contra producción real** (no
solo tests): `npm run build` y `npm run test:reputation` en verde (16
checks). `npx tsx scripts/seed-merco-aliases.ts` insertó 87 alias reales.
`npm run reputation:tick` corrió contra merco.info en vivo:
**200/200 filas reales** insertadas en `company_reputation`
(`1 fuente(s) registrada(s)`, `Total upserted: 200`). Confirmado por query
directa: Bancolombia (10000), Nestlé (7264), Rappi (5405), todos con
`source_url` apuntando a la página real. `GET /api/jobs/:id` de una
vacante real de Bancolombia devuelve la reputación correcta; vacantes de
empresas sin alias devuelven `reputation: []`. **Verificación visual con
capturas de pantalla reales** (`run-job-radar-apify`, 0 errores de
consola): la sección "Reputación como empleador" se ve limpia en la
página de vacante individual, con atribución en texto y link "Ver
fuente" — sin logo; el `/dashboard` (lista, panel de detalle, filtros)
se ve exactamente igual que antes para una vacante sin reputación — cero
regresión visual. `npm run test:seo` y `npm run test:dashboard-filters`
en verde.

### 5.3 Resultado de la Fase R3

Construido:

- `src/sources/reputation/gptw.ts` — fetcher paginado contra
  `wp-json/wp/v2/certificaciones` (API REST real, sin auth), filtro de
  vigencia a 395 días (GPTW certifica por 12 meses; el endpoint es un
  archivo histórico desde 2021, no solo el ciclo vigente — sin este
  filtro se mostraría una certificación vencida como si estuviera activa
  hoy, justo el tipo de inferencia que prohíbe la regla 5 de
  `AGENTS.md`), y una validación de rango de sanidad (50-1000 filas
  vigentes) en vez de un conteo fijo como Merco.
- `src/sources/reputation/html-entities.ts` — decodificador de entidades
  numéricas extraído de `merco.ts` a un módulo compartido, porque GPTW
  también las usa (`&#8217;` → `'`, `&#038;` → `&`) — evita duplicar la
  misma función en dos fetchers.
- `scripts/seed-gptw-aliases.ts` — 35 filas de alias (30 empresas),
  verificadas cruzando las ~154 certificaciones vigentes contra
  `jobs.company`, mismo estándar que Merco (nunca fuzzy-match). Varias
  empresas coinciden con las que ya tenían alias de Merco (Accenture,
  Deloitte, Compensar, etc.) — el esquema ya lo soportaba sin cambios.
- `src/components/ReputationBadges.tsx` — agregado el label de GPTW; la
  rama de "sin score, solo certificación" ya existía desde R2 y no
  necesitó ningún cambio de lógica.
- `tests/validate-reputation-tick.ts` — extendido con
  `filterCurrentCertifications()` contra un fixture real (154 filas
  vigentes + 5 viejas de 2021, mismo estándar de "fixture real, no
  inventado" que Merco) y con el caso nuevo de una empresa con alias de
  **dos** fuentes a la vez resolviendo ambas entradas sin mezclarlas.
- `docs/QA-CHECKLIST-REPUTATION.md` — sección 3 completa.

**Verificado en esta sesión, de punta a punta contra producción real**:
`npm run build` y `npm run test:reputation` en verde (25 checks). `npx tsx
scripts/seed-gptw-aliases.ts` insertó 35 alias reales. `npm run
reputation:tick` corrió **2 fuentes registradas**: Merco (200 filas, sin
cambios) + GPTW (154 filas nuevas, en vivo contra
`greatplacetowork.com.co`) — 354 filas totales. Confirmado por query
directa: Accenture resuelve **ambas** fuentes (Merco 1149/merco-talento-
index, GPTW certificación) con sus propias URLs. **Verificación visual
con captura de pantalla real** (`run-job-radar-apify`, 0 errores de
consola): la vacante real de Accenture muestra las dos entradas
correctamente, cada una con su "Ver fuente" — nunca un logo. `npm run
test:seo` y `npm run test:dashboard-filters` en verde.

### 5.4 Fase R4 — bloqueada (Computrabajo)

El usuario confirmó el mismo criterio de riesgo ya aceptado para el
scraping de vacantes de Computrabajo (proceder pese a su Aviso Legal). El
bloqueo real no fue ese — fue técnico: **no hay forma segura de descubrir
a escala la URL de evaluaciones de una empresa arbitraria**.

Investigación en vivo esta sesión:

- La página de evaluaciones en sí **sí es accesible directo, sin
  bloqueo** (`co.computrabajo.com/empresas/evaluaciones-en-<slug>-<hash>`,
  200 real, verificado con Alpina: score `4.6`, `9.306` reseñas —
  patrones DOM exactos ya identificados:
  `<span class="fwB mr5"> 4.6</span>` y
  `<span class="fc_gray">9.306</span>` junto al link "Evaluaciones"). El
  `slug` es cosmético igual que en nuestras propias URLs de vacante — solo
  el `hash` importa para resolver la página.
- El **descubrimiento** del hash por nombre de empresa no tiene camino
  limpio:
  - `/empresas/` (directorio/buscador) → 403, probado con `curl` y con un
    navegador real (Playwright) — bloqueo real, no solo de bots simples.
  - Existe una API de autocompletado dedicada
    (`api-sug.computrabajo.com/company/get`, visible en el HTML del
    formulario de búsqueda) pero no se pudo determinar su formato exacto
    de parámetros sin acceso a las devtools de una sesión de navegador
    real — varios intentos razonables devolvieron `"Bad Request"`.
  - Usando el mismo proxy de traducción que ya usa
    `scrapeComputrabajo()` para vacantes (`translate.goog`) con
    Playwright para observar la petición real: **Google respondió con un
    reCAPTCHA** (`google.com/sorry/...`) tras pocas peticiones en poco
    tiempo — detenido de inmediato, evadir un CAPTCHA está prohibido por
    la regla 8 de `AGENTS.md`. Ese mismo proxy es del que depende hoy en
    producción el scraping de vacantes de Computrabajo cada 15 minutos —
    seguir insistiendo arriesgaba ese servicio ya funcionando, no solo
    esta feature nueva.
  - Buscar por nombre de empresa como palabra clave de vacante (reusando
    el patrón ya probado del scraper de vacantes) es ruidoso: trae
    ofertas de empresas no relacionadas que solo mencionan el nombre
    buscado en el texto, no un link confiable al perfil real de esa
    empresa.

**Decisión del usuario**: quedarse en las 2 fuentes ya construidas (Merco
+ GPTW) en vez de forzar un mecanismo de descubrimiento poco confiable o
arriesgar el scraper de vacantes ya en producción. R4 queda bloqueada,
no cancelada — si en el futuro aparece una forma legítima de resolver el
descubrimiento (ej. alguien inspecciona a mano la petición real desde
las devtools de un navegador con sesión), se puede retomar reusando el
parser de la página de evaluaciones ya identificado arriba.

### 5.5 Fase R5 — bloqueada (LinkedIn)

Mismo bloqueo estructural que R4, encontrado en vivo esta sesión:

- El widget oficial "Follow Company Plugin" de LinkedIn (el único de las
  15 fuentes investigadas originalmente pensado para terceros, ver §2)
  necesita el **ID numérico** de la empresa (`data-id="1234"`), no su
  nombre ni su slug de vanidad.
- El listado de vacantes de LinkedIn que este proyecto ya scrapea
  (`scrapeLinkedIn()`) **no expone ese ID en ningún lado** — verificado
  contra una respuesta real del endpoint de guest jobs: cada tarjeta de
  vacante solo trae el link de vanidad de la empresa
  (`linkedin.com/company/<slug>`), nunca un `urn:li:company:<id>` ni
  equivalente.
- El único lugar donde ese ID numérico es obtenible es la propia página
  de empresa de LinkedIn (`/company/<slug>`) — y el `robots.txt` de
  LinkedIn bloquea **todo** `/` para el grupo genérico `User-agent: *`
  (confirmado de nuevo esta sesión), el mismo bloqueo total que ya
  encontró la investigación original para las páginas de vacantes.
  Conseguirlo automatizadamente repetiría exactamente el tipo de acción
  que ya se evitó en R4 (regla 8 de `AGENTS.md`).

**Decisión del usuario**: mismo criterio que R4 — quedarse en las 2
fuentes ya construidas (Merco + GPTW) en vez de perseguir un mecanismo de
descubrimiento que requeriría scraping bloqueado. R5 queda bloqueada, no
cancelada.

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

**El pipeline queda completo en su alcance actual, las 5 fases planeadas
resueltas**: R0-R3 construidas y en producción (2 fuentes reales, Merco
Talento + Great Place to Work Colombia, 354 filas verificadas, UI con
atribución en texto). R4 (Computrabajo) y R5 (LinkedIn) quedan bloqueadas
por el mismo tipo de problema técnico real — descubrimiento de
identificador por empresa sin scraping prohibido — no por falta de
intención (ver §5.4 y §5.5). No hay ninguna fase de código pendiente
forzada.

Si en el futuro aparece una forma legítima de resolver el descubrimiento
en cualquiera de las dos (ej. acceso a devtools de una sesión real de
navegador, o un cambio en la política de acceso de esas plataformas),
ambas quedan documentadas con el parser/patrón ya identificado, listas
para retomar sin tener que reinvestigar desde cero.

## 8. Extensión: página de empresa (`/empresas/:slug`)

Pedido posterior del usuario, no una de las fases R0-R5: desde el
dashboard, al ver una vacante, el nombre de la empresa lleva a una página
propia con su reputación completa y sus vacantes activas — sin tener que
consultar la base de datos a mano.

Reutiliza casi todo lo ya construido: `getReputationForCompanies()`,
`ReputationBadges.tsx`, y `CategoryJobRow.tsx` (el mismo componente de fila
que ya usan las páginas de categoría de SEO). Piezas nuevas:
`resolveCompanyBySlug()` (mismo patrón de resolución en memoria que
`resolveCategorySlug()`, respaldado por los `raw_company_name` distintos
de `company_reputation_alias` en vez de un array estático),
`GET /api/companies/:slug`, `CompanyLanding.tsx`, y un filtro `company`
**exacto** (no fuzzy) nuevo en `applyJobFilters()`.

**Alcance deliberado**: sin SSR todavía — es navegación de dashboard, no
una fase SEO; el fallback SPA genérico ya cubre una carga directa de
`/empresas/:slug`. Si se quiere el beneficio SEO más adelante, es una
fase aparte, mismo patrón que ya se usó para `/dashboard` y las
categorías.

**Corrección hecha en esta misma sesión, antes de dar la fase por
terminada**: la primera versión enlazaba el nombre de *cualquier* empresa,
sin verificar si tenía reputación — como `/empresas/:slug` solo resuelve
empresas con al menos un alias confirmado, esto llevaba a un 404 real
para la inmensa mayoría de empresas (verificado en vivo con "Caseware").
Corregido: el nombre solo es un link cuando `job.reputation.length > 0`
(dato que el backend ya adjunta a cada job) — nunca un link roto.

**Verificado en esta sesión**: `npm run build` y `npm run test:reputation`
en verde (29 checks). Navegación real de punta a punta con Playwright:
desde la página de una vacante de Accenture, clic en el nombre de la
empresa → llega a `/empresas/accenture`, con Merco + GPTW mostrados
correctamente y su vacante activa listada — 0 errores de consola.
Confirmado con captura de pantalla que una empresa sin reputación
("Caseware") ya no muestra ningún link. `npm run test:seo` y
`npm run test:dashboard-filters` en verde.
