# Simulación F2: orden, retiros y reparto del tick de indexación (2026-11-02)

Fase F2 de `docs/GOOGLE-JOBS-INDEXING-PLAN-2026-11.md`. Rama
`codex/google-jobs-f2-scheduling`, desde `origin/main` `87e1ba4`, más los
commits de F0. Sin consultas a producción y sin escrituras.

## Método

- **Simulador:** `scripts/simulate-indexing-queue.ts`, el del ADR 0004. Usa el
  mismo planificador que se despliega (`src/lib/indexing-scheduler.ts`) y la
  misma función de reparto (`pacedSendAllowance`).
- **Llegadas.** No hay un export por vacante de noviembre y F2 no pidió uno
  nuevo. `simDataFromFunnel()` reconstruye las llegadas, de forma
  determinista, desde los agregados de F0
  (`2026-11-01-google-jobs-funnel.json`):
  - cada `URL_UPDATED` de prioridad 2 encolada por día completo de Bogotá
    (19 al 31 de octubre; ~308/día), a una hora uniforme dentro del día;
  - la parte de Magneto de cada día pasa a apta 110 h después de descubierta
    (F0 §2: p50 de 107–113 h). Su ventana de 7 días cuenta desde el
    descubrimiento, así que le quedan ~58 h;
  - 100 vacantes notificadas por día en los 30 días previos, salvo los
    últimos 7. Son la fuente de los retiros D2 de las primeras semanas;
  - purga exactamente a los 30 días del descubrimiento (ADR 0008);
  - los 8,850 `URL_DELETED` pendientes: las llegadas diarias de F0 de los
    últimos 13 días, y el resto uniforme a ambos lados de la mediana medida
    (1,060 h) hasta el máximo (1,584 h).
- **Ejecuciones del tick:** se reproducen los 300 intervalos reales entre
  ejecuciones de `indexing-tick.yml` (6-sep a 2-nov, media 4.6 h, unas 5.2
  ejecuciones/día; `2026-11-02-indexing-tick-gaps.json`, obtenidos con
  `gh run list`). Cada ejecución gasta como máximo el presupuesto rodante de
  24 h:
  - **burst**: todo lo que queda, que es lo desplegado hoy;
  - **paced**: solo su parte del día (cambio 3).
- **Horizonte y cuota:** 90 días, cuota de 200/día, ventana de `URL_UPDATED`
  de 7 días, política de retiros D2.
- **Métrica principal:** % de las nuevas aptas notificadas en ≤24 h desde que
  pasan a apta.

**Calibración.** Antes de comparar, el modelo FIFO tiene que reproducir lo
medido en F0. Lo cubre la prueba `the F0 reconstruction reproduces the
measured FIFO funnel`.

| Indicador | F0 (medido) | Simulación, S2 burst (lo desplegado) |
|---|---|---|
| Apta → enviada (enviadas) | p50 158–167 h | p50 6.8 d (163 h) |
| Nuevas notificadas en ≤24 h | 0 % (el 100 % de las enviadas tenía más de 48 h) | 0.4 % |
| Aptas notificadas por la API | 30 % | 33 % |
| Envíos/día | ~187 efectivos | 184 |
| `URL_DELETED` pendientes | 8,850, sin bajar | 8,760 al día 90 |

## Resultados (`--grid=f2`)

Reproducir:

```bash
npx tsx scripts/simulate-indexing-queue.ts --funnel=docs/seo-baseline/2026-11-01-google-jobs-funnel.json \
  --ticks=docs/seo-baseline/2026-11-02-indexing-tick-gaps.json --grid=f2
```

Planificadores:

- **SF**: FIFO global.
- **S2**: 50/50 por carril, FIFO; es lo desplegado.
- **S3**: plazo más cercano.
- **S4** y **S2N**: nuevas newest-first, retiros FIFO.
- **S2NB**: nuevas y retiros newest-first.

### Cambio 1: orden del carril de nuevas (50/50, sin ventana de retiros)

| Planificador | Modo | Nuevas en ≤24 h | ≤48 h | Notificadas | p50 apta→enviada |
|---|---|---|---|---|---|
| SF | burst | 0 % | 0 % | 18 % | 6.6 d |
| **S2 (hoy)** | **burst** | **0.4 %** | **0.9 %** | **33 %** | **6.8 d** |
| S3 (`age`) | burst | 0 % | 0.1 % | 12 % | 5.0 d |
| S4 (`newest`) | burst | 30.4 % | 30.4 % | 30 % | 4 h |
| S2N | burst | 30.4 % | 30.4 % | 30 % | 4 h |

- `age` (S3) no ayuda: dentro de cada carril sigue tomando la más antigua.
- Con newest-first se notifica la misma cantidad, pero en horas en vez de una
  semana: el 30 % de todas las nuevas aptas sale en ≤24 h. Es el máximo
  posible con unos 92 envíos/día de nuevas frente a unas 300 llegadas/día.
