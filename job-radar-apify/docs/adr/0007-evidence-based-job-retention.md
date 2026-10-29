# ADR 0007 — Retención basada en disponibilidad comprobada

Fecha: 2026-10-29. **Estado: rechazado por instrucción posterior del usuario; no implementado ni desplegado.**
La regla aceptada es el máximo estricto de 30 días y archivo privado de ADR 0008.
El resto se conserva únicamente como historial de la propuesta descartada.
Al aceptarse con sus gates, sustituirá la parte de ADR 0005 que equipara
antigüedad >30 días a indisponibilidad. No cambia hoy la decisión vigente.
Evidencia: ../JOB-RETENTION-IMPACT-2026-10-29.md y sus SQL/JSON agregados.

## Problema

2.129/7.906 candidatos canónicos aptos para SEO alcanzan el límite en siete
días; 915 tienen vencimiento registrado posterior. Aun así, una fecha futura,
HTTP 200 o last_seen_at no certifican apertura. source_checked_at tampoco:
es cursor de rotación que incluye resultados desconocidos. Desactivar el
límite sin reemplazarlo por evidencia volvería a mostrar vacantes cerradas.

## Decisión objetivo

- Mantener 30 días como regla conservadora para fuentes sin verificación.
  Excepción >30 días únicamente con resultado `open` vigente, obtenido de
  una capacidad de fuente habilitada y testeada; no por nombre de portal.
- Separar `availability_status` (open/closed/unknown), resultado comprobado
  en `availability_verified_at` y método/versionado de evidencia, del cursor
  de último intento. Unknown no renueva una evidencia open anterior.
- La evidencia afirmativa dura **24 horas**. No reemplaza un validThrough
  real vencido ni un cierre explícito más reciente. Un plazo puede cambiar
  únicamente cuando la fuente aporte el nuevo dato; no por extensión local.
- Evidencia permitida: API pública con estado explícito o API/feed oficial
  cuyo contrato garantice que el elemento está publicado/abierto. HTML solo
  con señales deterministas testeadas. No usar LLM, CAPTCHA, HTTP 200 solo,
  redistribuidores o una fecha futura como prueba suficiente.
- Primera capacidad piloto: portal oficial API/feed de solo vacantes abiertas,
  con identidad estable y fixtures que prueben abiertas/cerradas/unknown.
  No se activa automáticamente para todos los ATS ni todas las fuentes.

## Comportamiento por estado

| Estado | Comportamiento público objetivo |
|---|---|
| Vigente en ventana de 30 días, no vencida | Mantener política actual, sin sobreescribir cierres conocidos. |
| >30 días, open comprobado hace <24 h, no vencida | Misma página/ID/URL/fecha, aplicación y elegibilidad sujetas a los gates existentes. |
| >30 días sin prueba vigente / unknown | Sin botón de aplicación ni JobPosting; fuera del sitemap de activas. Página honesta de disponibilidad pendiente, noindex. Conservar identidad durante revalidación. |
| Cierre confirmado o plazo real vencido | Mantener retirada 410 y quitar marcado/sitemap de activas; no mostrarla como abierta. |

Para unknown, reintentar durante **7 días** con presupuesto. Si no se confirma,
servir 410 sin afirmar un cierre que no se comprobó. Conservar mapeo mínimo
de ID/URL/hash de origen durante **180 días**, con limpieza acotada, para que
una reapertura explícitamente verificada reutilice identidad cuando proceda.
No volver a insertar unknown como una vacante «nueva». No recuperar ofertas
ya borradas a partir de un hash sin cuerpo/identidad: esos datos no existen.

El mapeo mínimo y la transición desde expired_job_urls requieren migración
aditiva y pruebas antes de habilitar esta política. No se abre un archivo
indexable masivo de ofertas cerradas; categorías ciudad/cargo siguen siendo
las páginas permanentes para demanda general. El estado pendiente reutiliza
componentes/tokens existentes, con revisión desktop/móvil.

## Operación y medición

- Verificar fuera del servidor web, aprovechando pipeline existente. Piloto
  limitado a 25 verificaciones por pasada, concurrencia 2, deadline máximo
  60 s, un intento por fuente/URL en la pasada; respetar además el presupuesto
  restante del tick, rate limits, robots y circuitos existentes.
- Si el presupuesto no alcanza, no declarar open ni forzar solicitudes;
  devolver unknown/pendiente y reprogramar. No añadir servicios de pago.
- Antes del retiro, registrar causa exacta: plazo, cierre explícito, edad sin
  evidencia o ausencia. Conservar también indicadores agregados de aptitud
  SEO y disponibilidad comprobada, sin HTML, datos de usuarios o PII.
- No reetiquetar históricos expired: no se puede reconstruir su causa real.
- Dry-run obligatorio para comparar conteos actuales/propuestos sin cambiar
  filas, colas, estado público ni enviar notificaciones de indexación.

## Gates de activación

1. Capacidad de fuente demostrada con fixtures y contrato; canario real solo
   con aprobación explícita según AGENTS, fuera de pruebas aisladas.
2. Persistencia distinta para intento vs resultado, migración idempotente,
   RLS y cero permisos públicos sobre evidencia operativa.
3. Una política coherente para ingesta, JS/SQL de lectura, Google readiness,
   sitemap, purga, proyección oficial y prevención de reinserción. Las fechas
   y URLs no se renuevan por redescubrimiento.
4. Tests de 30 días exactos, TTL 24 h exactas, vencimiento real, open/unknown/
   closed, navegación pública, colas/tombstones y reversión a política actual.
5. Integración aislada y baseline de diseño; proteger dashboard/caché/warmup,
   memoria/almacenamiento y presupuesto Render. Sin supresiones de gates.

Rollback: desactivar la excepción de retención, volver al predicado anterior
sin re-fechar ni duplicar vacantes; conservar evidencia/identidades para
diagnóstico. No restaurar cerradas. Validar expiraciones antes de reactivar
notificaciones a Google. No borrar tablas/evidencia como parte del rollback.
