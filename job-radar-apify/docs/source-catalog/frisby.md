# Frisby: vacantes del portal corporativo

Revisión: 2026-10-26. Objetivo: empresa `FRISBY S.A` del censo de Computrabajo Colombia (8 ofertas en la corrida 40395562327).

- **Propiedad:** la [web principal de Frisby](https://www.frisby.com.co/) enlaza `https://frisby.info/` como «Compañía». Desde ese dominio, [Gente Frisby](https://frisby.info/gente-frisby/) publica las vacantes y sus formularios de aplicación.
- **Acceso:** `https://frisby.info/robots.txt` permite la página y los formularios (`User-agent: *`, solo prohíbe `/wp-admin/`). Con `BuscoTrabajoBot/1.0` se recibieron HTTP 200 para `robots.txt`, el listado y tres formularios de muestra. No se usó login ni se envió ninguna postulación.
- **Listado:** la página entrega 91 bloques `job-section`, cada uno con título, descripción, ciudad, departamento y enlace `aplicar-frisby`. Los 91 enlaces son únicos. No se observó paginación. El conector exige el marcador de vacantes, coincidencia exacta entre bloques y enlaces, forma completa de cada bloque, ids únicos y ausencia de paginación; si falla, no cierra ofertas.
- **País y fechas:** los 15 departamentos observados son colombianos. El conector solo acepta departamentos colombianos conocidos. La página no declara fecha de publicación ni vencimiento; ambos campos quedan `null` y la aplicación no debe presentar el instante de detección como fecha publicada.
- **Límite:** una vacante en el sitio corporativo no demuestra que cada anuncio de Computrabajo tenga una contraparte exacta. La deduplicación opera solo cuando los datos coinciden. Si el sitio cambia el HTML o pagina, el conector falla de forma segura y requiere revisión.

El canario manual `scripts/canary-frisby.ts --allow-live-sources` hizo una lectura local sin escrituras: 91/91 ofertas colombianas, 0 fechas declaradas y 3/3 formularios de muestra disponibles. La ejecución desde GitHub Actions y el tick de producción se registrarán por separado.
