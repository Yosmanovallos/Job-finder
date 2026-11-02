# Línea base del embudo Google Empleos (F0) — 2026-11-01

Fase F0 de `docs/GOOGLE-JOBS-INDEXING-PLAN-2026-11.md`. Solo lectura, sin
cambios de código. Rama `codex/google-jobs-f0-baseline` desde `origin/main`
`8e8f95f`.

## Fuentes y método

| Fuente | Qué se leyó |
|---|---|
| Consulta agregada a producción, aprobada por el usuario el 2026-11-01 | `google-jobs-funnel-queries.mjs`: un `BEGIN READ ONLY` con `ROLLBACK`, solo agregados, sin ids ni textos. Ventana de 14 días, días en hora de Bogotá. Salida: `2026-11-01-google-jobs-funnel.json` |
| Muestra para la inspección, aprobada igual | `google-jobs-inspection-sample.mjs`: 20 URLs públicas, ninguna proyección oficial |
| Logs de GitHub Actions, 18-oct a 1-nov | `indexing-tick.yml`: 76 ejecuciones, todas correctas. `scrape-jobs.yml`: 87, una fallida. `scrape-jobs-ve.yml`: 84, una fallida. Los logs crudos no se commitean |
| Search Console, inspección de URLs una por una, el 2026-11-01 | Las 20 URLs de la muestra, desde Claude in Chrome. Sin «Solicitar indexación» y sin prueba en vivo |

**Limitaciones.**

- Una `URL_UPDATED` caduca 7 días después de su versión. Por eso el destino
  final solo se conoce para la cohorte que pasó a apta hace 8–14 días.
- El último día (1-nov) está incompleto.
- Las medias usan los días completos del 19 al 31 de octubre.

## 1. Embudo diario

Columnas:

- **Nuevas**: filas creadas ese día.
- **Aptas**: primera vez que una fila pasa a apta (`seo_ready_at`) ese día.
- **Oficiales**: proyecciones de «Portal oficial». No usan la Indexing API
  (ADR 0006).
- **Encoladas**: `URL_UPDATED` que entraron en la cola.
- **Caducadas**: cerradas como `api_window_expired`.
- **Retiros API**: `URL_DELETED` de prioridad 1, es decir, de URLs que la API
  ya había notificado.

| Día | Nuevas | Aptas | de ellas oficiales | Aptas no oficiales | `URL_UPDATED` encoladas | enviadas | caducadas | Retiros API encolados | `URL_DELETED` enviadas |
|---|---|---|---|---|---|---|---|---|---|
| 10-19 | 1,474 | 219 | 0 | 219 | 241 | 100 | 38 | 1 | 100 |
| 10-20 | 1,465 | 473 | 226 | 247 | 281 | 100 | 46 | 4 | 100 |
| 10-21 | 1,665 | 355 | 93 | 262 | 284 | 100 | 206 | 1 | 100 |
| 10-22 | 1,504 | 401 | 56 | 345 | 376 | 100 | 219 | 3 | 100 |
| 10-23 | 1,629 | 304 | 25 | 279 | 296 | 100 | 207 | 4 | 100 |
| 10-24 | 1,108 | 258 | 4 | 254 | 267 | 100 | 225 | 13 | 100 |
| 10-25 | 659 | 264 | 6 | 258 | 277 | 100 | 137 | 47 | 100 |
| 10-26 | 1,305 | 293 | 49 | 244 | 278 | 100 | 143 | 74 | 100 |
| 10-27 | 1,596 | 392 | 64 | 328 | 354 | 100 | 196 | 90 | 100 |
| 10-28 | 1,087 | 282 | 40 | 242 | 259 | 100 | 246 | 291 | 100 |
| 10-29 | 1,911 | 620 | 250 | 370 | 400 | 0¹ | 141 | 323 | 0¹ |
| 10-30 | 1,326 | 355 | 88 | 267 | 285 | 100 | 258 | 242 | 100 |
| 10-31 | 1,021 | 433 | 35 | 398 | 412 | 100 | 173 | 139 | 100 |
| **Media** | 1,365 | 358 | 72 | **286** | **308** | 92 | **172** | 95 (172 en 7 d) | 92 |

¹ No es un fallo. El presupuesto mira las últimas 24 h y el cron horario
corre solo 4–7 veces al día, así que los 200 envíos salen de una sola vez en
la primera ejecución de cada ventana. Esa hora se retrasa cada día (03:10 →
05:45 → … → 23:29 UTC) y el 28-oct saltó al 29-oct a las 02:06 UTC. Por eso
hubo un día de Bogotá sin envíos. Media efectiva: **~187 envíos/día** (14
tandas de 200 en 15 días).

