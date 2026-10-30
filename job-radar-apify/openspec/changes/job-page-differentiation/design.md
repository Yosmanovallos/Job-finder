# Diseño — diferenciación de `/empleos/:id/:slug`

## 0. Criterio para elegir bloques

Un bloque entra solo si cumple las tres condiciones:

1. **Ausente en la fuente.** La página original de LinkedIn, Elempleo o
   Computrabajo no muestra ese dato. Empresa, ubicación, fecha, tipo de
   contrato y salario ya están allí, así que repetirlos no diferencia.
2. **Real.** Sale de una fila o tabla que ya tenemos, sin inferencias,
   promedios presentados como hechos ni texto generado.
3. **Gratis o cacheado.** No añade ninguna consulta a Postgres que la
   respuesta tenga que esperar. Una carga en segundo plano, acotada, sí vale.

Reglas que valen para todos los bloques:

- Van fuera de `<section data-job-description>`. Ni la descripción ni
  `renderJobDescriptionHtml()` ni el JobPosting cambian.
- Los conteos aparecen como dato o etiqueta de enlace, nunca como frase de
  plantilla: «Ver las 14 vacantes», no «Esta empresa tiene 14 vacantes en
  Bogotá».
- Ningún dato de estos bloques entra al JSON-LD.
- El cliente usa `createRoot` (`src/index.tsx`), no `hydrate`, así que React
  reemplaza el HTML del servidor. Cada bloque se renderiza igual en SSR y en
  `JobLanding.tsx`, a partir de la misma carga embebida, como ya hace
  `__SSR_JOB_LINKS__` con «Más empleos en <ciudad>».

## 1. Inventario: qué tenemos y dónde se ve hoy

«HTML crudo» es lo que devuelve el servidor. «Renderizado» es lo que queda
después de que React monta la página (Google también lo ve, pero en una
segunda pasada).

| Dato | Origen | HTML crudo hoy | Renderizado hoy | Cobertura (muestra 200) | Diferencia frente a la fuente |
|---|---|---|---|---|---|
| Título, empresa, ubicación, fecha, tipo, salario, fuente | `jobs` (`getJobById`) | Sí (lista de hechos) | Sí | 100 % / 32,5 % / 9,5 % | No: la fuente los muestra |
| Modalidad / países elegibles | `remote_type`, `applicant_countries` | Sí, si hay dato | Sí | 11 % | No |
| Reputación (Merco, GPTW, Computrabajo) | `company_reputation` vía alias curado | **No** (solo en `__SSR_JOB__`) | Sí (`ReputationBadges`) | 9 % (3/35 indexables) | Sí en LinkedIn y Elempleo. En Computrabajo su propia calificación ya aparece |
| Otras vacantes de la empresa | Proyección canónica (`queryCompanyJobsPage`) | No | No (solo el enlace a la empresa en el nombre) | 69/80 empresas con 2 o más; mediana 10 | **Sí**: incluye las vacantes publicadas en todos los portales |
| Total de vacantes activas de la empresa | Igual | No | No | Igual | Sí |
| Vacantes de la misma empresa **en la misma ciudad** | Igual, con el filtro de ciudad | No | No | 25 de 34 indexables con 2 o más (mediana 3); en 12 de 34 coincide con el total de la empresa | Sí. Se usa para ordenar B1 (misma ciudad primero), no como bloque aparte |
| Fecha de observación propia (`last_seen_at`, `content_updated_at`) | `jobs`; `content_updated_at` ya está en el SELECT de `getJobById`, `last_seen_at` sería una columna más en la misma consulta | No | No | 100 % | **Excluido.** `last_seen_at` solo significa «siguió en el listado de la fuente», no «sigue aceptando postulaciones». job-trust-2026-10 prohíbe presentarlo como disponibilidad (Computrabajo: vigencia no verificada), y una fecha visible que cambia a diario es churn sin cambio real de contenido. Se vuelve a evaluar con el ADR de ciclo de vida (P1 de `SEO-SUSTAINABLE-STRATEGY`) |
| Empleador oficial (`source = "Portal oficial"`) | `direct_jobs` → `jobs.direct_job_id` | Solo «Fuente: Portal oficial» | Igual | 7 % | Parcial: la página del empleador no se presenta como tal frente a un agregador |
| Portal de empleo oficial (lista curada) | `src/data/official-careers-links.ts` (estático) | No (solo en `/empresas/:slug`) | No | 1/200 | Sí, pero casi sin cobertura |
| `alsoIn` / `sources` | `jobs.sources` de la fila ganadora | No | Sí, «También en», si existe | **0/200** | Sería el dato más exclusivo, pero no existe en la fila canónica |
| `applicantCount` | `jobs.applicant_count` | No | Sí, «Postulantes» | 0,5 % (GetOnBoard) | No: es la cifra de la fuente |
| Tecnologías | Extraídas de la descripción | No | Sí, «Habilidades» | 8 % | No: es el mismo texto otra vez |
| Hub de ciudad y vacantes hermanas | `peekJobsPage(cityHubFilters)` | Sí (desplegado 29-Oct) | Sí | Según hub | Sí, pero se repite entre hermanas |
| Hub de cargo | `jobMatchesRole` | No | No | — | Excluido: emparejamiento difuso |

