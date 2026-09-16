# Diseño — P3: duración, cancelación y cadencia

## Principio rector

Un plazo que no cancela no es un plazo. Pero cancelar mal cuesta vacantes
ya obtenidas — y este repositorio ya pagó ese precio una vez (incidente
del 2026-07-25 citado en `scrape-worker.ts`, que motivó el guardado por
adaptador). De ahí la regla que ordena todo el diseño:

> **Se cancela el trabajo que aún no ha empezado. Nunca el que ya está
> escribiendo.**

## 1. `FetchContext` — nuevo, opcional

`src/engine/fetch-context.ts`:

```ts
export interface FetchContext {
  readonly signal: AbortSignal;
  readonly deadlineAt: number;
  /** ms restantes, nunca negativo. */
  remainingMs(): number;
  /** ¿Cabe una unidad de trabajo que razonablemente tarda `estimateMs`? */
  hasBudgetFor(estimateMs: number): boolean;
  /** Espera abortable: se resuelve al vencer el plazo, no lo ignora. */
  sleep(ms: number): Promise<void>;
  /** Contexto hijo con plazo propio, nunca posterior al del padre. */
  child(budgetMs: number): FetchContext;
}
```

Decisiones:

- **Opcional en toda firma nueva** (`ctx?: FetchContext`). Sin contexto, el
  comportamiento es exactamente el de hoy. Esto es lo que permite adoptarlo
  sin tocar los ~15 adaptadores ni el pipeline de reputación, que comparte
  `executeWithResilience`.
- **`child()` nunca extiende.** `min(padre, ahora + presupuesto)`. Un rol
  no puede darse más plazo del que le queda al tick.
- **`hasBudgetFor` en vez de solo `signal.aborted`.** Arrancar una fuente
  que tarda ~90 s cuando quedan 20 s no es cancelación, es desperdicio con
  un paso extra. Se comprueba *antes* de empezar, no solo durante.

## 2. Dónde se cablea (y dónde no)

| Punto | Cambio | Por qué ahí |
|---|---|---|
| `executeWithResilience` | `ctx?`; no inicia reintento sin presupuesto; backoff 1/3/9 s vía `ctx.sleep` | Punto único por el que pasan todas las fuentes |
| `jitterDelay` | `ctx?`; espera abortable | Suma hasta ~50 s por adaptador en detalle |
| `runListingAttempt` | Comprueba presupuesto antes del fetch | Frontera fetch/persist |
| `processRoleJob` | Presupuesto antes de cada fuente y de cada detalle | Corta el bucle por adaptador |
| `run-scrape-tick.ts` | Presupuesto coherente + cierre acotado | Raíz |
| **Adaptadores** | **Sin cambios** | Heredan cancelación en la frontera del wrapper. Su plumbing es P4/P5 |

La cancelación heredada es real aunque el adaptador no conozca el signal:
tras el plazo **no se inicia ninguna solicitud nueva**, y las esperas
(backoff, jitter) dejan de dormir. Lo que no se puede cortar es una
petición HTTP ya en vuelo — se acota con el cierre del §5.

## 3. Puntos abortables y no abortables (el requisito de mayor riesgo)

**Abortables** — cancelar aquí no pierde nada:
- antes de iniciar una fuente nueva
- antes de iniciar un fetch de detalle nuevo
- durante el backoff de `executeWithResilience`
- durante `jitterDelay`
- entre páginas de un adaptador paginado

**No abortables** — cancelar aquí pierde datos ya obtenidos:
- dentro de `saveJobs()` una vez iniciado
- dentro de `updateJobDetail()` una vez iniciado
- `markRoleSourceRun` / `markGlobalSourceRun` de trabajo ya completado
- el cierre de un intento de P2 (`attempt.finish`)

En código: la comprobación vive **antes** de `runListingAttempt`, y dentro
de él **antes** del fetch. Una vez que `attempt.setPhase("persist")` se
ejecutó, no hay más comprobaciones hasta que el persist retorna. Esta
asimetría es deliberada y está cubierta por EXE-005.

### 3.1 Estimadores de coste — valores iniciales, no constantes derivadas

`BUDGET_ESTIMATES` (`sourceListing` 30 s, `detailFetch` 8 s, `retry` 12 s)
decide qué **no** se inicia. Son una primera aproximación conservadora, a
calibrar con los datos reales de `source_attempts` (P2 ya registra duración
por intento), no valores deducidos de nada.

Consecuencia que conviene tener presente: con menos de 30 s de presupuesto
restante ninguna fuente arranca, y como el techo por lote ronda los 4 min,
**la última fuente de la lista de un rol es sistemáticamente la más
propensa a quedarse fuera**. Es el comportamiento buscado (queda vencida y
la toma el siguiente tick), pero si una fuente concreta aparece siempre al
final del orden de adaptadores podría pasar hambre entre ticks. Vigilar con
`source_attempts` y, si ocurre, rotar el orden o bajar el estimador.

