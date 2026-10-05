# ADR 0005 — Ninguna vacante vencida o de más de un mes en la app

**Fecha:** 2026-10-04
**Estado:** aceptado localmente en `fix/job-freshness` · no desplegado ·
revierte `docs/SEO-PLAN.md` §9.2 (purga solo por `last_seen_at`) y la regla de
V2 que mantenía visible (200 + `noindex,follow`) una vacante con
`validThrough` pasado
**Contexto:** reporte de usuario del 2026-10-04 (dos vacantes de Torre
cerradas hace semanas seguían publicadas); `src/queue/source-closure.ts`

## Problema

El usuario reportó vacantes de Torre vencidas que seguían en BuscoTrabajo. El
dueño fijó el requisito: **no puede haber en la app ofertas con más de un mes,
ni ofertas vencidas.** El código tenía tres huecos:

1. La única purga era "no vista en 30 días" (`last_seen_at`). Una fuente que
   sigue listando una oferta vieja refresca `last_seen_at` en cada tick, así
   que esa oferta no vencía nunca. `published_at` se fija una sola vez y nunca
   se actualiza, pero nadie lo usaba para expirar.
2. Ninguna lectura pública filtraba por antigüedad. Por `valid_through` solo
   filtraban Google (`seoReadySql`) y el sitemap; el dashboard y el detalle
   seguían mostrando la vacante.
3. Una vacante cerrada en la fuente solo salía por la purga de 30 días (Torre:
   hasta ~44 días). El chequeo de cierre (`source-closure.ts`) está
   desplegado, pero se salta en cada tick hasta que se aplique su migración.

## Decisión

Una sola regla, definida en `src/lib/job-freshness.ts`, que se aplica en tres
lugares:

> Una vacante está **vigente** si `published_at >= NOW() - 30 días` **y**
> (`valid_through` es NULL **o** `valid_through > NOW()`).

| Dónde | Qué hace |
|---|---|
| Lecturas (`liveJobSql()`) | Todas las consultas públicas de `job-repository.ts` filtran **dentro** del `DISTINCT ON`, para que una fila vencida no gane la elección canónica y oculte un duplicado vigente. También `canonicalSql`, `seoReadySql` e `isGoogleReadyNow`: lo que no se muestra tampoco es apto para Google. |
| Purga (`purgeOldJobs`) | Borra `last_seen_at` > 30 días **o** no vigente, por el mismo camino de tombstone/410 de siempre, con un tope de 2.000 filas por tick y empezando por las más viejas. |
| Ingesta (`validateJobs`) | Rechaza `publishedAt` de más de 30 días o `validThrough` pasado. |

El detalle de una vacante vencida que todavía no se purgó responde **410**
(`isJobExpiredInPlace`), no 404 y tampoco 200 con `noindex,follow`.

## El riesgo que §9.2 evitaba y cómo se contiene

§9.2 purgaba solo por `last_seen_at` para evitar el **churn de URLs**: una
oferta purgada que la fuente sigue listando vuelve en el tick siguiente con un
id y una URL nuevos. Con la regla de antigüedad ese riesgo regresa en las
fuentes sin fecha propia (Magneto siempre usa "hoy", y `parseDateText` usa
"ahora" cuando no reconoce el texto): reaparecerían como nuevas.

Se contiene con la tabla `expired_job_urls` (`url_hash`, bloque `job-freshness`
de `schema.sql`). Cada URL purgada o cerrada en la fuente se registra ahí, y
`saveJobs()` no la vuelve a insertar durante 180 días. Si la tabla no existe,
todo degrada a no-op: el tick sigue funcionando, pero no bloquea reinserciones.

## Límite conocido

En las fuentes sin fecha propia, la antigüedad cuenta desde que BuscoTrabajo
vio la vacante por primera vez, no desde su publicación real. Una oferta así
puede verse hasta 30 días después de ese primer avistamiento aunque en la
fuente sea más vieja. Lo que sí declara la fuente (`validThrough`, `deadline`
de Torre, cierre confirmado) la retira antes.

## Consecuencias

- Tras el despliegue, el total del dashboard baja de inmediato: las vacantes
  vencidas dejan de leerse antes de que la purga las borre.
- Los primeros ticks muestran un "Purgadas" alto, hasta 2.000 por tick, hasta
  vaciar el atraso.
- Cuota de la Indexing API: solo las URLs que Google recibió por la API gastan
  cuota de borrado (ADR 0004, D2), y el planificador reparte la cuota 50/50
  entre altas y borrados, así que las vacantes nuevas no se quedan sin cuota.
- **Orden de despliegue:** primero `scripts/migrate-job-freshness.ts` en
  producción (crea `expired_job_urls` y `jobs.source_checked_at`), después el
  merge. Sin la tabla, la purga nueva causaría churn en Magneto.