## 2. Bloque B1 — «Otras vacantes de {empresa}»

**Contenido.** Hasta 6 enlaces `<a href="/empleos/:id/:slug">título — ubicación</a>`
de otras vacantes activas de la misma empresa, nunca la vacante actual, más un
enlace a `/empresas/:slug` cuya etiqueta lleva el total real («Ver las N
vacantes de {empresa}»). Todo sale de la misma instantánea, así que el total
y los enlaces son coherentes. Cuando la empresa no tiene otras vacantes, el
bloque no se renderiza.

**Orden.** Primero las vacantes de la misma ciudad que la actual y después
el resto. Dentro de cada grupo se aplica el desplazamiento estable por hash
del id. Cobertura en las 34 indexables de empleadores reales: 28 tienen 2 o
más vacantes de la empresa (mediana 7) y 25 tienen 2 o más en la misma ciudad
(mediana 3).

**Exclusiones.** Empleadores placeholder (`isPlaceholderEmployer`: «Confidencial»,
«Confidential Careers»), por el mismo motivo que la fase 11 y el bug de
`companyActiveCount` de §1.18. También las filas que no pasan
`isPubliclyDescribable` (bloqueo de 48 h si el paywall se reactiva).

**Agrupación de empresa.** Es la misma identidad de empleador que el
directorio `/empresas`. Una prueba compara, con fixtures, que el conjunto que
usa B1 coincide con `getCompanyGroup()` para variantes como
«Accenture Colombia» y «ACCENTURE S.A.S.».

**Fuente de datos y costo: dos opciones, se elige en la implementación con
medición.**

| | A. Caché por empresa con `peek` | B. Índice por país (recomendado) |
|---|---|---|
| Qué guarda | `país|empresa` → {total, 7 filas ligeras} | `país` → `Map<empresaKey, {total, 7 filas ligeras}>` |
| Consulta | `queryCompanyJobsPage(nombre, país, 7)` por empresa, en segundo plano | Una consulta por país sobre la proyección canónica con `row_number() OVER (PARTITION BY empresa)` ≤ 7 y `count(*) OVER (PARTITION BY empresa)` |
| Camino caliente | `peek`: frío → solo el enlace a la empresa, y la carga se lanza en segundo plano | `peek`: frío → solo el enlace a la empresa |
| Carga en Postgres | Una consulta por empresa distinta que visita Googlebot. Un rastreo de miles de vacantes puede lanzar miles de cargas: requiere un tope global de concurrencia y descartar cargas cuando esté ocupado | Como mucho 2 consultas (CO, VE) cada 5 min, solo si hay tráfico. Acotado e independiente del rastreo |
| Memoria | `maxEntries` acotado (p. ej. 512) × ~1 KB | Unas 7 k empresas × 7 filas × ~150 B ≈ 7-8 MB por país. **Medir** contra el límite del hotfix de memoria (§1.22) antes de aceptar |
| Riesgo | Tormenta de cargas en frío durante el rastreo | Una consulta pesada cada 5 min: medir con `EXPLAIN ANALYZE` en lectura |

En ningún caso se reutilizan `companyPageCache` (128 entradas, y el tráfico de
vacantes desalojaría páginas de empresa reales) ni el LRU de 64 entradas del
dashboard (`DASHBOARD-PERFORMANCE-RUNBOOK.md`). La caché nueva es propia,
`StaleWhileRevalidateCache` con la misma política de 5 min fresca y 6 h stale,
y no entra en el calentamiento de arranque: el warmup CO/VE no cambia.

Puerta de decisión: si B mide más de 1 s de consulta o más de 16 MB por país,
se usa A con un tope de 2 cargas concurrentes y descarte cuando está ocupado.
Si las dos fallan la puerta, B1 no se implementa y se documenta por qué.

