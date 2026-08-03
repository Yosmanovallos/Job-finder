# Plan de implementación — WorkanaV2 (ingesta de catálogo global)

Estado: **propuesta, no ejecutada.** Este documento es el resultado de analizar
el repo completo (scrapers, adaptadores, cadencia, dedupe, servidor) sin
modificar nada, más una medición real (parcial) del volumen de Workana.
Escrito para ejecutarse por fases con Claude Code, una fase por
sesión/contexto, según `AGENTS.md` regla 1 y `CLAUDE.md`.

Fuentes revisadas para este plan: `src/sources/index.ts`,
`src/queue/source-cadence.ts`, `src/queue/scrape-worker.ts`,
`scripts/run-scrape-tick.ts`, `src/engine/resilient-fetch.ts`,
`src/db/job-repository.ts`, `src/db/scheduler-repository.ts`,
`src/lib/job-filters.ts`, `src/server.ts` (`GET /api/jobs`),
`src/sources/workana.ts`, `src/sources/workana-v2.ts`,
`src/scrapers/workana-v2-scraper.ts`, `src/scrapers/workana-v2-volume-test.ts`,
`.github/workflows/scrape-jobs.yml`, `.github/workflows/scrape-jobs-ve.yml`,
`docs/source-catalog/workana.md`, `tests/validate-adapters.ts`.

---

## 0. Nota de gobernanza (léela antes de ejecutar nada)

`docs/source-catalog/workana.md` (investigado 2026-07-25) documenta que
Workana devuelve 403 en cada request y que sus términos de servicio
(reportados vía snippets, no verificados verbatim porque la propia página de
ToS también da 403) prohíben acceso automatizado/scraping. Su recomendación
explícita es **retirar** el scraper, no ajustarle el pacing.

El 2026-07-27 ya decidiste mantener Workana en rotación "aunque dé 0"
(memoria `scraper-source-tos-decisions`). Esa decisión cubre *seguir
intentando y fallando* contra el bloqueo. **WorkanaV2 es un salto de alcance
distinto**: en vez de fallar con 403, `got-scraping` con fingerprint TLS de
Chrome sí pasa el bloqueo, y en vez de ~5 requests/rol falla-y-listo, esto
propone requests recurrentes y exitosos contra un catálogo que, medido abajo,
tiene ~900 vacantes/día — no es la misma decisión con otra herramienta, es
bypass activo y sostenido de un control anti-bot documentado.

Este plan **no decide eso por ti**. Antes de la Fase 1, confirma
explícitamente que quieres extender la decisión del 27-07 a este alcance
mayor. Si confirmas, este documento sirve como el registro de esa decisión
(equivalente a la ADR que pide la regla 13 de `AGENTS.md`); si no, el POC
existente (`src/scrapers/workana-v2-scraper.ts`,
`src/sources/workana-v2.ts`) queda como está: sin usar, sin efecto.

---

## 1. Lo que YA existe — no reconstruir nada de esto

Preguntaste específicamente cómo identificar vacantes nuevas y organizarlas
en el buscador/dashboard sin repetir. La respuesta es: **el pipeline ya lo
hace**, para cualquier fuente que entregue objetos `Job` — no hay que escribir
un clasificador ni un detector de "nuevo" a medida para WorkanaV2.

- **Deduplicación multicapa** (`src/db/job-repository.ts::saveJobs`,
  L52-178): hash SHA-256 de URL normalizada (`computeUrlHash`) +
  fingerprint de contenido `título|empresa|ubicación`
  (`computeContentFingerprint`). Si coincide cualquiera de los dos con una
  vacante activa existente, no se inserta fila nueva — se fusiona la fuente
  dentro del array `sources` (jsonb) de la vacante ya guardada. `savedCount`
  vs `duplicateCount` es literalmente el conteo de "nuevas" vs "ya la
  teníamos" en cada tick.
- **Clasificación por rol en tiempo de consulta, no al guardar**
  (`src/lib/job-filters.ts::jobMatchesRole`, L61-67): el campo `role_origin`
  guardado en la fila solo registra qué rol la *descubrió primero* — no se
  usa para decidir en qué categoría se muestra. Cada vez que el dashboard
  pide `/api/jobs?roles=...`, el texto del `title` se compara contra el
  vocabulario expandido (sinónimos ES/EN) de cada rol trackeado
  (`DEFAULT_ROLES_200`). Esto es exactamente "identificar si una vacante que
  llega corresponde a algo que ya buscamos" — ya corre para RemoteOK,
  GetOnBoard, WeRemoto (que tampoco usan keywords), y correría igual para
  WorkanaV2 sin cambiar una línea de este archivo.
