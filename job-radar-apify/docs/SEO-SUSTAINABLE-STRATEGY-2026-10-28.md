# SEO sostenible: visibilidad genérica y ciclo de vacantes

Fecha de observación: 2026-10-28. Base de código: origin/main a83f916.
Entrega de diagnóstico y estrategia; no modifica producción ni la política
de expiración. No promete primeras posiciones ni declara cumplidas las metas
de +500%/+1500%.

## Qué está ocurriendo

Hay crecimiento orgánico desde una base pequeña, pero todavía poca exposición
para búsquedas generales. La captura del usuario muestra dos superficies:
Google Empleos y resultados orgánicos de categorías. Requieren comprobar
elegibilidad de vacantes y relevancia de páginas permanentes, respectivamente.
La captura no prueba desindexación de todo el sitio.

### Search Console: Web, propiedad sc-domain:buscotrabajo.co

Ventanas confirmadas en el selector: 20–26 octubre frente a 13–19 octubre,
ambas de 2026. No equivalen a una comparación mensual.

| Métrica | 13–19 oct | 20–26 oct | Cambio |
|---|---:|---:|---:|
| Clics | 8 | 27 | +237,5%; +19 |
| Impresiones | 549 | 886 | +61,4%; +337 |
| CTR mostrado, redondeado | 1,5% | 3% | +1,5 puntos |
| Posición media | 11,8 | 9 | mejora de 2,8 |

La posición media agrega consultas diferentes; NO significa posición 9 para
«empleo». En la semana actual «busco trabajo» tiene 7 impresiones y 0 clics;
«empleo», 6 y 0; «trabajo», 6 y 0. Las filas de consultas son incompletas por
privacidad; no sumarlas para inferir cuotas de marca.

**Cúcuta** (`https://buscotrabajo.co/empleos/cucuta`):

- Está indexada. Canonical propio aceptado por Google, rastreo/indexación
  permitidos y obtención correcta. Último rastreo almacenado: 11-Oct-2026,
  08:14:28; Googlebot smartphone. Referencias: sitemap y sitemap-categories.
- Página, filtro URL que contiene su dirección: 0 frente a 1 clic; 7 frente
  a 16 impresiones; posición media 33,6 frente a 32.
- Página + consulta exacta «empleos en cucuta»: 1 impresión, 0 clics,
  posición 43 esta semana. Sin impresiones previas: no interpretar el cero
  mostrado de posición anterior como un ranking real.
- Es una muestra pequeña. Demuestra exposición débil, no una posición fija
  para todos los usuarios. País, dispositivo, fecha y personalización cambian
  los resultados.

Estas ventanas terminan ANTES de los enlaces de portada del 27/28-Oct.
No atribuirles la subida ni juzgar su efecto al día siguiente. El reporte de
cobertura tampoco prueba que Google ya haya rastreado esos enlaces.

### GA4: propiedad 547156816, todos los usuarios

Mismas fechas. Conteos de eventos de navegador, sin datos personales.

| Métrica | 13–19 oct | 20–26 oct | Cambio |
|---|---:|---:|---:|
| Usuarios totales, informe de eventos | 166 | 158 | −4,8% |
| Sesiones, adquisición de tráfico | 178 | 202 | +13,5% |
| Sesiones Organic Search | 4 | 25 | +525%; +21 |
| Sesiones AI Assistant, canal configurado en GA4 | 26 | 75 | +188,5% |
| sign_up: eventos / usuarios del evento | 21 / 12 | 172 / 19 | eventos +719%; usuarios +58,3% |
| onboarding_complete: eventos / usuarios | 8 / 8 | 14 / 14 | +75% |
| apply_gate_open: eventos / usuarios | 33 / 27 | 49 / 36 | eventos +48,5% |
| outbound_apply: eventos / usuarios | 27 / 20 | 69 / 24 | eventos +155,6%; usuarios +20% |

Organic Search representa 12,38% de las sesiones actuales frente a 2,25%.
El +525% corresponde SOLO a ese canal y esa ventana: no acredita el objetivo
global/mensual ni crecimiento equivalente de registros.

172 sign_up para 19 usuarios exige revisar duplicación/medición. Existe una
corrección de deduplicación en el código, commit be2ca11 del 24-Oct; esta
ventana mezcla fechas anteriores y posteriores. No demuestra por sí sola
que la corrección actual falle. Reconciliar días completos posteriores al
despliegue con cuentas reales verificadas y pruebas excluidas. No se consultó
el agregado de cuentas de producción en esta entrega; 19 tampoco es un
conteo certificado de registros. outbound_apply mide salidas, no solicitudes
completadas en la fuente. session_start (201) no sustituye sesiones (202).

### Cobertura y Google Empleos

Informe de páginas, actualización indicada **22-Oct**:

- 569 páginas indexadas; 29,5 mil sin indexar, cifra redondeada.
- 2.678 Soft 404; 9.745 rastreadas actualmente sin indexar;
  7.095 descubiertas actualmente sin indexar; 8.114 no encontradas (404).
