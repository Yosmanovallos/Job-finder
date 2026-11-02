# ADR 0010 — Disparo externo del tick ($0) y monitoreo honesto de fuentes

**Fecha:** 2026-11-01
**Estado:** propuesto. El código ya está en la rama `codex/f-fuentes-monitoring`. Activar el cron externo es una decisión del usuario.
**Enmienda:** [ADR 0003](0003-scheduler-cadence.md). Su revisión de los 7 días nunca se cerró, y aquí se cierra con datos.
**Fase:** F-fuentes, dentro de `docs/GOOGLE-JOBS-INDEXING-PLAN-2026-11.md`.

## Contexto medido (2026-10-25 → 2026-11-01, `gh run list`)

| Workflow | Cron pedido | Ticks reales | Intervalo entre ticks (h): mín / p50 / p90 / máx |
|---|---|---|---|
| `scrape-jobs.yml` (CO) | `*/30` (48/día) | 41 en 7,94 días = **5,2/día** | 2,02 / 4,85 / 6,76 / 7,17 |
| `scrape-jobs-ve.yml` (VE) | `*/30` (48/día) | 41 en 7,94 días = **5,2/día** | 2,01 / 4,86 / 6,78 / 7,23 |

El experimento de ADR 0003 consistió en bajar de `*/15` a `*/30`, y no mejoró nada: la cadencia sigue en unas 6 corridas por día.

Revisé los últimos 12 ticks de CO. Todos registran `35 roles con fuentes vencidas — procesando 8`, entre 0 y 3 roles cortados por presupuesto, y estado **`partial (some_sources_degraded)`** con el workflow en verde.

La degradación sale de los intentos de **detalle**: LinkedIn devuelve 429 en el drenaje y Computrabajo tiene reintentos. El resumen anterior solo mostraba los estados del listado, así que la tabla salía toda con «success».

## Parte A — Monitoreo honesto (sin cambiar el comportamiento del scraping)

1. **Resumen por fuente** (`src/observability/tick-report.ts`).
   - Se escribe en `$GITHUB_STEP_SUMMARY` después de `recorder.finish()`, así que incluye el estado real de la ejecución.
   - Por fuente muestra: vacantes obtenidas; listado (ok, degradados, excepciones, búsquedas 404); detalle (intentos y drenaje: completas, reintentos, **429**); los estados vistos; y la salud.
   - Por ejecución muestra los roles vencidos, los pares rol/fuente vencidos, los roles seleccionados, completos, cortados y pendientes al cerrar.
   - Deja una línea JSON `{"event":"tick_health",...}` en el log. Solo lleva enums, conteos y *clases* de error: nada de mensajes, URLs, HTML ni PII.
   - El paso `run-detail-drain.ts` agrega su propia sección y una línea `drain_health`.
2. **Drenaje del tick visible.** `drainDetailQueue(…, recorder)` crea un intento `detail` (rol `null`) por cada fuente que reclamó filas. Así un 429 del drenaje queda en `source_attempts`.
3. **Señal persistente.** Si una fuente lleva **3 ticks seguidos** degradada (ventana: los últimos 12), sale un `::warning title=Fuente degradada N ticks seguidos::`.
   - La racha se calcula con una consulta de solo lectura a `scrape_runs`/`source_attempts`. No hace falta migración.
   - `timeout`, `skipped`, `empty` y `partial` por plazo son neutros, igual que en `circuit-policy.ts`. Si contaran, el aviso saldría en cada tick tardío.
   - Un tick en el que la fuente no corrió ni corta ni alarga su racha.
   - **El job nunca falla por esto**, porque el drenaje y la indexación vienen después.
4. **Elempleo.** El 404 de la página 1 es **determinista por palabra clave** ("Architect Ti", "Aide Nursing", en medio de búsquedas sanas). Significa «búsqueda sin página», no una caída.
   - Ese 404 se cuenta aparte con la señal `not_found`, que no clasifica.
   - Cualquier otro no-OK en la página 1, y las excepciones que antes se tragaban, sí degradan el intento (`swallowed_error`).
   - Nada de esto lanza una excepción: si lanzara, se saltaría `markRoleSourceRun` y el rol se volvería a pedir en el siguiente tick, con más peticiones.

