# Requisitos observables — página de vacante

Delta sobre el comportamiento actual de `/empleos/:id/:slug`. La descripción,
el JobPosting, robots, canonical y sitemap no cambian.

- JPD-001: el bloque `<section data-job-description>` y `JobPosting.description`
  son byte a byte iguales a los de antes del cambio para la misma fila.
  Escenario: fixture con descripción HTML completa → mismos hashes.
- JPD-002: una vacante de un empleador real con al menos una vacante activa
  más muestra en el HTML crudo hasta 6 enlaces internos a esas vacantes,
  nunca a sí misma, y un enlace a `/empresas/:slug` cuya etiqueta lleva el
  total de la misma instantánea. Las vacantes de la misma ciudad van
  primero. Escenario: empresa con 14 vacantes → 6
  enlaces + «Ver las 14 vacantes de {empresa}».
- JPD-003: un empleador placeholder («Confidencial», «Confidential Careers»)
  o una empresa sin otras vacantes no muestra el bloque de JPD-002.
- JPD-004: con la caché de empresa fría, la página responde sin esperar a
  Postgres por ese bloque: solo muestra el enlace a la empresa, y la carga
  ocurre en segundo plano.
- JPD-005: una vacante cuya empresa tiene alias de reputación muestra en el
  HTML crudo cada fuente con su etiqueta en texto, su escala y su enlace
  «Ver fuente». Nunca un logo. Sin alias, no aparece la sección.
- JPD-006: una vacante con `source = "Portal oficial"` lo indica en los
  hechos con el nombre de la empresa. Una empresa de la lista curada de
  portales de empleo muestra ese enlace con `rel="nofollow noopener"`.
- JPD-007: lo que el servidor renderiza para JPD-002, JPD-005 y JPD-006 es
  lo mismo que muestra React tras montar, con la misma carga embebida.
- JPD-008: el número de consultas a Postgres por respuesta de
  `/empleos/:id` con la caché caliente es el mismo que antes del cambio,
  para visitante anónimo y para visitante con sesión.
- JPD-009: ningún bloque nuevo contiene frases de plantilla («agregada de»,
  «en BuscoTrabajo encontrarás…»), cifras sin fila de origen, ni entra al
  JSON-LD.
- JPD-010: TTFB con proceso frío y edge MISS dentro de +10 % de la línea base
  medida antes del cambio, según `DASHBOARD-PERFORMANCE-RUNBOOK.md`.
