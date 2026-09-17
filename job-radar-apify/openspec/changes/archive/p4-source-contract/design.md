# Diseño — P4: contrato de fuentes y transporte

Contratos, consultas, límites, compatibilidad y rollback. Escrito **después**
de medir: cada número de este documento sale de una consulta sobre
`source_attempts` / `source_circuit_state` de producción, ejecutada con
`scripts/verify-p4-source-contract.ts` (solo lectura) el **2026-09-16** sobre
una ventana de **7 días**. Ninguna cifra es una estimación de escritorio —
esa fue la lección cara de P3.

---

## 1. Lo que dijeron los datos (y qué premisa tiraron abajo)

### 1.1 La premisa del borrador no se sostiene

`proposal.md` decía que había que mirar «qué fuentes se quedan sin
presupuesto» y que eso ordenaría la adopción. Medido:

```
── Se quedan sin presupuesto (listing skipped) ──
(ninguna)
```

**Cero** listados omitidos por presupuesto en 7 días, con 17 fuentes. Los
plazos de P3 no están matando a nadie. La premisa era razonable a priori y
resultó vacía: el orden de adopción tiene que salir de otro sitio.

### 1.2 Dónde está el daño real: la etapa de detalle

| Etapa | Salud medida (7 días) |
| --- | --- |
| `listing` | ~236 `success` frente a ~4 no-`success`. Sana. |
| `detail` | Concentra **todo** el fallo. |

Detalle, fuente por fuente:

| Fuente | Intentos | Páginas pedidas | Detalles obtenidos | Estados |
| --- | --- | --- | --- | --- |
| Computrabajo | 24 | 102 | **0** | 12 `empty/no_detail`, 9 `partial`, 3 `success` |
| Computrabajo-VE | 8 | 22 | 0 (4 intentos) | 4 `empty`, 1 `partial`, 1 `timeout`, 2 `success` |
| LinkedIn | 48 | 335 | 132 | 28 `partial/detail_unavailable`, 4 `partial/deadline`, 2 `empty` |
| LinkedIn-VE | 36 | 88 | 60 | 17 `partial`, 6 `empty`, 13 `success` |
| Magneto | 13 | 54 | 54→97 recibidos | 12 `success`, 1 `timeout` |
| Elempleo | 12 | 37 | 37 | 12 `success` |

Computrabajo pidió **102 páginas de detalle y obtuvo 0 útiles**, pagando
~3,2 s por página, durante los 7 días completos.

**Consecuencia de diseño:** el borrador justificaba meter el `AbortSignal` de
P3 en los 17 adaptadores con «cada adaptador se abre igualmente en esta
fase». Los datos dicen que P4 debe abrir **aproximadamente uno**. Se retira
esa justificación (ver §6, no-objetivos).

### 1.3 El hallazgo principal: el circuito de detalle no puede abrirse

Dos hechos del código:

1. `src/engine/resilient-fetch.ts` — `executeWithResilience` trata
   **cualquier** array como éxito:

   ```ts
   const results = await fetcher();
   if (Array.isArray(results)) {
     await recordSuccess(sourceName);   // ← también con []
     return results;
   }
   ```

2. `src/queue/scrape-worker.ts` — el sitio de llamada del detalle convierte
   la ausencia de detalle en un array vacío:

   ```ts
   const [detail] = await executeWithResilience(`${adapter.name}-detail`, async () => {
     const result = await adapter.fetchDetail!(ref.url);
     return result ? [result] : [];        // ← null se vuelve []
   }, 3, ctx);
   ```

Juntos: **`fetchDetail()` devuelve `null` → `[]` → `recordSuccess` → el
contador de fallos se reinicia.** El circuito de detalle nunca acumula
fallos, así que nunca se abre.

No es una deducción: está probado en la tabla real de producción.

```
── Estado del circuito por fuente (listado vs. -detail) ──
FUENTE                    FALLOS  ABIERTO  OPEN_UNTIL
Glassdoor                 0       false    —
GlassdoorV2               1       false    —
Indeed                    0       false    —
Workana                   2       false    —
```

Cuatro filas, y **ninguna termina en `-detail`**. `recordFailure` hace
`INSERT ... ON CONFLICT DO UPDATE`; `recordSuccess` solo hace `UPDATE`. Que
no exista la fila `Computrabajo-detail` demuestra que `recordFailure` **no se
ha llamado jamás** por la ruta de detalle en toda la vida de la tabla — pese
a las 102 páginas sin resultado.