## 4. Presupuesto coherente

El reparto actual permite 23 min de trabajo bajo un plazo de 20. Se
invierte la dirección: **el plazo global es la fuente de verdad y los
sub-plazos se derivan de él**, nunca al revés.

```
TICK_BUDGET_MS      = 20 min   (sin cambio)
RESERVE_MS          =  2 min   (cierre: finish + purge + pool.end)
WORK_BUDGET_MS      = 18 min
  ├─ catálogo global: min(3 min, 25% del restante)
  └─ por lote de roles: restante ÷ lotes pendientes, tope 5 min
```

Cada lote recalcula sobre lo que **queda de verdad**, no sobre un reparto
fijado al inicio. Un lote rápido devuelve su sobrante al siguiente; un lote
lento no se lo roba al cierre, porque `RESERVE_MS` está fuera del reparto.

## 5. Cierre acotado — el tramo que hoy causa el hard-kill

Hoy: `pool.end()` bloquea hasta que los rezagados liberan su cliente. Sin
límite. Es el tramo que llega a los 27 min.

```
1. Vencido WORK_BUDGET: abortar el contexto raíz (no se inicia nada nuevo).
2. Gracia de rezagados: min(restante − RESERVE_MS, 60 s).
   Los persists en curso terminan; los fetch en espera ya se abortaron.
3. recorder.finish() + purgeOldRuns()  — con el plazo de consulta de P2.
4. Promise.race([pool.end(), timeout 10 s]).
5. Si algo sigue vivo: log explícito + process.exit(0).
```

El paso 5 es la diferencia entre terminar por cuenta propia y que Actions
mate el proceso. Un `exit(0)` tras haber cerrado la ejecución de P2 y
habiendo dado su gracia a los persists es correcto: lo guardado está
guardado, y P2 ya registró el desenlace. Lo que se pierde es solo la
petición HTTP en vuelo de un adaptador — que de todos modos se perdía.

`purgeOldJobs()` se mueve **antes** del `writeSummary` solo si hay
presupuesto; si no, se salta con aviso. Es una limpieza de retención, no
tiene por qué correr en todos los ticks.

## 6. Lease atómico — tabla propia, no columnas

**El motivo es verificado, no estético.** `markRoleForImmediateRescan`
(`src/server.ts:876`, endpoint autenticado de rescan) hace:

```sql
DELETE FROM role_source_runs WHERE role_name = $1
```

Un lease guardado en esas columnas lo borraría un rescan manual en pleno
scrape, dejando el par rol/fuente reclamable por un segundo tick mientras
el primero sigue trabajando — exactamente el bug que el lease existe para
evitar. Además `role_source_runs` aloja el centinela `__global__`, cuya
semántica de `last_run_at` no debe perturbarse al reclamar.

```sql
CREATE TABLE IF NOT EXISTS scrape_leases (
    role_name    VARCHAR(255) NOT NULL,
    source_name  VARCHAR(100) NOT NULL,
    run_id       UUID NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
    country      VARCHAR(8)  NOT NULL,
    acquired_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (role_name, source_name)
);
CREATE INDEX IF NOT EXISTS idx_scrape_leases_expiry ON scrape_leases (expires_at);
ALTER TABLE scrape_leases ENABLE ROW LEVEL SECURITY;
-- + añadir scrape_leases al REVOKE ... FROM anon, authenticated de schema.sql
```

Reclamación en **una sola sentencia**, sin lectura previa (una lectura
seguida de escritura es precisamente la carrera que hay que evitar):

```sql
INSERT INTO scrape_leases (role_name, source_name, run_id, country, expires_at)
VALUES ($1, $2, $3, $4, NOW() + ($5::double precision * INTERVAL '1 millisecond'))
ON CONFLICT (role_name, source_name) DO UPDATE
   SET run_id = EXCLUDED.run_id, country = EXCLUDED.country,
       acquired_at = NOW(), heartbeat_at = NOW(), expires_at = EXCLUDED.expires_at
 WHERE scrape_leases.expires_at < NOW()      -- solo si el anterior caducó
RETURNING run_id
```

`RETURNING` vacío = otro tick lo tiene vivo → se salta esa fuente, sin
error. El `WHERE` sobre `DO UPDATE` es lo que hace atómica la reclamación:
PostgreSQL evalúa la fila bloqueada, no una leída antes.

- **Reclamación perezosa.** Se reclama cuando el rol **arranca**, dentro de
  `runRoleWithBudget`, no por adelantado para los 8 candidatos. Reclamar
  antes dejaría a los roles que el presupuesto nunca alcanza reteniendo un
  lease el resto del proceso; y si el proceso muere antes del cierre —
  justamente el escenario que motiva esta fase — quedarían bloqueados
  durante el TTL (~10 min). Eso sería **peor que no reclamar**: sin P3 un
  rol no alcanzado simplemente seguía vencido. Además saca de la ventana de
  trabajo hasta 8×N viajes secuenciales a la base antes del primer scrape.