- **Las vacantes que no matchean ningún rol trackeado SÍ se listan igual**
  (`src/server.ts` `GET /api/jobs`, L267-309): el filtro `roles` es opcional
  y client-driven (checkboxes en `FilterBar.tsx`). Sin ese filtro, el
  endpoint devuelve el corpus completo activo, ordenado por
  `published_at DESC`. Es decir: si WorkanaV2 trae una vacante de un rol que
  no está en los 200 trackeados, igual aparece en el feed principal del
  dashboard — el requisito "que se listen aunque no haya nada relacionado en
  la app" ya está resuelto por diseño, no es algo que falte construir.
- **Frescura/"nuevo" visual**: `is_locked` se computa en SQL como
  `published_at > NOW() - INTERVAL '48 hours'` (L211 de `job-repository.ts`)
  y alimenta tanto el paywall como cualquier filtro de "últimas 24h/48h" en
  `job-filters.ts` L237-245. WorkanaV2 ya popula `publishedAt` por vacante
  (`parseRelativeDate`, ver §5 sobre un borde frágil ahí).

**Conclusión de esta sección**: no hay brecha de arquitectura que cerrar para
"identificar nuevas vacantes y listarlas". La única brecha real es que
WorkanaV2 (el archivo) no está conectado al pipeline que ya hace todo esto.

---

## 2. Hallazgo de volumen real (medido, no asumido)

El POC original probó con 3 páginas → 26 vacantes y asumió "~10 páginas ≈
200/día". Antes de escribir este plan corrí
`src/scrapers/workana-v2-volume-test.ts` contra `publication=24h` (medición
real, sin escribir en la base de datos — solo lee y cuenta) y lo corté a
propósito en la página 22/100 apenas el patrón fue inequívoco, para no
generar cientos de requests reales innecesarios contra una fuente con ToS ya
en conflicto (ver §0):

```
Página 1: 9 vacantes | Total de páginas disponibles: 100
Páginas 1-22: consistentemente 8-9 vacantes/página → 197 vacantes en 22 páginas
```

Extrapolado (no medido exhaustivamente): **la ventana de 24h tiene del orden
de 900 vacantes**, no ~200. Esto cambia el diseño:

- Traer "todo el catálogo del día" en una sola corrida (100 páginas) es
  inviable: son ~100 requests reales en un solo proceso, contra una fuente
  que ya bloqueaba con 403 hace una semana, corriendo dentro de un
  presupuesto de tick de 3 minutos (`GLOBAL_CATALOG_TIMEOUT_MS`, ver §4).
  Eso es justo el patrón de tráfico que dispara controles anti-bot, aparte
  del riesgo de ToS ya aceptado.
- La estrategia correcta con la arquitectura actual **no es** "traer las 900
  de una vez", es la misma que ya usa RemoteOK/GetOnBoard/WeRemoto: **traer
  un lote acotado (primeras N páginas, que son las más recientes) cada pocas
  horas, y dejar que el dedupe de `saveJobs` absorba la repetición** entre
  corridas. Con paginación por recencia, cada corrida solo aporta como
  "nuevas" las que de verdad llegaron desde la corrida anterior — el resto
  se funde como duplicado a bajo costo (una consulta indexada, no un insert).
- Esto sí implica un trade-off real que no puedes resolver sin observar
  producción: si el catálogo mete más de N-páginas-de-vacantes nuevas entre
  dos corridas, algunas quedan sin capturar hasta que caduquen de las
  primeras páginas. La Fase 4 de este plan es justamente medir eso y
  ajustar `maxPages`/cadencia con datos reales en vez de adivinar.

---

## 3. Cambios concretos para integrar el adaptador (diff, no código final)

Archivos a tocar — todo lo demás del sistema queda intacto:

### 3.1 `src/sources/index.ts`
Importar y registrar `workanaV2Adapter` (ya existe en
`src/sources/workana-v2.ts`, sin usar):
```ts
import { workanaV2Adapter } from "./workana-v2.js";
// añadir a allAdapters[] y al bloque de re-exports
```

### 3.2 `src/queue/source-cadence.ts`
`workanaV2Adapter.fetch()` ignora `keywords` por diseño (trae el catálogo
completo, no busca por rol) — igual que RemoteOK/GetOnBoard/WeRemoto. Por
eso va en `GLOBAL_SOURCE_CADENCE_MS`, **no** en `SOURCE_CADENCE_MS`:
```ts
export const GLOBAL_SOURCE_CADENCE_MS: Record<string, number> = {
  RemoteOK: 1 * HOUR_MS,
  GetOnBoard: 1 * HOUR_MS,
  Jooble: 6 * HOUR_MS,
  WeRemoto: 4 * HOUR_MS,
  WorkanaV2: /* ver §4 antes de fijar este número */
};
```
**No** lo agregues a `GLOBAL_SOURCE_CADENCE_MS_VE`: Workana no es un catálogo
segmentado por país (a diferencia de Jooble), así que el tick de VE
volvería a traer el mismo catálogo global que ya trajo el tick de CO —
exactamente la razón por la que RemoteOK/GetOnBoard/WeRemoto tampoco están
en el mapa `_VE` (comentario existente en `source-cadence.ts` L71-77).