Éste es exactamente el defecto que `proposal.md` describe («vacío significa a
la vez "no hay vacantes" y "falló"»), en un sitio que la propuesta no nombró.
Se traza como **SRC-003** en la spec, con escenario de aceptación propio.

### 1.4 Corrección al borrador: los circuitos ya están separados

`proposal.md` afirma que hay «un circuito por fuente, compartido entre
listado y detalle» y que el sufijo `-detail` «mitiga esto a medias». Es
inexacto y conviene no arrastrarlo: `source_circuit_state` tiene
`source_name` como clave, y la ruta de detalle pasa `${adapter.name}-detail`
(`scrape-worker.ts`), así que son **filas completamente distintas**. Lo que
se comparte no es el circuito, sino la **política**: `FAILURE_THRESHOLD = 3`
y `DEGRADED_TIMEOUT_MS = 30 min` son constantes de módulo, iguales para
listado y detalle. Eso es lo que P4 parametriza (SRC-004).

### 1.5 El vocabulario de clasificación existe pero nadie lo emite

`source_attempts.status` admite `blocked`, `rate_limited`,
`quota_exhausted`, `misconfigured` y `schema_changed`. En 7 días de
producción: **cero apariciones de los cinco**. Lo único que aparece es
`success`, `empty`, `partial`, `failed`, `timeout` e `interrupted`.

No es que las fuentes no se bloqueen: es que el contrato `Promise<Job[]>` no
tiene forma de decirlo, así que la clasificación de P2 solo puede inferir lo
que alguna señal suelta le chive. P4 le da al contrato el vocabulario que la
tabla ya sabía almacenar.

### 1.6 Jooble: registrado, no reparado

`Jooble` es la **única** fuente estampada que falta en `KNOWN_SOURCES`
(`src/db/job-validator.ts`): el conjunto contiene `LinkedIn, Computrabajo,
Elempleo, Torre, Magneto, Workana, WeRemoto, GetOnBoard, RemoteOK, Remotive,
Indeed, Glassdoor`. Medido: 3 intentos, 14 recibidas, **0 válidas**, estado
`failed / all_rejected_by_validation`.

