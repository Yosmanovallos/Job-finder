# P3 — Duración, cancelación y cadencia

**Estado:** propuesta con evidencia medida (2026-09-15). Diseño en
`design.md`, plan en `tasks.md`, requisitos en `specs/execution/spec.md`.

## Problema

Los plazos del tick no son plazos: son avisos. `Promise.race`
(`scripts/run-scrape-tick.ts`) resuelve al vencer, pero el trabajo perdedor
sigue buscando y guardando en segundo plano. Desde P2 eso es *visible*
(`timeout` / `deadline_exceeded` en `source_attempts`), pero sigue sin
cancelarse.

## Evidencia medida (no estimada)

### 1. El presupuesto interno no cabe en sí mismo

| Etapa | Presupuesto |
|---|---|
| Catálogo global (`GLOBAL_CATALOG_TIMEOUT_MS`) | 3 min |
| 8 roles ÷ concurrencia 2 = 4 lotes × `PER_ROLE_TIMEOUT_MS` | 20 min |
| **Trabajo permitido** | **23 min** |
| `OVERALL_DEADLINE_MS` | 20 min |
| `timeout-minutes` del workflow | 27 min |

Con 23 > 20, `remainingMs` sale negativo, la espera de rezagados se salta
por completo y el proceso cae en `pool.end()` — que bloquea hasta que los
rezagados liberan su cliente, porque siguen buscando y guardando. Ese
tramo no tiene ningún límite: es el que llega a los 27 min y recibe el
hard-kill de Actions. **3 de los 12 últimos ticks CO (25%) terminaron
`cancelled` a los 27-28 min.**

Run 35031341207 (2026-09-15 22:30 UTC) lo muestra en vivo: agotó los 262 s
completos de gracia (22:46:52 → 22:51:14, exacto) sin que los rezagados
terminaran.

### 2. Fuentes starvadas en silencio

En ese mismo tick la tabla resumen lista 7 fuentes — **faltan
Computrabajo, Elempleo y Magneto**. `runWithTimeout` devuelve
`perSource: {}` cuando un rol vence, así que un rol expirado no reporta
nada de lo que sí alcanzó a hacer. Las fuentes por rol más lentas quedan
fuera del informe de forma sistemática.

### 3. Motor no soportado en cada ejecución

Log de instalación del mismo run:

```
npm warn EBADENGINE required: { node: '24.18.0' }  current: { node: 'v20.20.2' }
   @supabase/{supabase,auth,functions,postgrest,realtime,storage}-js@2.110.8
   required: { node: '>=22.0.0' }  current: { node: 'v20.20.2' }
##[warning] Node.js 20 is deprecated  (GitHub, 2025-09-19)
```

`npm ci` **sí funciona** (`added 349 packages … in 10s`, cero `npm error`):
el fallback `|| npm install` es riesgo latente, no daño activo. El daño
activo es el motor.

### 4. Actions pierde ~94% de los disparos programados

`scrape-jobs.yml` pide `*/15` (96/día) y obtuvo 12 ejecuciones en 47 h.
Cadencia real: cada 1,5-5 h.

La prueba de que **no** es culpa de nuestra configuración la da
`scrape-browser-tick.yml`: pide `0 13 */2 * *`, dura 4 min y tiene su
propio grupo de concurrencia — y dispara a las 15:40, 16:41, 16:47, 16:55,
17:21, 17:58 UTC. Retraso de 3-5 h, siempre. Ni solapamiento ni duración
lo explican: es el planificador de GitHub.

**Impacto real, dicho con honestidad:** menor que el titular. Un rol
vencido sigue vencido hasta que se scrapea, así que el diseño sin estado
absorbe la mayor parte de la pérdida en cadencias de 4-6 h. Las víctimas
reales son RemoteOK y GetOnBoard, a 1 h.

### 5. P2 nunca se había ejecutado

40/40 ejecuciones recientes usaron `74f066b` (commit base). Ninguna usó
`5d41861`. Las 0 filas en `scrape_runs` no eran un defecto de la
telemetría: era código que Actions todavía no había visto.

## Objetivo

Plazos efectivos: al vencer, el trabajo se cancela de verdad, lo ya
guardado persiste, el proceso termina por su cuenta y el siguiente tick
retoma sin duplicar efectos.

## Alcance

- Runtime alineado (Node 24) e instalación reproducible (`npm ci` sin
  fallback silencioso).
- `FetchContext` **opcional**, cableado solo en los puntos de
  estrangulamiento compartidos. Los adaptadores **no** cambian de firma:
  heredan la cancelación en la frontera del wrapper. La instrumentación
  por adaptador es de P4/P5, donde cada uno se abre igualmente.
- Presupuesto comprobado antes de cada fuente, reintento y espera.
- Reclamación atómica rol/fuente con lease y latido, en tabla propia.
- Cierre acotado: ningún tramo posterior al plazo sin límite.

## Fuera de alcance (y por qué)

- **Mover el scheduler.** El lease atómico es requisito previo, no
  acompañante: hoy los solapamientos son raros solo porque los ticks son
  raros. Un disparador fiable de 15 min antes de que exista el lease
  convierte un bug latente en uno constante. Además el plan maestro
  condiciona la mudanza a coste aprobado. Recomendación registrada en
  `docs/adr/` para la fase siguiente.
- **`AbortSignal` dentro de cada adaptador** (P4/P5).
- **Cola persistente de enriquecimiento** (P6). Aquí solo se desacopla su
  plazo del camino crítico.

## Gates

- Cancelación comprobada: tras el plazo no se inicia ninguna solicitud ni
  escritura nueva del trabajo cancelado.
- Cero pérdida de vacantes ya obtenidas al abortar.
- El proceso termina por su cuenta dentro del plazo, sin hard-kill.
- Recuperación sin efectos duplicados con ticks solapados.
- P2 sigue clasificando todos los intentos.