## Parte B — Más ticks sin más presión sobre LinkedIn y Computrabajo

### Opción elegida: `workflow_dispatch` desde un cron externo gratuito

cron-job.org, que es gratis, llama a `POST /repos/{owner}/{repo}/actions/workflows/{file}/dispatches` con un token fine-grained: **solo este repositorio y solo Actions: Read and write**.

- Costo: $0. El repositorio es público, así que los minutos de Actions no se cobran.
- La guía paso a paso está en [`docs/EXTERNAL-CRON-DISPATCH.md`](../EXTERNAL-CRON-DISPATCH.md).
- El cron `*/30` de GitHub **se mantiene** como respaldo.

Alternativas descartadas:

- Render Cron Job: es de pago (ADR 0003).
- `server:cron` dentro del dyno web: provocaría OOM (P1).
- `repository_dispatch`: exige un token con Contents: write, que es más permiso.

### Revisión de seguridad con más corridas

| Mecanismo | ¿Sigue seguro con ~24–48 disparos/día? |
|---|---|
| `concurrency` (`cancel-in-progress: false`) | Sí. Como máximo hay 1 corrida en curso y 1 en espera por grupo, y una nueva en espera *cancela* a la anterior en espera. No hay ticks en paralelo ni colas que crezcan. Las corridas «cancelled» en la UI son esperables y no indican errores. |
| `timeout-minutes` (36 CO, 27 VE) y plazo interno de 20 min | Sí. Se mide por corrida y no cambia con la frecuencia. |
| Leases `scrape_leases` (P3) | Sí. Fue el requisito previo que puso ADR 0003, y ya está desplegado. |
| Cadencia por par rol/fuente (`role_source_runs`: LinkedIn 4 h, Computrabajo 6 h) | Ningún par se pide más seguido. Lo que sí cambia es que se atienden más roles por día. |
| Circuito por fuente y etapa (3 fallos → 30 min abierto) y parada en el primer 429 del drenaje | Por sí solos **no bastan**: con un tick cada 30 min, el circuito de 30 min apenas frena nada. |
| **Drenaje de detalle** (hasta 8 filas de LinkedIn y 8 de Computrabajo por drenaje, 2 drenajes por tick CO) | **Este era el riesgo real.** No tiene cadencia: las peticiones diarias de detalle crecerían en proporción a los ticks, justo hacia los hosts que ya responden 429. |

### Guarda añadida: ritmo protegido (`src/queue/source-pacing.ts`)

Las fuentes LinkedIn y Computrabajo (y sus versiones `-VE`) solo participan en un tick (listado, enriquecimiento y los dos drenajes) cuando se cumple alguna de estas condiciones:

- el tick lo disparó el **`schedule` de GitHub**, que es exactamente lo que ocurre hoy; o
- su última participación tiene **≥ 7 h**, el peor intervalo medido. Esto evita que se queden sin turno si un tick de `schedule` fue reemplazado en la cola por uno de `dispatch`.

Detalles de funcionamiento:

- Todas las demás fuentes (Torre, Elempleo, Magneto, Jooble, catálogos globales) aprovechan todos los ticks.
- Un rol vencido solo por fuentes protegidas no ocupa uno de los 8 cupos.
- Sus pares siguen vencidos, porque `role_source_runs` no se toca.
- La última participación se guarda en la fila centinela `role_source_runs('__paced__', <país>)`, con el mismo patrón que `__global__` y sin migración.
- El tick le pasa su decisión al paso de drenaje mediante `$GITHUB_ENV` (`PACED_SOURCES_ALLOWED`).
- Si el historial no se puede leer, la guarda **falla cerrada** para los ticks que no son `schedule`.

**Mientras todos los ticks vengan del `schedule` (hoy), esta guarda no cambia nada.**

