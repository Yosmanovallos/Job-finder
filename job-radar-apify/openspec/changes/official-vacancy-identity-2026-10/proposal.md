# Identidad visible de vacantes oficiales

## Problema

La consulta pública agrupa por título, empresa y ubicación. En Altipal se guardaron 50 IDs oficiales vigentes, pero solo 40 tarjetas resultaron visibles. La lectura pública puede esconder requisiciones distintas del mismo cargo y ciudad. Mostrar los 50 IDs sin otro criterio también repetiría republicaciones textualmente iguales.

## Alcance de esta fase

Añadir una clave de instancia solo a la lectura canónica: una vacante oficial con descripción se agrupa con otra de la misma empresa, título y ubicación únicamente cuando comparten el texto; sin descripción, conserva su ID. Las filas de bolsas mantienen su agrupación actual. La lectura de detalle acepta los IDs de proyecciones oficiales activas para que las nuevas tarjetas abran su vacante. Las filas, IDs, enlaces, fechas, cierres, proyección materializada, caché, sitemap y metadatos SEO no se modifican.

## Verificación y salida

- Integración: dos textos oficiales diferentes bajo el mismo título y ciudad siguen visibles; una republicación idéntica ocupa una tarjeta; sus IDs siguen resolviendo detalle.
- Unitarias: la clave de bolsas queda vacía y la de oficiales utiliza el texto o su ID.
- TypeScript, lint dirigido, build, unitarias y CI pasan. Los fallos preexistentes se reportan aparte.
- Canario de solo lectura en el runner contra producción: contar Altipal y medir primeras páginas CO y VE antes de integrar. Comparar `/dashboard` en un MISS y desde proceso frío tras desplegar con el runbook; revertir si aparece una regresión material.

## Siguiente fase, separada

Auditar el emparejamiento de copias de bolsas y decidir el alcance de autoridad de cada tablero antes de ampliar el descubrimiento de empresas. No se atribuye un portal por similitud de nombre ni se altera SEO en esta fase.
