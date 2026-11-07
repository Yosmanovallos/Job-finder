# Validación — seo-intent-pages

Rama `codex/seo-intent-pages`, base `origin/main@1204cde`. ADR 0012.

## 1. Conteo previo en producción (tarea 1)

**Cómo se midió:**

- Script `scripts/count-intent-inventory.ts`, corrido el 2026-11-07 a las
  14:39 UTC con autorización del propietario.
- Una transacción `BEGIN READ ONLY` con `statement_timeout` de 30 s y
  `ROLLBACK` al final. Nada se escribe.
- «Apta» es la fila canónica (mismo `DISTINCT ON` que el sitemap) con
  `seo_ready`, activa y vigente.
- **País «página»:** `country IS NULL OR country = X`, el mismo filtro que
  usan las páginas. Una vacante remota sin país cuenta en CO y en VE.
- **País «estricto»:** `country = X`.

| Aptas | CO página | CO estricto | VE página | VE estricto |
|---|---:|---:|---:|---:|
| Total | 8.866 | 8.725 | 1.670 | 1.529 |
| **Sin experiencia (D3)** | **196** | 194 | **11** | 9 |
| · descartadas por años o meses exigidos | 5 | | 0 | |
| · Bogotá | **47** | | — | |
| · Medellín | 33 | | — | |
| · Cali | 15 | | — | |
| · Caracas | — | | 4 | |
| **Remoto (PR #104)** | **640** | 499 | **145** | 4 |
| · remotas sin país (salen en los dos) | 141 | | 141 | |
| Freelance (Workana) en la página | 0 | | 0 | |

**Decisiones:**

- **Bogotá × sin experiencia:** 47 vacantes, ≥ 10. **Se queda en el
  alcance.**
- **Medellín (33) y Cali (15)** también pasarían la guarda. Quedan para la
  segunda ola (roadmap, prioridad 4), sin cambiar la lista blanca de esta
  fase.
- **`/ve/empleos/sin-experiencia`:** 11 vacantes, justo por encima de la
  guarda (9 de VE y 2 sin país). Hoy es indexable. Si baja de 10, pasa sola
  a `noindex`.
- **`/ve/empleos/remoto`:** de 145 vacantes, **141 son remotas sin país**
  que también salen en `/empleos/remoto`. Solo 4 son de Venezuela. Ya no
  sirve vacantes de CO (SIP-001), pero el contenido se solapa mucho con CO.
  El hreflang recíproco las declara como alternas regionales. Conviene
  revisarlo en el checkpoint de GSC del +14.
- **Los 1.290 remotos de VE y los 2.528 de CO de la propuesta** son vacantes
  vivas, no aptas. Las páginas listan solo aptas (ADR 0012 §2), así que
  `/empleos/remoto` pasará a mostrar unas 640 vacantes.

## 2. Costo del filtro en producción (ADR 0012 §7)

`EXPLAIN (ANALYZE, BUFFERS)` de la consulta **real** de cada página. Es el
SQL exacto de `queryJobsPage`, capturado sin ejecutarlo y explicado en la
misma transacción de solo lectura:

| Página | Tiempo | Bloques en caché (`shared hit`) | Lecturas a disco (`shared read`) |
|---|---:|---:|---:|
| `/empleos/remoto` | 1.992 ms | 18.840 | 0 |
| `/ve/empleos/remoto` | 895 ms | 13.844 | 0 |
| `/empleos/sin-experiencia` | 2.038 ms | 149.127 | 0 |
| `/ve/empleos/sin-experiencia` | 1.309 ms | 41.156 | 0 |
| `/empleos/bogota/sin-experiencia` | 1.780 ms | 60.565 | 0 |
| `/empleos/bogota` (hub, referencia) | 748 ms | 8.535 | 0 |

**Decisión: sin columna derivada en esta fase.**

- No hay lecturas a disco: todo sale de la caché de Postgres. No repite el
  incidente de Disk IO del PR #109.
- La consulta corre solo en las recargas de `intentPageCache`: como mucho,
  una cada 5 minutos por clave y por proceso.
- El costo de CPU, en el peor caso, es de unos 2 s cada 5 min por clave.

**Pendiente:** el MISS en frío de las páginas de intención (0,9–2 s) supera
el del hub (0,75 s). SIP-051 pide que quede «dentro del rango de un hub»,
así que **en frío no se cumple**:

- Se mitiga porque el sitemap espera los 5 conteos y calienta la caché.
- Con la caché caliente o la entrada obsoleta, la respuesta no espera a
  Postgres.
- Para cumplirlo de verdad hace falta la columna derivada
  `jobs.experience_level`. Es una migración aditiva que necesita
  aprobación; queda propuesta como siguiente paso.

## 3. Benchmark SIP-052

`npm run bench:intent-pages`. Usa la base desechable del runner aislado,
reloj fijo, 3.000 filas sintéticas y 500 peticiones por medición.

**En memoria:**

| Medición | Media | p95 |
|---|---:|---:|
| Petición SSR real: 60 filas elegidas por SQL entre 3.000 (meta, insights, cifras, bloque, «Nuevas hoy», hreflang, enlaces) | **1,26 ms** | 1,72 ms |
| Bloque de respuesta con las 3.000 filas (estrés) | **6,72 ms** | 7,96 ms |
| Clasificador en memoria con 3.000 filas (solo cliente; el servidor clasifica en SQL) | 33,2 ms | 40,6 ms |

- **RSS:** 81,6 MB antes y 86,3 MB después de 1.000 peticiones, **+4,7
  MB**: estable.
- No se crean objetos `Intl` por fila: las ciudades se pliegan una vez por
  proceso.

**Filtro SQL con 3.000 filas** (peor caso: la mitad de las descripciones
contiene «No se requiere experiencia»; mediana de 15):

| Filtro | Mediana |
|---|---:|
| CO remoto | 67,5 ms |
| CO sin experiencia | 224,9 ms |
| Bogotá sin experiencia | 73,1 ms |
| Hub de Bogotá (referencia) | 40,2 ms |

**Resultado: SIP-052 OK**, por debajo de 10 ms por petición y con la RSS
estable.

## 4. Drift local (SIP-050) y TTFB en frío (SIP-051)

**Cómo se midió:**

- `npm run drift:intent-pages`: la misma base desechable, servida primero
  por un worktree de `origin/main@1204cde` (con su propio build) y después
  por esta rama.
- Se comparan status, title, description, canonical, robots, hreflang, H1,
  tipos y hash del JSON-LD, y los H2.
- Se usa este método porque la herramienta `/seo drift` bloquea loopback.

**Sin ningún cambio:**

- `/` y `/ve`;
- `/dashboard`;
- `/empleos/bogota` y `/empleos/caracas`;
- `/ve/empleos/project-manager`;
- una vacante (`/empleos/<uuid>/…`).

Cumple SIP-050: las vacantes, los hubs, el dashboard y la portada quedan
idénticos.

**Con cambios, todos intencionales:**

- **`/empleos/remoto`:** el title, el H1, el canonical y el texto de la
  copia son idénticos. Cambian:
  - el conteo de la descripción;
  - el robots. En el fixture no hay vacantes aptas, así que la página queda
    en `noindex,follow` y sin los H2 de la lista. En producción tiene 640
    aptas: indexable.
- **`/ve/empleos/remoto`:** canonical propio y copia D4 de Venezuela. Antes
  servía la página de CO.
- **`/empleos/sin-experiencia`:** pasa de 404 a 200, con copia D4.
- **`/empleos/bogota/sin-experiencia`:** pasa de hub de Bogotá con canonical
  al hub a página propia.

**TTFB en frío.** Mediana de 3 procesos, primera petición de cada proceso,
URL única:

| URL | main | rama |
|---|---:|---:|
| `/dashboard` | 63 ms | 65 ms |
| `/empleos/bogota` | 62 ms | 59 ms |
| `/empleos/caracas` | 38 ms | 35 ms |
| `/ve/empleos/project-manager` | 38 ms | 40 ms |
| Vacante | 23 ms | 17 ms |
| `/empleos/remoto` | 32 ms | 19 ms |
| `/ve/empleos/remoto` | 7 ms | 18 ms |
| `/empleos/sin-experiencia` | 4 ms (404) | 50 ms |

- **Hubs y dashboard:** dentro de ±10 % o mejor.
- **Primera versión:** los hubs hacían `peek` de la caché de intención, y el
  hub de Caracas subió de 44 a 84 ms. Se corrigió: ahora los hubs solo leen
  el último total conocido y nunca disparan una consulta.

**Pendiente tras desplegar:** TTFB MISS en producción frente al runbook y
memoria en Render (tarea 7).

## 5. Comandos (todos con código de salida 0)

- `npx tsc --noEmit`
- `npm run build`
- `npm run test:unit`: 55 suites, incluida `validate-intent-pages.test.ts`
  (16 pruebas).
- `npm run test:seo`: incluye `validate-intent-pages.ts`. Comprueba:
  - la paridad SQL = memoria en los 20 casos (SIP-011);
  - SIP-001 a SIP-041 por HTTP;
  - el rollback.
- `npm run test:dashboard-filters`
- `npm run test:companies-search`
- `npm run bench:intent-pages`
- `npm run drift:intent-pages`
