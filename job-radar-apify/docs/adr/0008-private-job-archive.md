# ADR 0008 — Archivo privado, máximo público de 30 días

Fecha: 2026-10-29. Estado: aceptado para implementación; despliegue sujeto a gates.

La instrucción del usuario conserva un máximo estricto de 30 días. ADR 0007
queda rechazado; no se implementa su excepción. ADR 0005 mantiene su regla de
visibilidad; cambia la destrucción inmediata del contenido por archivo privado.

Investigación oficial consultada el 29 de octubre:

- [LinkedIn](https://www.linkedin.com/help/linkedin/answer/a520455/access-your-closed-job-posts-on-linkedin?lang=en): retira cerradas de búsqueda y conserva acceso del empleador al historial.
- [Indeed](https://www.indeed.com/hire/resources/howtohub/how-to-close-or-pause-jobs-on-indeed): distingue abiertas, pausadas y cerradas; las cerradas quedan archivadas.
- [Google](https://developers.google.com/search/docs/appearance/structured-data/job-posting): una oferta vencida debe dejar de anunciarse como activa; permite retirar la página con 404/410 o su marcado JobPosting.

Estas fuentes no prueban retención pública indexable ni plazos internos de
almacenamiento de todos los competidores. No atribuimos esa política a Computrabajo.

## Decisión

- Conservar exactamente el predicado público vigente: publicación dentro de
  30 días y plazo real no vencido. Cierre confirmado puede retirar antes.
  Redescubrimiento no reinicia la fecha ni extiende el plazo.
- Mover atómicamente las filas retiradas de `jobs` a `archived_jobs`, con
  identidad, hash, instantánea original, fecha y motivo. Si falla el archivo,
  no se elimina la fila. Sin tabla/migración, fallar sin destruir contenido.
- Separar el archivo del corpus consultado: ningún cambio de diseño, caché,
  consultas calientes, sitemaps, APIs ni listado público. RLS sin políticas,
  REVOKE a PUBLIC/anon/authenticated; solo acceso interno del servidor.
- Mantener 410/noindex/sin JobPosting ni postulación para URLs retiradas,
  incluso si falla la cola de indexación. No redirigir masivamente a categorías.
- Guardar el archivo 180 días desde el retiro (decisión propia, coherente con
  `expired_job_urls`), poda por lotes de hasta 2.000 en el tick; sin usuarios,
  postulaciones o datos personales de candidatos. No recuperar contenido que
  ya fue destruido antes del cambio.
- Mantener tombstones y avisos Indexing API existentes, sin gastar cuota para
  páginas nunca notificadas. El archivo también impide reinserción del mismo hash.
- Una proyección oficial que se restaure dentro de su ventana conserva el
  mismo ID y la fecha original más antigua, incluida la del archivo. Nunca
  restaura una oferta de más de 30 días. Se preserva la reactivación existente
  de tableros temporalmente deshabilitados dentro de esa ventana.

El archivo interno no conserva por sí solo rankings de URLs vencidas. Para
demanda persistente (empleo, ciudad, cargo), siguen siendo esenciales las
páginas estables de categorías con vacantes actuales; esta fase no las cambia.

## Gates y rollback

Migración aditiva e idempotente, dry-run por defecto, aplicada antes del código.
Pruebas aisladas: movimiento atómico, límites, privacidad, reinserción,
proyección, sitemap, respuesta 410, y poda acotada. Lint, tipos, unitarias,
integración y baseline deben pasar. No cambiar servicios ni presupuesto.
Rollback de código conserva la tabla y sus datos; no ejecutar DROP ni restaurar
ofertas vencidas. Comprobar producción después de desplegar.
