# Alertas de Search Console — 2026-10-29

Propiedad sc-domain:buscotrabajo.co, lectura directa autenticada del panel
Mensajes y los informes enlazados. Wizard sin plan operativo; sin leer .env,
credenciales ni datos personales. No se modifica robots, canonicals, noindex,
ofertas, diseño, presupuesto o infraestructura.

## Qué representan las notificaciones

Se inventariaron 23 mensajes acumulados entre 26-Jul y 28-Oct. Se leyó el
contenido de los 18 avisos técnicos de indexación/datos estructurados. Los
otros cinco títulos son dos logros de clics, dos mensajes generales de inicio
y un aviso de propietario nuevo del 29-Jul. No equivalen a 23 incidencias
actuales independientes ni 17 fallos porque la bandeja muestre 17 sin leer.
No se borra ni se marca masivamente la bandeja para aparentar resolución.

| Fecha del mensaje | Contenido confirmado | Interpretación / acción |
|---|---|---|
| 28-Oct | Validación de Soft 404, 2.678 páginas | La revisión iniciada ayer continúa. Esperar resultado; no reiniciar. |
| 26-Oct | addressRegion ausente, no crítico | Añadir solo cuando la fuente proporcione región fiable; no bloquea elegibilidad según el aviso. |
| 11-Oct | streetAddress, baseSalary, postalCode ausentes, no críticos | No inventar domicilios/códigos/salarios ni completar por inferencia comercial. |
| 07-Oct | Excluida por noindex | Revisar URLs concretas y su estado actual; no quitar todo noindex. |
| 23-Sep | 404 en páginas de un sitemap | Comprobar sitemap actual frente a URLs retiradas, no solo historial. |
| 20-Sep | Falló validación «Rastreada: actualmente sin indexar» | No se resuelve con reenviar la validación sin cambiar la causa. Priorizar muestra activa de ese grupo. |
| 17-Sep | Inicio de esa validación, 9.632 entonces | Conteo histórico; no sumarlo al actual. |
| 06-Sep, dos avisos (sitio/sitemap) | Google eligió canonical distinto | Misma clase de causa, no dos incidentes nuevos. Comparar URL deseada y elegida antes de modificar. |
| 25-Aug | Cinco campos JobPosting opcionales ausentes: dirección, código postal, salario, región, tipo de empleo | Advertencias no críticas; no evidencia de penalización. El informe posterior ya mostraba 0 ejemplos de employmentType, no debe reabrirse a ciegas. |
| 23-Aug | Validación fallida de redirección + aviso 404 | Las redirecciones/retiradas pueden ser intencionales. Ver destino y contenido equivalente. |
| 16-Aug | Validación fallida de Soft 404 | Histórica, anterior a reparación de render y nueva validación 28-Oct. |
| 11-Aug | Inicio validación redirección, 1 URL entonces | Referencia histórica, no contador actual. |
| 09-Aug, dos avisos | Inicio «Descubierta: actualmente sin indexar», 26.000; inicio Soft 404, 49 | No confundir contadores de agosto con cobertura actual. |
| 07-Aug, dos avisos | Soft 404, robots y redirección (sitio); Soft 404 (sitemap) | Solapan causas de los informes, no prueban que todas persistan. |

Los tres avisos JobPosting dicen expresamente que sus problemas no críticos
son sugerencias que **no impiden aparecer en Google**. No equivalen a tener
buen posicionamiento ni garantizan Google Empleos. El código existente omite
baseSalary deliberadamente; no se cambia esa decisión para apagar un aviso.

## Cobertura observada hoy

La UI de páginas continúa indicando actualización **22-Oct**, no 29-Oct:
569 indexadas, 29,5 mil sin indexar; 2.678 Soft 404, 9.745 rastreadas sin
indexar, 7.095 descubiertas sin indexar, 8.114 404, 1.446 noindex, 434 robots,
5 canonical discrepante, 2 redirecciones, 0 errores de servidor en ese informe.
No calcular crecimiento diario con ese snapshot. No todos los excluidos
deben indexarse: acceso/cuenta/API, duplicados y retiradas tienen otra función.

Los informes de **Acciones manuales** y **Problemas de seguridad** muestran
«No se ha detectado ningún problema» el 29-Oct. No hay una sanción manual o
incidencia de seguridad reportada en esas vistas; eso no descarta problemas
de calidad, rastreo o clasificación algorítmica.

La captura del estado de validación se guardó fuera del repositorio en
visualizations/2026/09/27/01a0e06e-cb24-7e60-96f6-1f848147a265/
seo-soft404/validacion-2026-10-29.jpg.

### Contraste público acotado del 29-Oct

- Primeros tres ejemplos del informe noindex (rastreo 19-Oct) ahora son 410:
  e828c1e2-12d8-49df-b3c3-4d52a388195b (créditos),
  4bc7a6fb-566c-45d1-a0d4-1a5a8c8228f8 (comercial salud),
  2584803c-810f-4733-8c45-f7d8510306b3 (habilitación salud).
  No prueban un noindex actual en oferta activa ni deben restaurarse como 200.
- Dos ejemplos del grupo canonical distinto también son 410 hoy:
  7e1da846-8821-4098-8cda-8d63102eb68c y
  16c0c19f-28c2-48dc-849d-82ae9cf79029. Inspección almacenada del primero:
  duplicada, último rastreo 24-Aug 23:50:16; canonical propio declarado,
  elegido por Google N/D en esa vista. No se afirma qué URL ganó ni se diseña
  una redirección con datos insuficientes.
- /empleos/cucuta: 200, canonical propio; no meta robots ni X-Robots-Tag
  noindex detectado. Sin JobPosting en categoría, comportamiento correcto.
- robots.txt público: permite /, conserva exclusiones de login, cuenta,
  callback y /api/ salvo /api/v1/. No hay bloqueo global de categorías.
  La reparación de render evita depender de la API bloqueada para Google.
- sitemap-jobs.xml: 200 y XML parseable, **7.950 URLs** en el momento de lectura.
  Los tres retirados de noindex y los dos retirados de la validación antigua
  Soft 404 (a32a9ac6… y bdafa3cf…) no figuran. No se auditó HTTP de las 7.950;
  esta muestra no certifica el sitemap completo.

GET propios de solo lectura, concurrencia máxima dos, timeout 20–25 s y
lectura acotada. Sin canarios de adaptadores ni escrituras de producción.
Un 410 confirma retiro en BuscoTrabajo, no el motivo real de cierre en la fuente.

## Prioridad y decisión

1. Seguir la validación Soft 404 iniciada 28-Oct. La muestra de cinco ofertas
   activas pasó la prueba en vivo; todavía no se certifica inclusión global.
2. Para «rastreada sin indexar», separar URLs ya retiradas de ofertas activas
   con contenido suficiente y categorías permanentes. Revisar calidad,
   duplicación, render y enlaces en una muestra antes de tocar reglas.
3. Mantener noindex/robots de rutas privadas y de calidad insuficiente; solo
   corregir exclusiones accidentales demostradas en URLs que sí deseamos indexar.
4. Resolver campos opcionales solo con hechos de fuente fiables. Dirección
   o salario inventados pueden perjudicar calidad y confianza.
5. Continuar las fases ya definidas: medición fiable de registros, retiros por
   causa y páginas permanentes locales/cargos. No prolongar ofertas cerradas
   ni crear múltiples páginas casi iguales para sinónimos.

Este triage amplía la misma verificación P0. No es un despliegue nuevo ni
una declaración de haber resuelto ranking, todas las exclusiones o la meta
de +500%/+1500%.
