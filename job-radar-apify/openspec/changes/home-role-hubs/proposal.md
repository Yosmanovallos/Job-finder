# Enlaces del home a los hubs de cargo con impresiones

Fecha: 2026-10-29, base `origin/main` 251f3ef, rama `codex/home-role-hubs`.
Cierra el hueco abierto que dejó `city-hub-stats`: la línea base de GSC solo
detallaba las ciudades.

Fuente: Search Console → Rendimiento, propiedad `sc-domain:buscotrabajo.co`,
90 días (28/7 → 27/10/2026), páginas que contienen `/empleos/`, ordenadas por
clics e impresiones. Se leyeron las 250 primeras de 712 filas, que llegan a 3
impresiones por URL. Solo lectura.

Hubs de cargo con impresiones (clics / impresiones):

| URL | Clics | Impr. |
|---|---:|---:|
| /ve/empleos/ingeniero-civil | 1 | 48 |
| /empleos/ingeniero-civil | 0 | 31 |
| /ve/empleos/analista-juridico | 0 | 28 |
| /ve/empleos/ingeniero-ambiental | 0 | 26 |
| /ve/empleos/analista-de-logistica | 0 | 26 |
| /empleos/analista-juridico | 0 | 23 |
| /ve/empleos/desarrollador-frontend | 0 | 21 |
| /empleos/ingeniero-industrial | 0 | 19 |
| /empleos/community-manager | 0 | 18 |
| /empleos/analista-de-logistica | 0 | 17 |
| /empleos/especialista-en-marketing-digital | 0 | 15 |
| /ve/empleos/ingeniero-industrial | 0 | 13 |
| /empleos/desarrollador-full-stack | 0 | 8 |
| /empleos/ingeniero-devops | 1 | 6 |
| /empleos/ux-designer | 1 | 5 |
| /empleos/desarrollador-mobile | 0 | 5 |

Ciudad que faltaba: /empleos/maracaibo, 0 clics y 16 impresiones.

Entrega:
- `getHomeCityDiscovery` añade los 6 cargos con más impresiones por país (≥ 13).
  En CO son ingeniero civil, analista jurídico, ingeniero industrial, community
  manager, analista de logística y especialista en marketing digital. En VE son
  ingeniero civil, analista jurídico, ingeniero ambiental, analista de
  logística, desarrollador frontend e ingeniero industrial. VE añade también
  Maracaibo.
- El encabezado de Colombia pasa a "Ciudades y cargos destacados", como el de
  Venezuela.
- Todas las URL se comprobaron en producción: responden 200, son de catálogo y
  tienen vacantes (p. ej. analista jurídico CO 219, Maracaibo 223).

Sin consultas, sin datos dinámicos y sin cambios de diseño: es la misma lista
estática que ya alimenta el HTML inicial, la navegación React y el Markdown de `/`.