- **Liberación inmediata.** Cada rol libera sus pares al terminar, no en el
  cierre, para que el siguiente tick pueda tomarlos sin esperar el TTL.
- **Latido:** reutiliza el de `RunRecorder` (60 s, P2). Al latir la
  ejecución, se refrescan los leases de ese `run_id`.
- **Liberación:** `DELETE` al terminar la fuente, en `finally`. Un proceso
  muerto no libera nada — para eso está `expires_at`, no hace falta
  reconciliación aparte.
- **TTL:** `PER_SOURCE_BUDGET + 5 min` de margen.
- **`country` en la fila** para diagnóstico. La separación CO/VE ya la da
  el sufijo `-VE` del nombre de fuente (ver `source-cadence.ts`); esta
  columna no la sustituye.

**Compatibilidad:** sin la tabla migrada, `claimLease` devuelve "concedido"
y registra un aviso. Igual que la telemetría de P2, la coordinación no
puede impedir que se scrapee.

## 7. Roles vencidos que sí reportan

`runWithTimeout` devuelve `perSource: {}` al vencer, así que un rol
expirado borra del informe las fuentes que sí completó — por eso faltaban
Computrabajo, Elempleo y Magneto en el tick 35031341207.

Se cambia a un acumulador compartido: `processRoleJob` escribe en un
`perSource` que el llamador ya posee, de modo que lo completado antes del
plazo sobrevive al vencimiento. No cambia qué se guarda, solo qué se
informa — pero es lo que hace medible el antes/después de esta fase.

## 8. Runtime y workflows

- `node-version: "24"` en los 3 workflows de scraping (alineado con
  `engines.node = 24.18.0`; elimina el EBADENGINE de los 6 `@supabase/*`).
- `npm ci` **sin** `|| npm install`. Hoy `npm ci` ya funciona, así que esto
  no cambia nada en la práctica: convierte un fallo silencioso futuro en un
  fallo visible.
- `timeout-minutes: 27` se mantiene: con el cierre acotado deja de ser la
  vía normal de terminar y vuelve a ser el último recurso que debía ser.

**El primer tick tras el merge es el canario del salto de runtime.** Todos
los gates locales corrieron ya sobre Node 24.18.0, así que prueban que el
*código* funciona en 24 — no que `got-scraping`, `playwright` y los
defaults de TLS de undici se comporten igual **contra las fuentes reales**
en 24. Eso es comportamiento de red, invisible para cualquier suite local.
La línea base contra la que comparar (`35035795482`, Node 20) es:
Computrabajo 7 · Elempleo 5 (+1 timeout) · Magneto 5 · LinkedIn 1 · Torre 1,
todas `success/ok`. Una fuente que pase a `blocked`/`empty` es el salto de
Node, no P3.

`scrape-browser-tick.yml` también pasa a Node 24 y **no se ha ejercitado en
esta sesión**: corre cada 2 días con Playwright y proxy residencial, así que
su resultado no se verá aquí. Queda explícitamente sin verificar.

**Riesgo del salto 20 → 24:** `got-scraping`, `playwright` y los defaults
de TLS de undici cambian de comportamiento entre mayores de Node. Mitigado
lanzando el workflow a mano tras el merge y comparando `source_attempts`
(P2) contra la línea base de esta sesión, fuente por fuente. Si una fuente
se degrada, revertir el runtime es un cambio de una línea.

## 9. Cadencia: qué se hace y qué no

No se mueve el scheduler esta fase (ver `proposal.md`, «Fuera de alcance»).
Sí se hacen dos cosas:

1. **ADR** con la evidencia de pérdida de crons y la recomendación para la
   fase siguiente, pendiente de aprobación de coste del usuario.
2. **Experimento barato:** bajar `*/15` a `*/30` en los dos ticks de
   scraping. Ya se reciben ~6/día igualmente, así que no se pierde
   cadencia real, y pedir 96/día podría ser lo que hace que GitHub
   despriorice este repositorio. Es una **hipótesis medible**, no un
   arreglo conocido: se mide con `scrape_runs` a los 7 días. Si no mejora,
   se revierte con una línea y el ADR queda como la vía.

## 10. Rollback

| Cambio | Reversión |
|---|---|
| `FetchContext` | No pasar `ctx`: cada firma vuelve al comportamiento actual |
| Presupuesto/cierre | Revertir constantes de `run-scrape-tick.ts` |
| Lease | `DELETE FROM scrape_leases` + dejar de reclamar; la tabla puede quedarse vacía sin efecto |
| Node 24 | Una línea por workflow |
| Cron `*/30` | Una línea por workflow |

Migración **aditiva**: ninguna tabla existente cambia de forma. Nada se
aplica a la base real sin autorización explícita del usuario.