### 3.3 Decisión pendiente: qué hacer con el adaptador `Workana` original
Hoy `workanaAdapter` (`src/sources/workana.ts`) sigue en `allAdapters` y en
`SOURCE_CADENCE_MS` a 48h, disparando hasta 12 requests por keyword por rol
contra una fuente que devuelve 403 en el 100% de los casos — es tráfico real
gastado en fallar, y es justo el patrón "muchos requests dispersos" que
querías evitar. Dos opciones, ninguna aplicada todavía:

- **(a) Recomendada, reversible**: quitar `"Workana"` de `SOURCE_CADENCE_MS`
  (dejar el archivo/adaptador intacto, solo deja de estar "due" nunca). Cero
  requests contra la variante rota, cero riesgo, un solo diff de una línea
  si se quiere revertir.
- **(b)** Eliminar `workanaAdapter` de `allAdapters` por completo. Más
  limpio a largo plazo, pero borra código que la memoria del 27-07 registró
  como decisión explícita de "dejarlo intentando" — cambiarlo ahora
  contradice esa decisión salvo que la reabras con el usuario.

Este plan asume (a) por defecto porque es la opción reversible que no pisa
la decisión previa, pero está marcado como pendiente de confirmación
explícita, no como hecho.

### 3.4 Consecuencia de que ambos adaptadores compartan `source: "Workana"`
`workana-v2-scraper.ts` L35 y L311 escriben `source: "Workana"` a propósito
(comentario en `workana-v2.ts` L14-15: mismo label limpio en la UI sin
importar qué adaptador la encontró). Efecto real: si el adaptador viejo
alguna vez guardó una vacante (antes del 403) y WorkanaV2 la vuelve a
encontrar, `computeContentFingerprint`/`computeUrlHash` la reconocen como la
misma fila y la fusiona — no cuenta como "nueva" ni se duplica. Es el
comportamiento correcto; se documenta aquí para que nadie lo lea como bug
en una revisión futura.

---

## 4. Presupuesto de tiempo del tick — esto sí puede romper algo si no se ajusta

`runGlobalCatalogSourcesWithTimeout` (`scripts/run-scrape-tick.ts` L187-208)
corre **todas** las fuentes globales vencidas **secuencialmente**, acotado a
`GLOBAL_CATALOG_TIMEOUT_MS = 3 min` (L51). Si ese presupuesto se agota,
`runGlobalCatalogSources` devuelve `null` y **`markGlobalSourceRun` no se
llama para ninguna fuente de ese lote** — la fuente sigue "vencida" y se
reintenta en el siguiente tick (15 min después), lo cual en el peor caso es
solo ineficiente, no corrompe datos (lo ya guardado antes del corte queda
persistido, por diseño de `saveJobs` por-item).

Con `maxPages=10` y jitter de 2-4s entre páginas, WorkanaV2 sola puede tomar
~40-80s por corrida (10 fetches reales + ~9 pausas de jitter). Si su cadencia
coincide con la de WeRemoto (ambas a 4h, mismo momento de "vencidas"), compite
por el mismo presupuesto de 3 minutos con paginación HTML de WeRemoto
también. No tengo medición de cuánto tarda WeRemoto hoy, así que no afirmo
que vaya a desbordar — pero es el escenario a vigilar en la Fase 4.

Mitigación recomendada (barata, sin tocar el resto del sistema):
- Fijar la cadencia de `WorkanaV2` en un valor que **no coincida** con la de
  WeRemoto (p. ej. `3 * HOUR_MS` en vez de `4 * HOUR_MS`) para reducir la
  probabilidad de que ambas estén "vencidas" en el mismo tick.
- Si en la Fase 4 (verificación en producción) se observa que el paso
  global se acerca al límite de 3 min, subir `GLOBAL_CATALOG_TIMEOUT_MS` a
  4-5 min es un cambio de una constante, de bajo riesgo, antes de tocar
  `maxPages`.

---

## 5. Riesgo que el POC local NO puede validar: IP de datacenter

El POC y la medición de volumen de este documento corrieron desde tu
máquina (IP residencial/ISP). **GitHub Actions corre desde rangos de IP de
datacenter de Azure**, que Cloudflare puntúa distinto al fingerprint
TLS/JA3 — `got-scraping` resuelve la huella del navegador, no la reputación
de la IP de origen. Que el POC pase en local **no es evidencia** de que
pase igual desde el runner de GitHub Actions.