- 1.446 noindex; 434 bloqueadas por robots; 5 con canonical distinto;
  2 con redirección; 0 errores 5xx en ese reporte.
- Los ejemplos Soft 404 tienen rastreos visibles hasta el 24-Oct, aunque la
  cabecera global indique 22-Oct. Las fechas del informe no son un diagnóstico
  en vivo. No atribuir todos esos casos a un único fallo ni a la purga.

Ya existe una corrección para el renderizado cuando Google no puede cargar
la API del detalle (`job-render-seo`). Revisar una muestra de URLs activas
afectadas antes de repetir esa implementación. Tres ejemplos Soft 404
respondieron HTTP 200 hoy; esto NO prueba su renderizado/indexación actual.

Prueba adicional en vivo, 28-Oct 17:32, de la oferta
`80a79169-1999-4e16-abe7-ab4f22102c7c` (Inside sale agente de carga
internacional): estado almacenado Soft 404, último rastreo 24-Oct 05:35:59;
prueba actual «La URL está disponible para Google», «La página se puede
indexar» y 1 JobPosting válido con problemas no críticos. La captura de
Googlebot smartphone muestra título, empresa, descripción y botón hacia
Elempleo, en el diseño actual. En esta muestra el fallo no se reproduce hoy;
la prueba en vivo no la añade al índice ni certifica recuperación global.
No se solicitó indexación ni validación masiva.

Ofertas de trabajo, actualización **26-Oct**: **5 elementos válidos y 0 no
válidos**. Advertencias opcionales: streetAddress/postalCode/baseSalary en 5,
addressRegion en 1. No inventar datos para quitar advertencias. Un elemento
válido no garantiza aparición en Google Empleos. El reporte no permite
calcular una tasa de elegibilidad usando como denominador el sitemap.

Sitemaps enviados, todos «Correcto»:

| Sitemap | Última lectura | Páginas descubiertas |
|---|---|---:|
| sitemap.xml | 26-Oct | 7.815 |
| sitemap-jobs.xml | 26-Oct | 7.706 |
| sitemap-pages.xml | 24-Oct | 18 |
| sitemap-categories.xml | 27-Oct | 91 |

Descubiertas no equivale a indexadas, vigentes o seleccionadas para mostrar.
No hay evidencia aquí de que reenviar sitemaps masivamente resuelva el ranking.

## Los 30 días: regla real de la aplicación

`src/lib/job-freshness.ts` fija MAX_JOB_AGE_DAYS=30 y exige fecha de publicación
reciente más valid_through no vencido. Los lectores públicos y Google usan
esa misma condición. `getJobById` deja de servir la oferta activa al fallarla;
el detalle vencido puede responder 410 incluso antes de la purga.

`src/db/scheduler-repository.ts::purgeOldJobs` borra por last_seen_at antiguo
O por incumplir esa condición, hasta 2.000 filas por tick. Registra eliminación
en cola/tombstones y hashes en expired_job_urls. La prevención de reinserción
dura 180 días. El motivo «expired» no distingue edad de cierre por fecha,
y los hashes no conservan el cuerpo original: no permiten reconstruir las
ofertas ni cuantificar retrospectivamente pérdidas causadas SOLO por edad.

Por tanto una oferta de más de 30 días puede retirarse aunque siga apareciendo
en su fuente. Esto es un riesgo de pérdida prematura, todavía sin cuantificar;
no prueba que toda oferta retirada siguiera aceptando postulaciones ni que
sea la causa única de baja visibilidad.

ADR 0005 responde al requisito anterior de no mostrar vacantes de más de un
mes. No modificar su decisión tácitamente. Una política nueva necesita ADR
que la sustituya explícitamente, evidencia de disponibilidad y pruebas.

## Política objetivo propuesta, pendiente de implementación

| Tipo de página/estado | Tratamiento propuesto |
|---|---|
| Categoría permanente ciudad/cargo | Mantener URL estable; inventario vigente, canonical propio y contenido útil. No eliminarla porque rote una oferta. Evaluar por separado categorías sin inventario; evitar páginas vacías masivas. |
| Oferta >30 días con disponibilidad comprobada | Evaluar mantener misma URL/fecha original mientras la comprobación sea fiable y reciente. Ser visible en un listado o responder 200 no basta. |
| Oferta cerrada o plazo real vencido | Deshabilitar postulación y retirar JobPosting/sitemap de activas, o responder 404/410 según política. Nunca presentarla como disponible. |
| Disponibilidad desconocida | Verificación acotada; no prolongar indefinidamente ni reiniciar datePosted. Mantener protección conservadora hasta definir el contrato. |
| Archivo de oferta cerrada | Solo evaluar si conserva información útil real y alternativas pertinentes. No indexar miles de archivos pobres ni convertir cierres en falsos 200. |

No redirigir automáticamente toda oferta vencida a la portada/categoría:
no son equivalentes y puede generar Soft 404. Redirección solo a sustituto
realmente equivalente comprobado. Nunca restaurar ofertas desde hashes.

