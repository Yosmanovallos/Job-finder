# ADR 0011 — IndexNow y sitemap de vacantes recientes (SEO Fase B)

**Fecha:** 2026-11-06
**Estado:** propuesto (rama `codex/seo-fase-b-indexing`, sin desplegar)
**Contexto:** checkpoint `docs/seo-baseline/2026-11-06-checkpoint-y-plan-registros.md`
§6 Fase B; ADR 0004 (Indexing API de Google)

## Problema

Cada día pasan a ser aptas para Google unas 490 vacantes, y la Indexing API
solo notifica unas 95 `URL_UPDATED` al día (cuota de 200, repartida 50/50 con
`URL_DELETED` por el ADR 0004). En la muestra fija, las vacantes de 2 a 3 días
estaban indexadas en 1 de 5 casos, y las de 8 a 10 días en 5 de 5. Las demás
dependen de que Google rastree otra vez `sitemap-jobs.xml`, que tiene unas 10
mil URL. Bing no recibe ninguna señal, y su índice alimenta ChatGPT Search y
Copilot, que hoy traen el 12 % de las sesiones.

## Decisión

1. **`/sitemap-jobs-recent.xml`**: las vacantes aptas publicadas en las
   últimas 72 h, enlazado desde `/sitemap.xml`. Es un subconjunto estricto de
   `sitemap-jobs.xml`: misma identidad `DISTINCT ON`, mismo orden «primero
   canónica, después `seoReadySql`» y mismo `<lastmod>` (el
   `content_updated_at` real; se omite si no se conoce). `test:seo` lo
   comprueba URL por URL. Sale de una única consulta de solo lectura, con
   `statement_timeout`, guardada 10 minutos en memoria (caché propia, aparte
   de la del dashboard). Si falla una lectura en frío, responde 503 `no-store`,
   nunca un 200 truncado.
2. **«Nuevas hoy» en los hubs de ciudad y de rol**: hasta 10 vacantes aptas
   del hub publicadas hoy, según el día calendario del país del hub
   (America/Bogota o America/Caracas). Salen de la misma copia en memoria y
   se filtran con el gemelo en TS del filtro SQL del hub. El hub solo hace
   `peek()` y nunca espera a Postgres: si la copia está fría, el bloque se
   omite y la copia se carga en segundo plano. Si ninguna vacante califica,
   el bloque se omite, nunca se rellena con vacantes viejas. Va en el HTML
   del servidor y en `__SSR_CATEGORY__.newToday`, así que el DOM hidratado
   enlaza lo mismo.
3. **IndexNow** (Bing, Yandex, Seznam, Naver): la clave pública está en
   `static/<clave>.txt` (el protocolo la exige pública). Se envía con
   `npm run indexnow:submit`, que **por defecto es dry-run** y no toca la red.
   Solo `--execute` hace **un** POST a `api.indexnow.org`, con un máximo de
   10 000 URL, 15 s de tiempo límite por intento y como mucho 3 intentos
   (solo ante 429, 5xx o error de red). Usa las mismas filas que el sitemap
   reciente. No hay tabla de estado: la ventana `--hours` (24 por omisión)
   debe coincidir con la cadencia de ejecución.

## Qué NO cambia

- La política de la Indexing API de Google (ADR 0004, reparto 50/50
  `URL_UPDATED`/`URL_DELETED` del PR #96). IndexNow es otro canal, con otra
  cuota. Cambiar el reparto exige enmendar el ADR 0004.
- `sitemap-jobs.xml`, el contrato de `JobPosting`, robots, canonical y la
  caché del dashboard (`DASHBOARD-PERFORMANCE-RUNBOOK.md`).

## Pendiente del propietario

- Verificar `buscotrabajo.co` en Bing Webmaster Tools y enviar ahí
  `sitemap.xml`.
- Aprobar el primer `--execute` y, si funciona, programarlo (por ejemplo, una
  vez al día con `--hours 24`). Hoy no está programado en ningún sitio.

## Riesgos

- Una vacante que se vuelve apta más de 72 h después de publicarse
  (Computrabajo tiene una mediana de 7,1 h; algunas tardan días) no entra en
  el sitemap reciente. Sigue en `sitemap-jobs.xml`.
- El filtro en memoria del hub es un gemelo del SQL (ciudad: subcadena sin
  tildes; rol: mismo plan de palabras que `rolePredicate`). Si se
  desalinearan, el peor caso es un enlace válido bajo un hub que no le
  corresponde, nunca un enlace roto.
- Bing puede tardar o rechazar la clave hasta que se verifique el sitio. Un
  403 o 422 es un error permanente y no se reintenta.