- Lo que no se alcanza caduca a los 7 días y lo cubre el sitemap, igual que
  hoy.

### Cambio 2: carril de retiros (paced)

| Planificador | Nuevas/retiros | Ventana de retiros | Nuevas en ≤24 h | Retiros enviados en ≤7 d | p50 del retiro | Cola de retiros al día 90 |
|---|---|---|---|---|---|---|
| S2N | 50/50 | sin ventana | 30.1 % | 0 % | nunca | 8,509 |
| S2N | 50/50 | 7 d | 30.6 % | 96.8 % | 2.7 d | 329 |
| S2NB | 50/50 | 7 d | 33.3 % | 85.3 % | 2 h | 86 |
| S2NB | 60/40 | 7 d | 38.2 % | 63.5 % | 3 h | 299 |
| **S2NB** | **75/25** | **7 d** | **46.0 %** | **35.9 %** | **— (la mayoría se cierra)** | **670** |
| S2NB | 90/10 | 7 d | 54.8 % | 11.2 % | — | 1,077 |

- **Sin ventana, el carril de retiros nunca se vacía.**
  - Los retiros D2 llegan a unos 100/día, uno por cada notificación de 30
    días atrás.
  - El carril recibe 100/día con FIFO, así que siempre envía el más viejo
    del atasco: hoy, una URL con 410 desde hace unos 44 días.
- **La ventana de 7 días** cierra el atasco heredado (unas 8,400 filas) y
  acota la cola.
- **Newest-first en retiros** envía cada retiro unas 2 h después de la purga,
  en vez de días después.
- **La proporción es el único compromiso real entre los dos carriles.** Se
  eligió 75/25:
  - Una vacante nueva solo tiene el sitemap como respaldo, y tarda días.
  - Un retiro ya tiene el 410, la salida del sitemap y `validThrough`
    (`datePosted` + 30 d, ADR 0008), que le dijo a Google la fecha de fin
    desde el primer rastreo.
  - Con 75/25, cada carril sigue teniendo garantizada su parte y se queda
    con lo que no use el otro.

### Cambio 3: reparto en el día (configuración final)

| Modo | Envíos/día | Máximo por ejecución | Nuevas en ≤24 h | p50 apta→enviada | Retiros en ≤7 d |
|---|---|---|---|---|---|
| burst (hoy) | 184 | 200 | 46.6 % | 6 h | 37 % |
| **paced** | **180** | **74** | **46.0 %** | **1 h** | **35.9 %** |

Reproducción aparte, con las ejecuciones reales y los carriles siempre llenos
(prueba `pacing spreads the quota…`):

- paced: 177 envíos/día y como máximo 74 por ejecución; envía en el 94 % de
  las ejecuciones;
- burst: 181.5 envíos/día y 200 por ejecución; envía solo en el 17 % de las
  ejecuciones.

Ninguna política que respete la ventana rodante de 24 h puede reutilizar un
cupo liberado antes de la siguiente ejecución. Por eso el burst tampoco llega
a 200/día.

El reparto cuesta alrededor del 2 % de la cuota. A cambio:

- no hay días de Bogotá sin envíos (F0 vio uno);
- cada vacante sale una hora después de pasar a apta, en vez de seis;
- Google recibe avisos a lo largo de todo el día.

## Antes y después (200/día, llegadas de F0)

| Indicador | Antes (S2, 50/50, FIFO, burst) | Después (S2NB, 75/25, ventana de retiros de 7 d, paced) |
|---|---|---|
| Nuevas aptas notificadas en ≤24 h | **0.4 %** | **46.0 %** |
| Nuevas aptas notificadas en total | 33 % | 46 % |
| p50 apta → `URL_UPDATED` enviada | 6.8 d | 1 h |
| Retiros enviados en ≤7 d desde la purga | 0 % | 35.9 % |
| `URL_DELETED` pendientes al día 90 | 8,760 | 670 |
| Envíos/día | 184 | 180 |
| Máximo por ejecución | 200 | 74 |

## Límites de esta simulación

- Es una reconstrucción a partir de agregados diarios. La hora dentro del día
  es uniforme, aunque en la realidad la aptitud llega en tandas de scraping.
  La cola de nuevas empieza vacía, no con las 2,026 pendientes. La purga es a
  los 30 días exactos. Ninguno de estos supuestos cambia el orden entre
  políticas; las cifras absolutas son aproximadas.
- La simulación mide cuándo se avisa, no si Google indexa antes. F0 encontró
  que 19 de 20 aptas recientes ya estaban indexadas, 9 de 10 solo por el
  sitemap. El efecto real se mide en F6.
- El valor de un retiro frente al de una vacante nueva es un juicio, no una
  medida. La proporción es una constante (`DEFAULT_SCHEDULER.shares`) y
  `--grid=f2` muestra la curva completa si hay que moverla.