Google admite retirar páginas expiradas con 404/410 o retirar el marcado
JobPosting, entre sus opciones de actualización. validThrough debe reflejar
el vencimiento real de la fuente; si es desconocido no inventarlo. Marcado
JobPosting solo en detalle individual, nunca en categorías.

Referencia oficial:
https://developers.google.com/search/docs/appearance/structured-data/job-posting?hl=es

## Estrategia de demanda

Una URL por intención: «empleos en Cúcuta», «trabajo en Cúcuta», «ofertas de
empleo en Cúcuta» deben reforzar /empleos/cucuta; no necesitan tres páginas
casi iguales ni repetición artificial de palabras. La portada puede competir
por «busco trabajo en Colombia»; ciudades/cargos captan necesidades concretas.

Usar el mapa de veinte oportunidades de seo-market-coverage ya existente.
Priorizar demanda observada + inventario real + coherencia del país. No crear
todos los cruces ciudad/cargo sin oferta suficiente. Añadir información local
solo sustentada; no inventar salarios, empresas, cifras ni preguntas frecuentes.

Los resultados competidores visibles presentan páginas permanentes específicas
de ciudad además de ofertas individuales. Eso apoya la correspondencia de
intención; no demuestra sus causas de ranking ni revela sus backlinks. Falta
medir autoridad externa; proponer enlaces editoriales pertinentes con empresas,
universidades y entidades locales, sin compra de enlaces ni mensajes no
autorizados. Publicar en redes puede atraer demanda; no garantiza ranking.

## Orden de ejecución y criterios de salida

Cada fila es una fase separada; no implementar las siguientes en esta sesión.
Los plazos son ventanas orientativas de trabajo/observación, no garantías SEO.

| Prioridad | Entrega | Criterio de salida |
|---|---|---|
| P0, siguiente sesión | Verificar reparación de Soft 404 con muestra acotada de ofertas activas del informe; comparar HTML/render de Google, canonical y JobPosting. Separar cerradas legítimas de errores de render. | Evidencia por URL; corregir solo causas todavía reproducibles. No declarar recuperadas las 2.678 por una muestra. Registrar nueva revisión de cobertura tras rastreo. |
| P0, medición | Auditar sign_up tras despliegue y contrastar agregados de registros reales confirmados, excluyendo pruebas. Segmentar conversiones por canal/página. | Baseline fiable posterior a la corrección; explicar repeticiones o corregirlas con pruebas. Sin PII ni registros de prueba en producción. |
| P1, ciclo de vida | Medir retiros por edad, plazo, cierre confirmado y ausencia. Proponer ADR sustituto de 0005 y contrato de verificación por fuente antes de ampliar retención. | Datos agregados, decisión explícita, identidad estable y simulación/dry-run de afectados. No borrar ni resucitar vacantes para experimentar. |
| P1, permanencia local | Profundizar Cúcuta y las páginas priorizadas por GSC: inventario, títulos existentes, enlaces contextuales, experiencia móvil, país/canonical. Corregir /ve/empleos/remoto antes de promocionarla. | Categorías útiles, sin duplicación por sinónimos; desktop/mobile acordes al diseño; rutas y canonical correctos. No prometer ranking por cambiar títulos. |
| P2, cobertura editorial | Expandir por lotes desde el mapa existente y desarrollar alianzas locales pertinentes. | Cada destino tiene intención distinta, contenido/inventario comprobado y medición. Contactos/publicaciones requieren autorización específica. |
| Seguimiento | Revisar a 7/14/28 días tras cada cambio con ventanas completas y retraso GSC. | Consultas genéricas/locales, clics, impresiones, posiciones y conversiones por landing. Decidir continuar, corregir o revertir según datos. |

Seguimiento: clics, impresiones, CTR, posición, sesiones orgánicas, usuarios
y eventos; no estimaciones de mercado.
Medir especialmente consultas con y sin marca, sin sumar filas incompletas.
Anotar cada despliegue y separar adquisición de conversión. Evaluar +500% o
+1500% contra una línea base y periodo acordados, con magnitudes absolutas;
no cerrar metas por el porcentaje de un evento duplicado o de 4 sesiones.

## Protección de producción y diseño

Toda implementación conservará componentes, tipografía, colores, espaciado y
comportamiento actuales, con comparación desktop/mobile. No se modifica SWR,
warmup, arranque, plan Render ni presupuesto. Si toca dashboard/query/cache,
leer su runbook y verificar proceso frío/URL única edge MISS.

Gates por fase: lint, typecheck, unitarias y pruebas aisladas pertinentes;
integración/baseline cuando corresponda a cambios de comportamiento, migración
o render. Nada de tests SEO históricos contra producción. Dry-run y rollback
reversible antes de escrituras. Secretos/.env no se leen.

Salud pública hoy: portada, Cúcuta, Bogotá, Caracas y sitemap-categories
responden 200; páginas con title/H1 y canonical propios. Es una comprobación
acotada de HTTP/metadata, no un test completo de todas las funcionalidades.

Pendiente de medición: cuentas reales, tamaño del impacto de la purga,
disponibilidad real de ofertas retiradas y recuperación global de indexación.