Un cambio de comportamiento que conviene saber: si lanzas una corrida a mano desde la UI de Actions («Run workflow»), también cuenta como `workflow_dispatch`. Por eso **esa corrida omite LinkedIn y Computrabajo**, salvo que hayan pasado ≥ 7 h desde su última participación. Las demás fuentes corren normalmente.

El resultado es que el volumen hacia LinkedIn y Computrabajo queda acotado por el ritmo del `schedule` de GitHub, más como mucho un tick de respaldo cada ≥ 7 h. No aumenta por usar el cron externo.

## Medición antes / después (7 días)

**Antes:** la tabla de contexto de arriba, más los 35 roles vencidos con 8 procesados por tick.

**Después:** revisar 7 días después de activar el cron externo. Para el intervalo real por tipo de disparo:

```sql
SELECT trigger, COUNT(*) AS ticks,
       ROUND(COUNT(*) / 7.0, 1) AS ticks_por_dia,
       percentile_cont(ARRAY[0.5, 0.9]) WITHIN GROUP (ORDER BY gap_h) AS gap_h_p50_p90
  FROM (
    SELECT trigger, EXTRACT(EPOCH FROM started_at - LAG(started_at) OVER (ORDER BY started_at)) / 3600 AS gap_h
      FROM scrape_runs
     WHERE workflow = 'scrape-tick' AND country = 'CO' AND is_test = FALSE
       AND started_at > NOW() - INTERVAL '7 days'
  ) t
 GROUP BY trigger;
```

Para los roles pendientes, sumar los registros `tick_health` del log (`roles.due`, `roles.duePairs`, `roles.completed`, `roles.pending`) o leer los resúmenes de los pasos. En `docs/EXTERNAL-CRON-DISPATCH.md` está el comando `gh` que extrae ambas cosas sin tocar la base de datos.

**Criterios para dar el cambio por bueno:**

- ≥ 20 ticks/día en CO, con p90 del intervalo ≤ 1,5 h;
- `roles.duePairs` a la baja;
- 429 de LinkedIn y Computrabajo por día **≤ la línea base**;
- **sin hambre en las fuentes protegidas:** LinkedIn y Computrabajo participan **≥ 5 veces al día**, igual que hoy. Si los ticks de `schedule` empiezan a quedar reemplazados en la cola, bajarían en silencio a uno cada 7 h, y Computrabajo es la fuente de listado más grande. Se cuenta así:
  ```sql
  SELECT date_trunc('day', r.started_at) AS dia, a.source_name, COUNT(DISTINCT r.id) AS ticks
    FROM scrape_runs r JOIN source_attempts a ON a.run_id = r.id
   WHERE r.workflow = 'scrape-tick' AND r.country = 'CO' AND r.is_test = FALSE
     AND a.source_name IN ('LinkedIn', 'Computrabajo')
     AND r.started_at > NOW() - INTERVAL '7 days'
   GROUP BY 1, 2 ORDER BY 1, 2;
  ```
  También puedes contar las líneas `🚦 … participan` del log;
- ningún aumento de `cancelled` aparte de las corridas en espera reemplazadas.

Si no se cumplen, se desactiva el trabajo en cron-job.org (paso 6 de la guía). La guarda puede quedarse, porque no tiene efecto en los ticks de `schedule`.

## Consecuencias

- **Positiva:** la degradación se ve en cada tick y se convierte en un aviso persistente sin cortar los pasos siguientes.
- **Positiva:** las fuentes sanas reciben hasta ~5–9 veces más ticks, sin costo y sin aumentar la presión sobre los hosts que limitan.
- **Negativa:** depende de un tercero (cron-job.org) que guarda un token con Actions: write sobre este repositorio. Ese token puede disparar **cualquier** workflow con `workflow_dispatch`, entre ellos `scrape-browser-tick.yml` (Indeed y Glassdoor), `indexing-tick.yml` (cuota de Indexing API) y `social-publish.yml`. También puede cancelar o volver a lanzar corridas. Por eso: vencimiento ≤ 90 días, rotación y revocación inmediata si hay sospecha (pasos 2 y 7 de la guía).
- **Reversible:** apagar el trabajo externo devuelve el sistema exactamente a como está hoy.
