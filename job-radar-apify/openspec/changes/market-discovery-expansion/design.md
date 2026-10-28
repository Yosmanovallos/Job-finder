# Diseño

El helper existente home-city-discovery conserva su interfaz interna y añade
cuatro destinos CO y el cargo ingeniero civil VE. Lo consumen getHomeContent
(HTML inicial/Markdown) y HomeLanding (React), sin cambios adicionales en esos
consumidores. El bloque VE cambia su título/contexto a ciudades y cargos;
el bloque CO conserva el contexto de ciudades. Cada llamada retorna datos
estáticos propios, sin conteos, I/O o consultas.

CO conserva Bogotá/Cúcuta y añade Armenia/Neiva/Ibagué/Popayán. VE conserva
Caracas y añade /ve/empleos/ingeniero-civil. Ningún destino se cambia a una
URL nueva o a otra intención. Nada de remoto VE, alias Puerto Ordaz o nuevos
cargos del scheduler en esta entrega.

Se amplían pruebas de contenido HTML/Markdown y baseline HTTP/DOM. El fixture
local aislado contiene vacantes explícitamente sintéticas para los cinco
destinos, y baseline captura esas rutas, comprueba país/canonical/contenido y
mantiene navegación visible/pulsable aunque falle home-stats o se cambie el tab
móvil a Por cargo. No fixture ni build sintético se publica en producción.

No se modifica server.ts, consultas, filtros, cachés, warmup, metadata de
home/destinos, servicios Render o contratos públicos. Rollback por revert del
merge. Inspección almacenada e inventario real previos quedan en validation.md;
ninguna solicitud masiva de indexación o test de base real es parte del cambio.
