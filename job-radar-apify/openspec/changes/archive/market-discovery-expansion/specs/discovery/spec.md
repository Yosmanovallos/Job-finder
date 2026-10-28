# Requisitos observables

- MDE-001: / ofrece en HTML, Markdown y React los seis destinos CO exactos
  (Bogotá, Cúcuta, Armenia, Neiva, Ibagué, Popayán), y /ve los dos VE (Caracas
  e ingeniero civil). Sin duplicados ni enlaces extranjeros en el bloque.
- MDE-002: el título/contexto de VE representa ciudades y cargos; el cargo
  conserva su ruta /ve y no se presenta como una ciudad.
- MDE-003: enlaces visibles y accionables a 390/1440 px, también si home-stats
  devuelve 503 y con Por cargo seleccionado. Preserva enlaces piloto.
- MDE-004: cinco destinos existentes devuelven 200 con canonical propio,
  inventario positivo y país correcto; HTML útil y conservado después de React.
- MDE-005: sin nuevas consultas, rutas, metadata principal o configuración.
  Conservar títulos/H1/canonical/hreflang/robots/schema y caché del dashboard.
- MDE-006: lint, tipos, unitarias, baseline/integración aislados y CI pasan;
  despliegue y salud comprobados. Indexación/ranking se observan por separado
  a 7/14/28 días; publicar enlaces no acredita crecimiento.