Esto es la verificación de mayor valor de todo este plan y la más fácil de
saltarse por accidente — está aislada como Fase 3 abajo, con criterio de
éxito explícito antes de confiar en la cadencia.

---

## 6. Borde frágil conocido (no bloqueante, documentarlo)

`parseRelativeDate` (`workana-v2-scraper.ts` L138-184): si el texto de fecha
no matchea ningún patrón conocido, cae al `else` final y devuelve "ahora"
(`hoursAgo = 0`) en vez de `null`. Como `publishedAt` alimenta directamente
`is_locked` (paywall de 48h) y el filtro de frescura, una fecha no
reconocida se vuelve silenciosamente "recién publicada". No es un blocker
para integrar, pero si en producción aparecen vacantes con fecha rara
marcadas como frescas sin serlo, este es el primer lugar a mirar.

---

## 7. Fases de ejecución

Cada fase = una sesión/contexto nueva de Claude Code (regla de
`CLAUDE.md`). No encadenar fases en una sola sesión aunque el presupuesto de
contexto alcance.

### Fase 1 — Confirmación de alcance (humano, no código)
Confirmar con el usuario la nota de gobernanza (§0): ¿se extiende la
decisión del 27-07 a un scraper que sí logra pasar el bloqueo, a este
volumen? Sin esto, no hay Fase 2.

### Fase 2 — Wiring local (código, sin red real necesaria para el diff)
Aplicar §3.1-3.3. Ejecutar localmente:
- `npx tsx src/scrapers/workana-v2-scraper.ts` (ya existe como test
  standalone) para confirmar que sigue funcionando igual que en el POC.
- `npm run test:adapters` — nota: esto llama `adapter.fetch()` de **todos**
  los adaptadores en vivo, incluido WorkanaV2 (ignora las keywords de
  prueba y trae su catálogo completo igual) — esperar que esa corrida tome
  ~1 min más que antes, no es un fallo.
- `npm run test:dedupe` para confirmar que la fusión por `url_hash`/
  `content_fingerprint` sigue intacta con la fuente nueva en la mezcla.
- Verificar tú mismo los resultados (no delegarlo al usuario como gate) antes
  de pasar a la Fase 3.
- **No commitear, no pushear** — cambios locales únicamente hasta que el
  usuario los revise.

### Fase 3 — Verificación en GitHub Actions real (la que valida §5)
Disparar el workflow manualmente (`workflow_dispatch` en
`scrape-jobs.yml`) desde una rama de prueba (no `main` sin aprobación) y
revisar el Job Summary que genera `writeSummary`
(`scripts/run-scrape-tick.ts` L210-265): buscar la fila `WorkanaV2` en la
tabla de resultados. Criterio de éxito explícito: `fetched > 0` y **sin** el
flag `⚠️ posible bloqueo/caída (0 resultados)`. Si sale en 0, el runner de
Actions sí está siendo bloqueado por IP y hay que reconsiderar el enfoque
(proxy residencial, cookies de sesión — no cubierto por este plan) antes de
seguir.

### Fase 4 — Observación y ajuste de cadencia/maxPages (datos reales)
Con 2-3 días de corridas reales: comparar `savedCount` vs `duplicateCount`
por corrida de WorkanaV2 en el Job Summary. Si `duplicateCount` domina
consistentemente, la cadencia/páginas actuales cubren bien el flujo nuevo.
Si `savedCount` se mantiene alto y constante (señal de que cada corrida
sigue encontrando "primera vez que la vemos" en toda la ventana de páginas,
no solo al final), subir `maxPages` o bajar la cadencia — con los números
reales de §2 y §4 delante, no a ciegas.

### Fase 5 — Resolver la decisión pendiente de §3.3
Con datos de 2-4 semanas, decidir (a) vs (b) para el adaptador `Workana`
original con el usuario.

---

## 8. Reglas duras para quien ejecute este plan

- Nunca commitear ni pushear sin aprobación explícita en cada fase.
- Nunca saltar la Fase 3 (verificación real en Actions) asumiendo que el
  POC local ya lo probó — no es la misma red.
- Nunca subir `maxPages` o bajar la cadencia sin haber leído primero el
  Job Summary de al menos una corrida real (Fase 4) — evitar adivinar
  números que aumenten el volumen de requests contra una fuente con ToS ya
  en conflicto.
- Si cualquier paso requiere tocar `.env`, `private/**`, `secrets/**` o
  `backups/**`: detenerse y preguntar (regla de `CLAUDE.md`).