**SSR y cliente.** Se añade a `__SSR_JOB_LINKS__` como
`company: { name, path, total, jobs[] }`. `JobLanding.tsx` lo lee con el mismo
`readJobLinks` y lo renderiza bajo la tarjeta, con el estilo de «Más empleos
en <ciudad>».

**Riesgo de contenido.** Son títulos de otras vacantes: texto nuestro
(selección y agrupación), no de la fuente de esta oferta. Se repite entre las
vacantes de una misma empresa. Para repartir enlaces se aplica el mismo
desplazamiento estable por hash del id que usa `pickRelatedJobs`.

## 3. Bloque B2 — reputación en el HTML inicial

**Contenido.** El mismo formato que el SSR de `/empresas/:slug`:
`<ul aria-label="Reputación"><li>{etiqueta}: {score} ({escala}) · {n} reseñas</li></ul>`,
cada elemento con su enlace «Ver fuente» a `source_url`. Solo texto, nunca un
logo (`COMPANY-REPUTATION-PLAN.md` §1). Se extrae un helper compartido para
que la página de empresa y la de vacante no dupliquen el mapa
`REPUTATION_SOURCE_LABELS`.

**Costo.** Ninguna consulta nueva para el visitante anónimo, que es como
llega Googlebot: hoy `attachReputation([visible])` ya se ejecuta en esa rama
para la carga de hidratación. Se mueve antes de `buildJobPageBody` y se
reutiliza el mismo resultado. Para usuarios con sesión no se consulta en SSR:
su página se rehace por API y `ReputationBadges` ya la muestra. Si la
consulta falla, el bloque se omite y la página sigue sirviéndose (mismo
`.catch` que hoy).

**Límites.** Cubre el 9 % de la muestra (3 de 35 indexables). Ya está en el
DOM renderizado, así que para el renderizador de Google es paridad, no
contenido nuevo: solo cambia el HTML crudo. La calificación de Computrabajo
sobre una vacante de Computrabajo no diferencia nada; se muestra igual por
coherencia con la página de empresa. Riesgo legal: el riesgo ya aceptado de
Computrabajo (aviso legal) no aumenta, porque el dato ya se publica en
`/empresas/:slug` y en el panel hidratado.

## 4. Bloque B3 — empleador oficial

- `source === "Portal oficial"`: la fila de hechos dice
  «Fuente: Portal oficial de empleo de {empresa}», con enlace al dominio de
  `job.url`, que ya es el del empleador. Es un dato, no una frase añadida, y ya
  lo cubre la regla de paridad. Cubre el 7 %.
- La empresa tiene entrada en `official-careers-links.ts`: un enlace
  `rel="nofollow noopener"` «Portal de empleo de {empresa}», igual que en
  `/empresas/:slug`. Es estático, sin consulta. Cubre el 0,5 %: se incluye
  por coherencia, no por impacto.

## 5. Diferido: «También publicada en»

Hoy no existe: `alsoIn` vale 0 en las 200 filas canónicas. `getJobById` solo
devuelve la fila ganadora del `DISTINCT ON (título, empresa, ubicación)`, y
las copias de otros portales son filas perdedoras, no entradas de `sources`.
`jobs.sources` solo crece cuando llega otra vez el mismo `url_hash`
(`src/db/job-repository.ts`, upsert), y eso nunca ocurre entre portales distintos.

Antes de diseñarlo hace falta una medición de solo lectura: cuántos grupos de
identidad activos tienen más de una fuente distinta, y con qué fuentes. Según
el resultado:

- **Consulta por grupo en la respuesta**: requiere un índice que la haga
  submilisegundo y una justificación en el runbook, porque añade una
  consulta al camino caliente. No es la opción preferida.
- **Columna precalculada** (p. ej. `identity_sources TEXT[]`) mantenida por
  el scheduler: migración aditiva con aprobación explícita, sin costo en la
  respuesta.

Si la medición da menos del 5 % de grupos indexables, se archiva la idea.

## 6. Criterios de salida

### 6.1 Controlados por nosotros (bloquean el despliegue)

| ID | Criterio | Cómo se mide |
|---|---|---|
| X1 | La descripción no cambia | Hash de `<section data-job-description>` y de `JobPosting.description` idénticos antes y después en fixtures; `test:seo` en verde |
| X2 | Sin consultas nuevas en el camino caliente | Prueba que cuenta las llamadas a `pool.query` por respuesta de `/empleos/:id` con la caché caliente: anónimo igual que antes, con sesión igual que antes |
| X3 | TTFB sin regresión | Proceso frío y URL única con edge MISS (runbook), 5 vacantes, antes y después; mediana dentro de +10 % de la línea base |
| X4 | Paridad SSR ↔ React | Prueba de render: los mismos enlaces y textos de B1, B2 y B3 en el HTML del servidor y en `JobLanding` con la misma carga |
| X5 | Sin plantillas ni datos inventados | Prueba que falla si aparece «agregada de», si un total no coincide con la instantánea, o si un placeholder genera B1 |
| X6 | Gates del repo | `npx tsc --noEmit`, `npm run build`, `test:unit`, `test:seo`, `test:integration`, `/seo drift compare` sin CRITICAL inexplicado |

