# Requisitos observables — baseline de descubrimiento sin marca

## NBB-001 — Ventanas reproducibles

El informe DEBE indicar propiedad, canal de búsqueda, fechas, país y fuente.
Escenario: 34 clics de 28 días y 127 de 90 días permanecen separados; no se
presentan como incremento de tráfico ni como dos períodos comparables.

## NBB-002 — Consulta asociada a URL real

La matriz DEBE diferenciar páginas individuales y categorías permanentes.
Escenario: empleo puerto ordaz apunta al detalle observado; no se asignan sus
clics a una categoría futura. empleos cucuta apunta a la categoría comprobada.

## NBB-003 — Inventario sin inferencias

La matriz DEBE identificar conteos visibles y la proyección consultada.
Escenario: 187 vacantes visibles en Cúcuta no se describen como 187 vacantes
aptas/indexadas. Una descripción omitida de la proyección no significa que
la vacante de detalle carezca de descripción.

## NBB-004 — Indexación separada de disponibilidad

La matriz DEBE distinguir HTTP, estado almacenado y prueba viva.
Escenario: Bogotá puede devolver 200 y pasar la prueba viva mientras Google
informa Descubierta: actualmente sin indexar. No se marca indexada por ello.

## NBB-005 — Selección acotada y justificada

El piloto DEBE justificar prioridad, objetivo y reservas, sin generar URLs
por cada sinónimo. Escenario: Cúcuta/Caracas compiten por captación y Bogotá
se sigue como recuperación; Manizales queda reserva, no fallo ocultado.

## NBB-006 — Operación sin escrituras en producción

La entrega NO DEBE cambiar código, BD, cuentas, configuración ni enviar
solicitudes de indexación. Escenario: obtiene agregados anónimos y reportes
existentes; registra resultados sin disparar altas o postulaciones de prueba.