La reparación es de P5 (una fuente por entrega, AGENTS.md ground rule #1).
P4 solo garantiza que «todo rechazado por validación» sea un desenlace
clasificado y distinguible de «vacío» (SRC-008). Queda anotado como input de
P5 en el plan maestro.

### 1.7 Calibración de `BUDGET_ESTIMATES.detailFetch`

Medido **por intento** (`duration_ms / páginas de ese intento`) y reportado
en percentiles, no como media global: una media reparte el coste de los
intentos lentos entre las páginas de los rápidos y subestima justo el caso
que el presupuesto debe cubrir.

| Fuente | Intentos | Páginas | p50 | p95 | max |
| --- | --- | --- | --- | --- | --- |
| Elempleo | 12 | 37 | 3912 | 7312 | 7312 |
| LinkedIn-VE | 36 | 120 | 3750 | 6484 | 6661 |
| Computrabajo-VE | 7 | 22 | 4611 | 5834 | 5834 |
| Magneto | 12 | 54 | 3881 | 5572 | 5572 |
| LinkedIn | 48 | 291 | 3220 | 5079 | 5518 |
| Computrabajo | 24 | 118 | 3240 | 4741 | 6651 |
| **GLOBAL** | **139** | — | **3454** | **5816** | **7312** |

**Decisión: `BUDGET_ESTIMATES.detailFetch` se queda en 8000 ms, sin
cambios.** 8000 está **por encima del máximo observado** (7312) y es ~1,4×
el p95. Es la cifra correcta y ahora está *medida*, no supuesta.

Se deja constancia de una corrección hecha durante esta misma fase: una
lectura anterior de estos datos usó la **media** (`SUM(duration)/SUM(pages)`
= 3,1-4,0 s/página) y concluyó que 8000 ms sobraba «por ~2x». Era el
estadístico equivocado para una decisión de presupuesto. Con el p95 real
(5816 ms) la conclusión se invierte: **no tocar**. El valor de P4 aquí no es
cambiar la constante, es convertir una constante no verificada en una
verificada — y dejar la consulta que lo comprueba en el repositorio.

El coste incluye la pausa deliberada de `enrichNewJobs` (3-6 s antes de la
primera página, 1-3 s entre páginas), porque es coste de pared y es lo que
el plazo tiene que pagar de verdad.

`SOURCE_LISTING_ESTIMATE_MS` (el mapa por fuente) **no se toca en P4**: su
recalibración es un pendiente propio del usuario, con su propia herramienta
(`scripts/verify-p3-deadlines.ts --durations`). Para que quede el dato
disponible cuando se retome, la medición de esta sesión es:

| Fuente | p50 medido hoy | constante actual | desvío |
| --- | --- | --- | --- |
| LinkedIn | 121 422 | 81 000 | **+50 %** |
| LinkedIn-VE | 89 018 | 58 000 | **+53 %** |
| Elempleo | 94 031 | 118 000 | −20 % |
| Computrabajo | 77 253 | 75 000 | +3 % |
| Torre | 32 854 | 26 000 | +26 % |
| Magneto | 53 282 | 53 000 | ±0 % |

Dato informativo para el pendiente; P4 no lo aplica.

---

## 2. Contratos

### 2.1 `SourceFetchResult<T>` — `src/sources/fetch-result.ts`

Lo que hoy es un `Job[]` mudo pasa a ser un sobre que dice qué pasó. Reutiliza
el vocabulario que `source_attempts` y `AttemptStatus` (P2) ya tienen, en vez
de inventar uno paralelo: el objetivo es que la clasificación deje de ser una
inferencia y pase a ser un dato declarado por quien lo sabe.

```ts
/** Reutiliza AttemptStatus de P2 — no un vocabulario nuevo. */
export type SourceOutcome =
  | "success"        // trajo todo lo que se le pidió
  | "partial"        // trajo parte: hay datos Y hay una causa que explica el resto
  | "empty"          // la fuente respondió, y no hay nada (de verdad)
  | "blocked"        // deny definitivo (401/403) — no se reintenta
  | "rate_limited"   // 429 / Retry-After — se reintenta cuando toque
  | "quota_exhausted"// la credencial agotó su cuota de vida/periodo
  | "misconfigured"  // falta credencial o configuración
  | "schema_changed" // respondió, pero el parseo ya no reconoce la forma
  | "timeout"        // se acabó el plazo
  | "failed";        // cualquier otro fallo, con error clasificado

export interface SourceFetchCounters {
  /** Lo que la fuente entregó, antes de validar. */
  received: number;
  /** Lo que sobrevivió a la validación. */
  valid: number;
  /** Peticiones HTTP realmente emitidas. */
  requests: number;
  /** null = la fuente no lo reporta. NUNCA inventado (AGENTS.md #5). */
  bytes: number | null;
}

export interface SourceFetchError {
  /** Clase, nunca el mensaje crudo: puede traer URLs con credenciales. */
  readonly class: string;
  /** Código HTTP cuando lo hubo. */
  readonly statusCode?: number;
  /** Milisegundos que la fuente pidió esperar (Retry-After). */
  readonly retryAfterMs?: number;
}

export interface SourceFetchResult<T> {
  readonly outcome: SourceOutcome;
  /** Nunca null: un array vacío es un array. No vacío en success y partial. */
  readonly data: T[];
  readonly counters: SourceFetchCounters;
  /**
   * Presente en todo desenlace que NO sea `success` ni `empty` — incluido
   * `partial`, que es el caso interesante: lleva datos Y error a la vez.
   */
  readonly error?: SourceFetchError;
  /** Razón legible y estable, para source_attempts.reason. */
  readonly reason: string;
}
```

**Por qué `partial` es un desenlace de primera clase y no un `success`
degradado:** es el estado más frecuente de la etapa de detalle en los datos
reales — LinkedIn 28 intentos, LinkedIn-VE 17, Computrabajo 9. Un intento que
obtiene 132 de 335 páginas tiene datos útiles *y* una causa que explica las
203 que faltan; colapsarlo en `success` vuelve a perder exactamente la
información que esta fase existe para conservar. Es también el estado que
`AttemptStatus` de P2 ya usa, así que el vocabulario sigue siendo uno solo.

Invariantes, en forma de tabla para que no se contradigan:

| `outcome` | `data` | `error` |
| --- | --- | --- |
| `success` | no vacío | ausente |
| `partial` | no vacío | **presente** |
| `empty` | vacío | ausente |
| resto (`blocked`, `rate_limited`, `quota_exhausted`, `misconfigured`, `schema_changed`, `timeout`, `failed`) | vacío | presente |

**Invariante que ordena todo el tipo:** `outcome === "empty"` significa *la
fuente contestó y no hay nada*. Cualquier otra causa de `data.length === 0`
tiene su propio `outcome`. Ése es el defecto que P4 existe para cerrar.

### 2.2 `liftJobArray()` — el envoltorio de compatibilidad

El punto que hace posible la adopción gradual (condición 3 del usuario: **no
romper los 17 adaptadores de golpe**).

```ts
/**
 * Envuelve un adaptador que todavía devuelve `Job[]` (los 17 de hoy) en el
 * contrato nuevo, SIN cambiarlo. La clasificación resultante es exactamente
 * la que P2 ya infería — ni mejor ni peor: un array vacío sigue siendo
 * `empty`, porque un adaptador sin migrar no tiene forma de decir otra cosa.
 * Migrar el adaptador es lo que convierte esa suposición en un dato.
 */
export function liftJobArray<T>(data: T[]): SourceFetchResult<T>;
```

Que el resultado del *lift* sea deliberadamente igual de pobre que hoy es
intencional: el envoltorio no debe simular información que el adaptador no
dio. Así la migración de cada adaptador en P5 tiene una mejora medible y no
un cambio cosmético.

**Cómo `SourceAdapter` admite las dos formas sin tocar 16 archivos.** Es el
mecanismo concreto del que depende SRC-002, y conviene fijarlo aquí porque es
donde «los otros 16 no aparecen en el diff» se pone a prueba contra `tsc`:
`src/sources/index.ts` reexporta los 17 y `src/sources/types.ts` declara la
interfaz compartida, así que cualquier cambio a la firma de `fetch` los
alcanzaría a todos a la vez.

Se añade un **método opcional nuevo**, sin tocar el existente:

```ts
export interface SourceAdapter {
  readonly name: string;
  /** Contrato histórico. Sigue siendo el que implementan los 17 de hoy. */
  fetch(keywords: string[], dateRange?: string): Promise<Job[]>;
  /**
   * Contrato de P4. Cuando existe, el wrapper lo prefiere sobre `fetch`.
   * Cuando no, el wrapper llama a `fetch` y aplica `liftJobArray`.
   */
  fetchResult?(
    keywords: string[],
    dateRange?: string,
    ctx?: FetchContext
  ): Promise<SourceFetchResult<Job>>;
}
```

Método opcional y no unión en el tipo de retorno de `fetch`, a propósito: una
unión `Promise<Job[] | SourceFetchResult<Job>>` obligaría a **cada** llamador
a discriminar y generaría errores `tsc` nuevos en los 16 adaptadores sin
migrar — que es justo lo que el gate de 0 errores nuevos prohíbe. Con un
método opcional, los 16 satisfacen la interfaz sin cambiar un carácter, y la
discriminación vive en un único sitio (el wrapper).

Un adaptador migrado conserva `fetch` como delegación de una línea hacia
`fetchResult`, de modo que cualquier llamador antiguo siga funcionando.

### 2.3 `SourcePolicy` — `src/sources/source-policy.ts`

Clave **(fuente, etapa)**, no solo fuente: es la corrección de §1.4.

```ts
export type SourceStage = "listing" | "detail" | "verification";
export type Transport = "direct" | "proxy";

export interface SourcePolicy {
  readonly source: string;
  readonly stage: SourceStage;
  /** Fallos consecutivos antes de abrir. Por defecto 3 (valor de hoy). */
  readonly failureThreshold: number;
  /** Cuánto permanece abierto. Por defecto 30 min (valor de hoy). */
  readonly openForMs: number;
  /** 'direct' por defecto. 'proxy' solo donde esté declarado y autorizado. */
  readonly transport: Transport;
  /** Techo de peticiones por intento. null = sin techo propio. */
  readonly maxRequestsPerAttempt: number | null;
  /** Tope superior al Retry-After que se respeta (una fuente puede pedir 1 h). */
  readonly maxRetryAfterMs: number;
}
```

**Defaults idénticos al comportamiento actual.** Una fuente sin entrada
propia se comporta exactamente como hoy; la tabla de políticas solo puede
hacer que algo cambie cuando alguien escribe una entrada explícita. Eso hace
el rollback trivial (§7).

Vive en **código**, no en base de datos ni en `docs/source-catalog/`:
- en BD obligaría a una migración y a un round-trip por decisión, dentro del
  camino crítico del tick;
- en `docs/` sería documentación que nadie ejecuta, que es como se
  desincroniza;
- en código va en el mismo commit que el comportamiento que describe, y el
  `tsc` la valida.

### 2.4 `FetchRateLimitedError` — `src/engine/rate-limit.ts`

`executeWithResilience` recibe `fetcher: () => Promise<T[]>`: **nunca ve una
respuesta HTTP**, así que no puede leer `Retry-After` por su cuenta. Se sigue
el precedente que ya existe en el repositorio para el caso gemelo
(`FetchBlockedError`, que ya viaja 401/403 hasta el wrapper):

```ts
export class FetchRateLimitedError extends Error {
  constructor(
    readonly label: string,
    readonly statusCode: number,
    readonly retryAfterMs: number
  ) { /* ... */ }
}
```

El wrapper lo entiende y espera vía `sleepWithContext`, que **ya** recorta al
presupuesto restante (`fetch-context.ts`). Así respetar `Retry-After` nunca
puede empujar al tick más allá de su plazo: si la fuente pide más de lo que
queda, se abandona en vez de dormir.

Esto cambia **un** adaptador, no 17.

### 2.5 `executeWithResilienceResult` — hermano que devuelve el resultado

```ts
export async function executeWithResilienceResult<T>(
  sourceName: string,
  stage: SourceStage,
  fetcher: () => Promise<SourceFetchResult<T>>,
  maxRetries?: number,
  ctx?: FetchContext
): Promise<SourceFetchResult<T>>;
```

`executeWithResilience` (el de hoy, `Promise<T[]>`) **se conserva como shim**
sobre el nuevo. Es un requisito duro, no una cortesía: lo comparte la tubería
de reputación (`docs/COMPANY-REPUTATION-PLAN.md`, Fase R1), que no es de esta
fase y no debe enterarse de P4.

---

## 3. El arreglo de SRC-003 (detalle nulo ≠ éxito)

Dentro del contrato nuevo el defecto desaparece por construcción, porque
`fetchDetail() === null` deja de poder disfrazarse de array:

- `null` → `outcome: "empty"`, `data: []`.
- `empty` **no** llama a `recordSuccess`: es un desenlace **neutro** para el
  circuito — ni éxito ni fallo. No reinicia el contador y no lo incrementa.
- Solo `success` reinicia el contador; `failed`/`blocked`/`rate_limited`/
  `schema_changed` lo incrementan.

Por qué neutro y no fallo: una vacante puede legítimamente no tener página de
detalle útil, y convertir eso en fallo abriría circuitos sanos. Lo que no
puede seguir pasando es que **borre** el historial de fallos reales. Neutro es
la lectura honesta de «no aprendí nada de este intento».

Efecto esperado y comprobable: `Computrabajo-detail` aparece por primera vez
en `source_circuit_state` con `failures > 0` (SRC-003, verificación por
canario + lectura de log).

---

## 4. Orden de adopción

Derivado de la tabla de §1.2 (fallo en detalle), **no** de agotamiento de
presupuesto, que no existe:

1. **Los puntos compartidos del wrapper** — `resilient-fetch.ts` y la ruta de
   detalle de `scrape-worker.ts`. Aquí vive SRC-003 y aquí se arregla para
   las 17 fuentes de una vez, sin tocar ninguna.
2. **Un adaptador de demostración** para probar que la migración funciona
   (gate 2) — `torre.ts`. Comprobado leyendo el archivo, no supuesto: son 14
   líneas, **no implementa `fetchDetail`** y llama a `executeWithResilience`
   directamente. En los datos tiene 50 intentos de listado, 50 `success`,
   3659 recibidas / 3654 válidas y **ninguna fila de detalle**. Migrarlo
   ejercita el camino nuevo sin poder estropear enriquecimiento.
3. **Todo lo demás queda sin migrar**, funcionando por `liftJobArray`.

Orden para P5, ya justificado por los datos: Computrabajo (102→0) →
Computrabajo-VE (22→0) → LinkedIn / LinkedIn-VE (parciales masivos) → resto.

---

## 5. Límite de cobertura del canario

Se declara por adelantado, porque P3 enseñó que un `success` sin leer el log
no prueba nada:

- El canario cubrirá **~13 de 17 fuentes**.
- **Glassdoor-CO/VE e Indeed-CO/VE tienen n=1 en 7 días** y viven en
  `scrape-browser-tick.yml`, que corre cada 2 días y que P3 dejó **sin
  verificar**. Ninguna afirmación sobre la ruta de navegador estará
  respaldada por esta ventana — incluida la única observación de
  `swallowed_error` de Glassdoor-CO.
- No se reportará «17/17 en verde». Se reportará qué se vio y qué no.

---

## 6. No-objetivos explícitos de P4

| No-objetivo | Motivo |
| --- | --- |
| Quitar `[key: string]: any` de `Job` | Genera errores `tsc` nuevos en los 17 adaptadores; el gate es **0 nuevos** sobre la línea base heredada 29/295. El tipado fuerte entra al lado, no en sustitución. |
| `AbortSignal` dentro de los 17 adaptadores | La justificación del borrador («se abren igualmente») cae con §1.2: P4 abre ~1. Entra en P5 con cada adaptador. |
| Recalibrar `SOURCE_LISTING_ESTIMATE_MS` | Pendiente propio del usuario, con herramienta propia. Datos de hoy anotados en §1.7 para cuando se retome. |
| Reparar Jooble | P5, una fuente por entrega. P4 solo clasifica el desenlace (SRC-008). |
| Reparar cualquier adaptador concreto | P5. P4 pone el contrato. |
| Cola persistente de enriquecimiento | P6. |
| Evasión de CAPTCHA / login / anti-bot | AGENTS.md #8. Nunca. |

---

## 7. Compatibilidad y rollback

**Compatibilidad.** Tres seguros independientes:

1. `executeWithResilience` conserva su firma `Promise<T[]>` → la tubería de
   reputación no se entera.
2. `liftJobArray` deja a los 17 adaptadores intactos → ninguno se rompe.
3. `SourcePolicy` tiene defaults idénticos a las constantes de hoy → una
   fuente sin entrada se comporta exactamente igual que antes del cambio.

**Rollback.** Por capas, de menor a mayor alcance:

- *Solo política:* borrar la entrada de `SourcePolicy` de la fuente → vuelve
  a los defaults, que son el comportamiento previo. Sin despliegue de código.
- *Solo proxy:* `transport: 'direct'` es el default; no fijar
  `WEBSHARE_PROXY_URL` deja la ruta de proxy inerte.
- *Todo P4:* revertir el commit. No hay migración de esquema
  (`source_attempts` y `source_circuit_state` ya existen y no cambian de
  forma), así que revertir el código revierte la fase entera — a diferencia
  de P2/P3, aquí no queda estado que reconciliar.

**Sin cambios de esquema.** P4 no añade tablas ni columnas: usa el
vocabulario de estados que `source_attempts` ya admitía desde P2 y que hasta
hoy nadie emitía (§1.5).

---

## 8. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Reclasificar desenlaces cambia `deriveRunStatus` y un tick que salía `success` pasa a `partial` | Se compara antes/después por fuente con `verify-p4-source-contract.ts`; `partial` por un fallo que antes se ocultaba es la corrección, no una regresión — pero hay que distinguirla leyendo el log, no por el estado agregado. |
| Abrir por primera vez el circuito de detalle reduce el enriquecimiento | Es el efecto buscado: hoy Computrabajo gasta 102 páginas para 0 resultados. Se mide con `received`/`valid` de detalle antes y después. |
| `Retry-After` no se puede probar en producción (0 `rate_limited` en 7 días) | Gate verificable **solo por prueba**, con fixture. Se declara así en la spec; no se promete canario. |
| La media vs. p95 de §1.7 vuelve a colarse en otra decisión | La consulta queda en el repositorio con el percentil, no con la media, y con el comentario que explica por qué. |