Las cifras de los logs coinciden con la base de datos. Hay 14 ejecuciones con
«Sent: 200, Failed: 0». Las caducadas suman entre 125 y 255 por día UTC. Hubo
dos tandas masivas de readiness: 226 aptas a la vez el 20-oct a las 21 h y
~330 el 29-oct. Coinciden con proyecciones oficiales, que no usan la API.

### Destino final de las aptas (cohorte aptas hace 8–14 días)

| Fuente | Aptas | Notificadas por la API | Caducadas sin enviar | Otras² |
|---|---|---|---|---|
| LinkedIn | 1,081 | 356 (33 %) | 687 | 38 |
| Elempleo | 259 | 58 (22 %) | 201 | 0 |
| Computrabajo | 180 | 51 (28 %) | 129 | 0 |
| Magneto | 83 | 14 (17 %) | 69 | 0 |
| WeRemoto | 36 | 15 (42 %) | 21 | 0 |
| **Total no oficial** | **1,639** | **494 (30 %)** | **1,107 (68 %)** | 38 |
| Portal oficial | 404 | — (no usa la API) | — | — |

² `superseded` por otro motivo, por ejemplo una versión más nueva o que la
vacante dejó de ser apta.

Aptas no oficiales por día y fuente (media del 19 al 31 de octubre):

- LinkedIn: 159
- Magneto: 56
- Elempleo: 36
- Computrabajo: 30
- WeRemoto: 5

La tabla completa por día y fuente está en `2026-11-01-google-jobs-funnel.json`
(`new_by_day_source`, `ready_by_day_source`).

En la cohorte en curso (aptas en los últimos 7 días) hay **2,030
`URL_UPDATED` pendientes**, con una mediana de 74 h de espera y un máximo de
168 h.

## 2. Latencias

| Paso | Valor | Fuente |
|---|---|---|
| Fila nueva → apta | p50 **0 h** en LinkedIn CO, Computrabajo CO y Elempleo: el detalle llega en el mismo tick. En LinkedIn VE y Computrabajo VE, p90 de 3–72 h. En **Magneto CO, p50 de 107–113 h** (cohortes del 26–27 oct); las creadas desde el 28-oct aún no son aptas | `new_by_day_source` |
| Apta → `URL_UPDATED` enviada | **p50 158–167 h, p90 160–167 h**, cada día de la ventana | `sent_latency_by_day` |
| Edad de la vacante al enviarla | p50 155–184 h. **El 100 % de las enviadas tenía más de 48 h** | `sent_latency_by_day` |
| `URL_DELETED` pendiente | 8,850 filas, **p50 de 1,060 h (44 días)**, máximo 66 días | `pending_now` |

El carril de nuevas es FIFO y siempre está lleno. En la práctica, la API
notifica cada vacante unas horas antes de que caduque, a los 7 días, nunca en
sus primeras horas.

## 3. Detalle por fuente (para F3)

Filas nuevas de los últimos 14 días por estado de `detail_status`, con la
proporción que llegó a ser apta:

| Fuente | Nuevas | Aptas | % | `pending` | `retry` | `no_detail` | Motivo principal de no apta |
|---|---|---|---|---|---|---|---|
| LinkedIn CO | 7,104 | 1,525 | 21 % | 4,818 (total LinkedIn) | 593 | 323 | `MISSING_DESCRIPTION` (5,734), `MISSING_LOCATION` (1,464) |
| LinkedIn VE | 1,232 | 591 | 48 % | (incluido arriba) | | | |
| Computrabajo CO | 2,630 | 61 | **2 %** | 2,121 (total) | 449 | 91 | `MISSING_DESCRIPTION` (2,661) |
| Computrabajo VE | 258 | 165 | 64 % | | | | |
| Magneto CO | 2,117 | 726 | 34 % | 1,385 | 5 | 0 | `MISSING_DESCRIPTION` (1,390) |
| Elempleo | 478 | 468 | **98 %** | 0 | 0 | 4 | — |
| Portal oficial | 1,391 | 960 | 69 % | — | — | — | `MISSING_LOCATION` (185) |
| Workana, Glassdoor, Indeed, otras | 2,855 | 0 | 0 % | — | — | — | Sin detalle soportado o sin clasificar, por diseño |

