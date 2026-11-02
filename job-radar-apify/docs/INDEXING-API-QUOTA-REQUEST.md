# Indexing API — material para solicitar más cuota

**Estado:** preparado 2026-09-18 · cifras actualizadas con producción el
2026-11-01 (F0 de `GOOGLE-JOBS-INDEXING-PLAN-2026-11.md`) · **NO enviado**
(confirmado por el usuario el 2026-11-01). Lo envía el dueño del proyecto de
Google Cloud: es la fase F1 del plan. La v2 lleva en producción más de 7 días,
así que la condición de "Cuándo enviarlo" ya se cumple.
Base: `docs/adr/0004-indexing-api-notification-policy.md`.

No incluye claves, tokens ni credenciales. Nunca pegar la clave privada de la
cuenta de servicio en el formulario, en un chat ni en un ticket.

## 1. Identificar el proyecto de Google Cloud

- El proyecto es el que aloja la cuenta de servicio de `GOOGLE_INDEXING_CLIENT_EMAIL`
  (secret de GitHub Actions y `.env`). El email tiene la forma
  `<nombre>@<PROJECT_ID>.iam.gserviceaccount.com`: el `PROJECT_ID` es el
  texto entre `@` y `.iam`. Se puede leer desde Cloud Console → IAM y
  administración → Cuentas de servicio, sin abrir el secret.
- En ese proyecto: APIs y servicios → "Web Search Indexing API" → Cuotas. Ahí
  se ve la cuota vigente y se confirma el ID/número del proyecto.
- En Search Console, la propiedad verificada `buscotrabajo.co` tiene esa
  cuenta de servicio como **Propietario** (`docs/SEO-PLAN.md` §7.2).
- Una sola cuenta y un solo proyecto. No repartir el tráfico entre proyectos
  para esquivar la cuota.

## 2. Cifras para el formulario

| Campo | Valor |
|---|---|
| Sitio | https://buscotrabajo.co |
| Tipo de contenido | Páginas de vacante individuales con `JobPosting` (`/empleos/:id/:slug`) |
| Cuota actual | 200 solicitudes de publicación/día (inicial), gastada entera cada día |
| **Cuota solicitada** | **1,500 publicaciones/día** |
| Vacantes nuevas aptas para Google (sin proyecciones oficiales, que no usan la API) | **286/día** (media 19–31 oct; mediana 262; rango 219–398; últimos 7 días 301) |
| `URL_UPDATED` encoladas | **308/día** (media; máximo 412) |
| `URL_UPDATED` que caducan sin enviarse (`api_window_expired`) | **172/día** (media; mediana 196; últimos 7 días 185) |
| `URL_DELETED` de URLs notificadas antes por la API (política D2) | **95/día** de media, **172/día** en los últimos 7 días y subiendo; además hay **8,850 pendientes** con una mediana de 44 días de espera |
| Enviadas hoy | 100 `URL_UPDATED` + 100 `URL_DELETED` por día, 0 fallos |
| Proporción de nuevas aptas notificadas | **30 %** (cohorte ya cerrada, aptas hace 8–14 días: 494 de 1,639; 68 % caducó sin enviarse) |
| Demanda total estable | ~310 nuevas + ~170 retiros = **~480/día**, más el atraso de 8,850 retiros |
| Por qué 1,500 | Cubre la demanda estable con margen para picos (412 nuevas/día observadas) y vacía el atraso de retiros en ~10 días. La simulación del 2026-09-18 (1,325/día para p95 ≤48 h en semanas pico) sigue siendo la referencia de dimensionamiento |
| Mínimo útil | 800/día: cubre la demanda estable sin caducidades y vacía el atraso en ~1 mes |

Fuente de las cifras: `docs/seo-baseline/2026-11-google-jobs-funnel.md`
(consulta agregada de solo lectura y logs de `indexing-tick`, 18-oct a
1-nov de 2026).

## 3. Evidencia de uso correcto (resumen para el formulario)

1. **Solo `JobPosting`.** La API se usa exclusivamente para URLs de vacantes
   individuales con `JobPosting`. No se envían listados, categorías ni otras
   páginas.
2. **Puerta de calidad estricta.** Una vacante solo es apta con descripción
   completa de la fuente, empresa real, ubicación y país declarados por la
   fuente, y un enlace para postular. Evaluador único:
   `src/lib/google-job-readiness.ts`. Hoy son 15,580 aptas de 65,956 activas
   (24%); Workana: 0 aptas.
3. **Las no aptas no emiten `JobPosting`.** Se sirven con `noindex,follow`,
   quedan fuera del sitemap y nunca se notifican. Las pruebas
   `tests/validate-job-seo-v2.ts` comprueban el invariante "robots · JobPosting
   · sitemap · URL_UPDATED coinciden" para cada vacante.
4. **Ciclo de vida.** Una vacante que deja de verse 30 días se purga y
   devuelve **HTTP 410**, sale del sitemap y pierde el `JobPosting`.
   `URL_DELETED` solo se envía para URLs que la API notificó antes (ADR 0004).
5. **Sin ruido.** Cada versión se notifica una sola vez (deduplicación por
   `content_hash`), nunca por un simple redescubrimiento. Si la notificación no
   se envía en 7 días, vence y el sitemap la cubre. La cola dejó de crecer sin
   límite: de ~3,356 filas/día bajo el código anterior a la demanda real de
   arriba.
6. **Presupuesto controlado.** El envío respeta la cuota contando las
   solicitudes reales (enviadas y fallidas) de las últimas 24 h, y se detiene
   tras 5 fallos consecutivos.

## 4. Cuándo enviarlo

Ya: la v2 lleva más de 7 días enviando `URL_UPDATED` solo para vacantes
aptas, y las cifras de la sección 2 son de producción (2026-11-01). Si se
envía después del 2026-11-15, volver a medir en solo lectura con
`docs/seo-baseline/google-jobs-funnel-queries.mjs`:

- nuevos aptos/día;
- retiros notificados/día;
- filas cerradas por `api_window_expired`/día.
