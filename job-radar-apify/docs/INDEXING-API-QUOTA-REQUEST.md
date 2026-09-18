# Indexing API — material para solicitar más cuota

**Estado:** preparado 2026-09-18 · **NO enviado**. Lo envía el dueño del
proyecto de Google Cloud, después de desplegar la v2 (ver "Cuándo enviarlo").
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
| Cuota actual | 200 solicitudes de publicación/día (inicial) |
| **Cuota solicitada** | **1,500 publicaciones/día** |
| Vacantes nuevas aptas para Google | ~389/día (media de 14 días); ~500/día (media de 30 días); semana pico ~1,000/día |
| Retiros notificados por la API (política D2) | ≈ las publicaciones enviadas ~30 días antes: ~350-500/día en régimen estable |
| Demanda total estable | ~780/día (base) · ~1,000/día (pico) |
| Por qué 1,500 | La simulación con llegadas reales exige 1,325/día para p95 ≤48 h en semanas pico; se añade ~13% de margen |
| Mínimo útil | 800/día (p95 33 h con la mezcla base) |

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

Después de desplegar la v2 y observar al menos 7 días de `URL_UPDATED` solo
para vacantes aptas, para que las cifras del formulario sean las de
producción. Antes de enviarlo, volver a medir en solo lectura:

- nuevos aptos/día;
- retiros notificados/día;
- filas cerradas por `api_window_expired`/día.