Logs de `scrape-jobs.yml` (CO), sumando las líneas «Detalle X: N reclamadas →
M completas»:

| Fuente | Reclamadas | Completas | Reintento | Sin detalle | Errores 429 (`FetchRateLimitedError`) |
|---|---|---|---|---|---|
| Magneto | 2,494 | 1,433 (57 %) | 12 | 0 | 0 |
| Computrabajo | 944 | 223 (24 %) | 380 | 167 | 214 |
| LinkedIn | 960 | 179 (19 %) | 602 | 87 | 161 |
| Elempleo | 385 | 313 (81 %) | 3 | 4 | 0 |

Los logs de `scrape-jobs-ve.yml` no tienen líneas «Detalle X: …», porque VE
no tiene paso de drain. Sí registran reintentos 429 en el detalle:
Computrabajo-VE 97 y LinkedIn-VE 72. Además, el **listado** de LinkedIn
devuelve 429 muchas veces: 1,810 líneas «[LinkedIn] Failed: 429» en CO y
1,555 en VE en 15 días.

`source_attempts` (etapa `detail`) da el mismo cuadro. Computrabajo CO tiene
90 intentos `failed` y 16 `timeout`, con 7 válidos en `success`. LinkedIn CO
tiene 255 `partial` y 489 fallidos.

## 4. Muestra de inspección en Search Console (20 URLs)

Las 20 URLs pasaron a aptas entre el 21 y el 25 de octubre. Las dos mitades
tuvieron la misma oportunidad de rastreo, y en el grupo «solo sitemap» el
«nunca enviada» ya es definitivo. Antes de inspeccionarlas se comprobó que
las 20 responden 200, tienen JobPosting, no tienen `noindex` y su canonical
apunta a sí mismas. «Último rastreo» es la hora que muestra GSC en el
navegador.

### Notificadas por la API (10)

| URL | Fuente | Apta (UTC) | Enviada (UTC) | Último rastreo (GSC) | Indexada | Canonical Google |
|---|---|---|---|---|---|---|
| https://buscotrabajo.co/empleos/1929b1e9-8144-499e-a082-0790e7f5b3c4/jefe-de-contabilidad-bogota-d-c-capital-district-colombia | LinkedIn | 10-24 21:27 | 10-31 13:20 | 25-oct 06:38 | Sí | = declarada |
| https://buscotrabajo.co/empleos/39e82f7a-d7e1-48da-9816-bd9514e75670/ingeniero-ai-bogota-d-c-capital-district-colombia | LinkedIn | 10-23 17:39 | 10-30 08:06 | 30-oct 05:13 | Sí | = declarada |
| https://buscotrabajo.co/empleos/f5c7453e-ee56-4798-a920-2666c5c7bcaa/aprendiz-auxiliar-administrativo-a-medellin-metropolitan-area | LinkedIn | 10-23 13:06 | 10-30 08:06 | 30-oct 05:16 | Sí | = declarada |
| https://buscotrabajo.co/empleos/9509d9e2-f43b-457f-bd1d-6b0cd2a0a610/practicante-de-administracion-de-empresas-bogota-d-c-capital-district-colombia | LinkedIn | 10-22 18:20 | 10-29 02:07 | 28-oct 06:30 | Sí | = declarada |
| https://buscotrabajo.co/empleos/7436aa16-b9a5-416f-902d-3846240fa31c/analista-de-venta-de-repuestos-pereira-risaralda-colombia | LinkedIn | 10-24 19:04 | 10-31 13:20 | 25-oct 07:24 | Sí | = declarada |
| https://buscotrabajo.co/empleos/9f6c4b54-0334-4f71-8edb-ba2d9d85baf0/analista-de-reporting-ooh-bogota-d-c-capital-district-colombia | LinkedIn | 10-24 21:31 | 10-31 13:20 | 25-oct 08:01 | Sí | = declarada |
| https://buscotrabajo.co/empleos/1d8ec9e8-ef11-435e-9901-48518dc4988c/finance-specialist-valencia-carabobo-state-venezuela | LinkedIn | 10-23 13:04 | 10-30 08:06 | 25-oct 12:35 | Sí | = declarada |
| https://buscotrabajo.co/empleos/2fc79a05-3361-4bbf-a1cb-4d07e825204a/actuario-pricing-bogota-d-c-capital-district-colombia | LinkedIn | 10-24 21:31 | 10-31 13:20 | 25-oct 07:14 | Sí | = declarada |
| https://buscotrabajo.co/empleos/b5f3eeb4-5b7d-4bfb-bcba-20c1ddd6b1bc/despachador-yumbo-valle-del-cauca-colombia | LinkedIn | 10-23 12:58 | 10-30 08:06 | 26-oct 09:47 | Sí | = declarada |
| https://buscotrabajo.co/empleos/b07c8d45-570c-4a8e-9e46-305918f392a5/asesor-comercial-externo-tat-pap-mercaderista-preventista-barrancabermeja-barran | LinkedIn | 10-24 19:04 | 10-31 13:20 | 25-oct 06:33 | Sí | = declarada |