### 6.2 Proporción de texto propio (medible tras desplegar)

Se repite el script de esta propuesta sobre una muestra fija: las 35
indexables de `job-page-diff-2026-10-30.json` que sigan vivas, más 35 nuevas
indexables del día del despliegue.

Los objetivos cuentan **datos que la fuente no muestra** y enlaces, no
palabras. Los títulos de B1 son texto de otras vacantes (y de sus fuentes), así
que contarlos como «texto propio» premiaría justo el relleno que §6.4 prohíbe.

| Métrica | Base (hoy) | Objetivo con caché caliente |
|---|---:|---:|
| Vacantes indexables de empleador real con 2 o más vacantes que muestran B1 | 0 de 28 | ≥ 80 % |
| Datos por página que la fuente no muestra (total de la empresa, total en la ciudad si se muestra, entradas de reputación, marca oficial), mediana | 0 | ≥ 1 |
| Enlaces internos a vacantes en el HTML crudo, mediana | Los del bloque de ciudad (hasta 6) | + hasta 6 de B1 |

Solo descriptivo, no es un objetivo: la proporción de descripción en `#app`.
Hoy es una mediana del 70 %. Simulado con 6 títulos de B1 en las filas que
aplican, baja a un 66 %. Un umbral sobre esa cifra no es alcanzable sin
relleno, y no se fija.

Esto mide la forma de la página, no si Google la indexa.

### 6.3 Search Console (observación, no atribuible)

Checkpoints: **2026-11-12** y **2026-11-26**, las mismas fechas que el grafo
de enlaces (`SEO-JOB-LINK-GRAPH-2026-10-29.md`).

| Señal | Base (22/26-Oct) |
|---|---:|
| Páginas indexadas | 569 |
| Rastreadas, sin indexar | 9.745 |
| Descubiertas, sin indexar | 7.095 |
| Ofertas de trabajo válidas | 5 |

- Este cambio es solo diseño. Si se implementa después del 12-Nov, ese
  checkpoint es su **línea base**, no un resultado.
- El grafo de enlaces (desplegado), #88 (`addressRegion`) y #89 (enlaces
  de Computrabajo) se miden en las mismas ventanas. Los totales de GSC no
  permiten atribuir nada a este cambio, y no se hará.
- **Brazo de control opcional (decisión del usuario):** B1 solo para
  vacantes cuyo `hash(jobId) mod 2 = 0`, entre las vacantes nuevas e
  indexables desde el despliegue. Inspección manual de 20 URLs por brazo a
  +14 y +28 días (indexada sí/no). Es una muestra pequeña: solo sirve como
  señal de dirección. Separar el sitemap por brazo daría conteos por grupo,
  pero toca el sitemap y necesita aprobación aparte.

### 6.4 Regla de decisión el 26-Nov

Hay un control después del despliegue: el TTFB MISS en frío de las mismas 5
vacantes de X3, medido a +1 y a +14 días. Si sube más de un 10 % sobre la
línea base y se atribuye a la caché de B1 (logs de carga en segundo plano,
consultas en Postgres), B1 se revierte sin esperar al 26-Nov.

- **Sin brazo de control** (opción por defecto): B1, B2 y B3 se mantienen
  mientras X1-X6 y el control de TTFB sigan en verde. Se anota que los
  totales de GSC no confirman ni refutan el efecto. Se abre la medición
  de §5.
- **Con brazo de control**: si la indexación del brazo con B1 es peor que la
  del control en las dos inspecciones (+14 y +28 días), se revierte B1 y B2
  y B3 se quedan, porque son paridad. Si es igual o mejor, B1 se extiende a
  todas las vacantes. Con 20 URLs por brazo, una diferencia de una o dos URLs
  se trata como empate.
- Nunca: rellenar más texto para subir una proporción, ni ampliar la
  retención de 30 días como «arreglo» de indexación.

## 7. Rollback

Cada bloque va detrás de su propio renderizado condicional, sin bandera
nueva en el entorno. Revertir es quitar el bloque del SSR y de `JobLanding`.
No hay migración (B1-B3). La caché nueva desaparece al reiniciar.
