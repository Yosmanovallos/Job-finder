# Diseño

Base origin/main c724483. getHomeCityDiscovery entrega copia de un bloque de
texto/enlaces estáticos por país. Sin imports de DB, acceso a red o conteos.
getHomeContent incorpora el bloque a sus secciones, por lo que los renderers
existentes lo sirven en HTML y Markdown sin tocar server.ts ni negociación.
HomeLanding usa la misma fuente en Explore, fuera de los paneles ciudad/cargo
para que permanezca disponible también al cambiar la pestaña en móvil.

Se reutilizan rutas existentes y el estilo tipográfico actual. Sin cambios
al hero/LCP, consultas home-stats, tarjetas previas, cache, warmup, servicios,
presupuesto ni metadatos. No toca estándares ni digests de Agent Skills.
Rollback por revert del commit; no hay migraciones o datos que revertir.

Pruebas: unidad HTML/Markdown y destinos reales por país; baseline HTTP real
con PostgreSQL desechable, vistas móvil/escritorio, API home-stats bloqueada,
tab cargo seleccionada, enlaces visibles/navegables y metadata estable.