### Solo sitemap (10, `api_window_expired`)

| URL | Fuente | Apta (UTC) | Caducada (UTC) | Último rastreo (GSC) | Indexada | Canonical Google |
|---|---|---|---|---|---|---|
| https://buscotrabajo.co/empleos/83780fa0-4fd9-4d32-9b61-f76f94f2af2e/supervisor-sr-project-delivery-bogota-d-c-capital-district-colombia | LinkedIn | 10-24 07:44 | 10-31 13:19 | 25-oct 06:28 | Sí | = declarada |
| https://buscotrabajo.co/empleos/188feddf-3ec1-4ebc-b892-b3d2e22bb79b/net-software-developer-bogota-d-c-capital-district-colombia | LinkedIn | 10-21 15:34 | 10-28 17:06 | — | **No**: «Descubierta: actualmente sin indexar» | — |
| https://buscotrabajo.co/empleos/29d9bc52-8b85-42fa-9f28-412f6dedb46b/auxiliar-de-soporte-tecnico-y-logistico-zipaquira-zipaquira-cundinamarca-colombi | LinkedIn | 10-25 23:27 | 11-02 00:17 | 27-oct 00:46 | Sí | = declarada |
| https://buscotrabajo.co/empleos/f3db6c7f-3e83-451e-9b88-54433f44de14/general-manager-marketing-and-ecommerce-growth-remoto | WeRemoto | 10-25 23:24 | 11-02 00:17 | 28-oct 06:40 | Sí | = declarada |
| https://buscotrabajo.co/empleos/d6edb1ea-d0bd-4b1d-a8b4-7efd54a03e90/asesor-comercial-envigado-envigado | Magneto | 10-24 02:29 | 10-31 06:39 | 30-oct 03:07 | Sí | = declarada |
| https://buscotrabajo.co/empleos/24b943fb-642b-47e6-8dce-3b0ff78e5d13/mecanico-automotriz-senior-diagnostico-electronico-caracas-la-lagunita-federal-d | LinkedIn | 10-23 23:38 | 10-31 00:24 | 1-nov 17:07 | Sí | = declarada |
| https://buscotrabajo.co/empleos/d70a1ce6-9e6b-43df-88a6-9a62de2bc7d7/asistente-de-gerencia-y-tesoreria-clinica-privada-bogota-bogota-d-c-capital-dist | LinkedIn | 10-23 17:45 | 10-30 20:25 | 25-oct 08:08 | Sí | = declarada |
| https://buscotrabajo.co/empleos/937b6365-9c2b-4de3-913e-45c3399fc6b8/analista-de-comercio-exterior-cali-valle-del-cauca | Computrabajo | 10-22 20:47 | 10-29 21:32 | 25-oct 20:47 | Sí | = declarada |
| https://buscotrabajo.co/empleos/846cd3ff-286e-4dc8-b050-dd5bbc6d55cf/consigliere-a-in-materia-di-sicurezza-umana-caracas-federal-district-venezuela | LinkedIn | 10-22 20:51 | 10-29 21:32 | 26-oct 03:06 | Sí | = declarada |
| https://buscotrabajo.co/empleos/cd907ac7-71ea-4bef-983c-c477841bb3c8/asistente-financiera-facatativa-facatativa | Elempleo | 10-23 00:01 | 10-30 01:34 | 1-nov 11:31 | Sí | = declarada |

**Resultado: 19 de 20 indexadas.** Notificadas por la API: 10/10. Solo
sitemap: 9/10.

- En las 19 indexadas, la canonical que elige Google es la URL inspeccionada.
- En 18 de esas 19, la página de referencia es `sitemap-jobs.xml`. En la de
  Computrabajo (`937b6365…`), GSC dice «No se ha detectado ninguna».
