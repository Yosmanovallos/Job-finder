# Baseline y decisión del piloto — 2026-10-27

Entrega documental de investigación; todavía no implementa cambios de páginas.
Fuentes: Search Console autenticado (Web) y respuestas HTTP públicas anónimas.

## Base de métricas

| Ventana global | Clics | Impresiones mostradas | CTR | Posición media |
|---|---:|---|---|---|
| 27-Sep..24-Oct (28 días) | 34 | 1,68 mil, redondeado | 2% | 11,1 |
| 27-Jul..24-Oct (90 días) | 127 | 4,4 mil, redondeado | 2,9% | 12,4 |

No son dos períodos equivalentes para calcular crecimiento. En 28 días la
consulta exacta busco trabajo tuvo 0 clics/1 impresión/posición79; el período
no demuestra el efecto de cambios posteriores al 24-Oct.

Histórico de 90 días, filtros por país: Colombia97 clics/2922 impresiones;
Venezuela18/582. Dispositivos globales: móvil66/2104, ordenador61/2284,
tablet0/14. No mezclar atribución del país de la página con el país del buscador.

Consultas visibles de Colombia (90 días): buscotrabajo19/65; trabajo topografo3/8;
empleo topografo2/6; busco trabajo.com2/4 (ambigua); buscador de empleo1/17;
empleo armenia1/16; trabajo redactor1/7; ingeniero electronico empleo1/7;
trabajo community manager1/5; empleo en soacha1/4. Valores clics/impresiones.

Venezuela (90 días): buscotrabajo2/17; empleo puerto ordaz2/9; empleos puerto
ordaz1/24; empleos en puerto ordaz1/15; empleo san francisco1/4; trabajo en
caracas1/3; trabajo para ingeniero civil1/1; safetyguard 0202 c.a0/27;
trabajos en caracas0/18; empleos caracas0/17. Las variantes sin URL asociada
comprobada son candidatas para investigación, no páginas nuevas aprobadas.

## Cruce consulta → página (28 días, alcance global)

| Consulta exacta | Clics / impresiones de propiedad | Página observada | Lectura |
|---|---|---|---|
| empleos cucuta | 1 / 2 | /empleos/cucuta, fila de página1/2 | Categoría ya recibe demanda. |
| trabajos en caracas | 0 / 16 | /empleos/caracas, fila0/16 | Hay exposición de categoría, sin clics en esa consulta. |
| empleos manizales | 0 / 13 | /empleos/751728a7-fd3d-41ea-8925-314529135f92/operario-de-planta-manizales-manizales con UTM, fila0/13 | La señal es de un detalle, no de la categoría. |
| empleo puerto ordaz | 2 / 9 | /empleos/aafabedd-7b57-4b90-a554-1c921ca76965/asistente-comercial-puerto-ordaz-bolivar-state-venezuela, fila2/13 | Señal de un detalle; no justifica atribuir clics a una categoría nueva. |

Las métricas propiedad/página de GSC pueden diferir por agregación; conservar
ambas en Puerto Ordaz, sin forzar que sus impresiones sean iguales. No sumar
consultas visibles para inventar el total de marca/sin marca. UTM no implica
por sí sola canonical incorrecto: no se inspeccionó ese detalle aquí.

## Inventario y estado del índice

Inventario observado 27-Oct 17:16 Bogota, agregado SSR. Detalle en inventory.json.
Todas las URLs de la tabla devolvieron 200, canonical propio y sin noindex
explícito en ese HTML. Esas tres condiciones no prueban inclusión en Google.

| Página | País destino | Inventario visible | Inspección almacenada del 27-Oct | Decisión |
|---|---|---:|---|---|
| / | CO | No medido en inicio | Está en Google | Control de marca/nacional y origen de enlaces. |
| /empleos/cucuta | CO | 187 | Indexada; canonical Google = URL inspeccionada; rastreo11-Oct08:14:28 | Piloto de captación CO. |
| /empleos/caracas | VE | 940 | Indexada; canonical Google = URL inspeccionada; rastreo25-Sep03:45:46 | Piloto de captación VE. |
| /empleos/bogota | CO | 10890 | Descubierta, actualmente sin indexar; último rastreo N/D | Piloto de recuperación, no de CTR todavía. |
| /empleos/manizales | CO | 226 | Descubierta, actualmente sin indexar; último rastreo N/D | Reserva hasta observar recuperación del lote inicial. |

Prueba viva de Bogotá, 27-Oct17:18: disponible para Google, se puede indexar,
un breadcrumb válido. No se pidió indexación. Las cinco inspecciones almacenadas
y esta única prueba viva constituyen el lote; no se hicieron pruebas masivas.

## Hallazgo de descubrimiento y cambio siguiente

En el HTML inicial del inicio se encontraron cuatro href: /dashboard, /docs,
/llms.txt y /sitemap.xml; cero enlaces directos a categorías de ciudad.
Las cuatro categorías sí enlazan ciudades hermanas y 60 detalles. Esto analiza
HTML inicial, no demuestra ausencia total de enlaces tras ejecutar JavaScript.

Prioridad siguiente: incorporar un bloque pequeño de enlaces HTML rastreables
y útiles hacia categorías piloto, respetando el diseño actual, y comprobar
que persisten en DOM móvil. Inicio CO enlaza ciudades CO; acceso a Venezuela
se contextualiza por país, sin prometer a quien busca Colombia ofertas de VE.
Verificar también /ve antes de implementar su bloque; no fue auditada para
enlaces en esta entrega. Conservar canonicals y evitar nuevas páginas clonadas.

Decisión: Cúcuta y Caracas para captación; Bogotá para recuperación. No abrir
Puerto Ordaz aún: no apareció categoría propia en el sitemap consultado;
evaluar primero la categoría existente Ciudad Guayana y la semántica geográfica
con datos reales. No se afirma que ninguna otra ruta Puerto Ordaz pueda existir.

## Criterios de aceptación del cambio posterior

Enlaces visibles y HTML, país correcto, destinos 200 y canonical coherente,
sin aumento de consultas/coste de arranque por simples enlaces; pruebas de
regresión SSR/DOM, metadata, móvil y gates generales. Si se toca dashboard,
queries/cache o arranque, aplicar el runbook de proceso frío y edge MISS.
No atribuir la recuperación a un cambio hasta disponer de observación suficiente.

Registrar después: fecha de despliegue, indexación de Bogotá/Manizales, métricas
de consultas/páginas del piloto y conversiones agregadas a 7/14/28 días. No
ampliar el lote por el solo hecho de tener muchas vacantes ni prometer top3.

## Validación y límites

NBB-001..006 trazados con tablas, inspecciones e inventory.json. Esta entrega
no ejecutó build, lint, typecheck o unitarias porque no modifica código; no
los declara aprobados ni cierra los gates históricos o la fase de crecimiento.
La implementación del piloto y su validación siguen pendientes.
