# Identidad de ofertas oficiales en listados públicos

## Requisito: conservar puestos distintos del portal

Una lectura pública DEBE conservar dos proyecciones oficiales vigentes de la misma empresa, título y ubicación cuando el portal entrega descripciones diferentes. El ID y el enlace de cada una permanecen estables.

### Escenario: dos requisiciones distintas

Dos IDs oficiales tienen el mismo título y ciudad, pero textos de funciones distintos. El listado devuelve dos tarjetas y ambos detalles resuelven por su propio ID.

## Requisito: evitar republicaciones idénticas

Una lectura pública DEBE mostrar una tarjeta cuando dos IDs oficiales vigentes de la misma empresa, título y ubicación tienen exactamente el mismo texto de descripción. Ambos registros permanecen en `direct_jobs` y sus URLs de detalle siguen resolviendo. Si falta descripción, cada ID conserva su propia tarjeta para evitar una fusión sin evidencia.

## Requisito: preservar las bolsas y las protecciones de rendimiento

La identidad visible de filas que no son proyecciones oficiales DEBE seguir usando sus claves actuales. La consulta debe mantener paginación SQL, caché acotado, warmup CO/VE y el tiempo de entrada comparable al runbook. Un cambio de identidad no escribe ni altera fechas, fuentes, cierres, postulación o código SEO.