- En 5 indexadas, el campo Sitemaps muestra «Error temporal de
  procesamiento» en vez de la lista: actuario, asesor de Barrancabermeja,
  supervisor, auxiliar de Zipaquirá y asesor de Envigado. Es lo que muestra
  GSC; de ahí no se saca ninguna conclusión.
- En 8 de las 10 notificadas, el último rastreo es seguro **anterior** al
  envío por la API. Google ya las había rastreado e indexado desde el
  sitemap, y hasta la inspección (1–3 días después del envío) el envío no
  provocó un rastreo nuevo.
- Las otras 2 (ingeniero AI y aprendiz) se rastrearon el 30-oct a las 05:13
  y 05:16, el mismo día del envío (08:06 UTC). Fue después del envío si GSC
  muestra la hora de Bogotá, y antes si muestra UTC. GSC solo muestra el
  último rastreo, así que esas dos ya podían estar indexadas antes.
- La única no indexada es la más antigua de la muestra (apta el 21-oct). Se
  descubrió por el sitemap y no se ha rastreado.
- Sesgo de la muestra: las 10 notificadas son de LinkedIn, la fuente que más
  aptas aporta. n = 20 no permite cifras por fuente.

Que el 95 % de la muestra esté indexado contrasta con el informe de páginas
de GSC (569 indexadas y 29,519 sin indexar), que sigue atrasado (C4 del plan).

## 5. Conclusiones para las fases siguientes

**F1, cuota.** Las cifras reales están en `docs/INDEXING-API-QUOTA-REQUEST.md`:

- 286 nuevas aptas/día;
- 308 `URL_UPDATED`/día;
- 172 caducadas/día;
- 95–172 retiros notificados/día, más un atraso de 8,850.

Cada URL notificada recibe tarde o temprano su `URL_DELETED`. Si se
notificaran todas las nuevas, la demanda estable sería de ~310 nuevas + ~310
retiros = **~620/día**, frente a los 200/día actuales. El usuario
confirmó que la solicitud nunca se envió.

**F2, orden de envío: los datos lo justifican.**

- Con FIFO y la cola llena, cada `URL_UPDATED` sale entre 158 y 167 h después
  de pasar a apta, justo antes de caducar a las 168 h.
- El 100 % de las enviadas tenía más de 48 h, frente a una vida mediana en la
  fuente de ~2 días (ADR 0004).
- En la muestra, al menos 8 de 10 notificaciones llegaron cuando Google ya
  había rastreado la página desde el sitemap.

La cuota se gasta en la parte del ciclo de vida donde ya no acelera nada.
Esto no prueba que `newest` mejore la indexación, pero sí que FIFO, con la
cola llena, no usa la API para lo que existe. F2 debe repetir
`scripts/simulate-indexing-queue.ts` con estas llegadas y medir «notificadas
en ≤24 h desde apta». Hay dos hallazgos relacionados que F2 debe decidir sin
mezclarlos con el carril de nuevas:

- El carril de retiros tiene 8,850 pendientes con una mediana de 44 días: un
  410 se notifica unos dos meses tarde.
- El tick envía los 200 de una sola vez una vez al día, y la hora se retrasa
  cada día. Repartir el envío entre las ejecuciones del día es un cambio
  pequeño y aparte.

**F3, más aptas nuevas.** Fuentes que limitan, de mayor a menor efecto:

1. **Computrabajo CO.** Solo el 2 % de las nuevas llega a apta: 2,121
   `pending` y 449 `retry` en 14 días, 214 respuestas 429 en los logs y 24 %
   de completas por reclamación. No se debe subir la presión sobre esta
   fuente.
2. **LinkedIn CO.** El 21 % llega a apta: 4,818 `pending` y 593 `retry`, 161
   respuestas 429 y 19 % de completas. Siguen vigentes los límites de robots y
   la ruta translate.goog.
3. **Magneto CO.** Su problema no son los 429 (0 en los logs; el 57 % de lo
   reclamado se completa). Es el **atraso del drain**: 1,385 `pending`, y las
   que llegan a aptas tardan 107–113 h. El drain reclama 30 por tick, de las
   más antiguas. Dar prioridad a las más recientes en Magneto, o darle el
   presupuesto que hoy se gasta en reintentos 429 de LinkedIn y Computrabajo,
   es la palanca más barata de F3.
4. **Elempleo** ya llega al 98 %. Glassdoor, Indeed y Workana no generan
   aptas por diseño (sin detalle soportado o sin clasificación de empleo).

Los empleadores directos (Portal oficial) aportan ~72 aptas/día sin consumir
la API. Es la vía que no compite por la cuota.
