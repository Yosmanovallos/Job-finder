# Ampliación de descubrimiento — lote siguiente

Estado: en implementación, 2026-10-28. Deriva del mapa seo-market-coverage
del PR #69. Base inicial bbc93c8, actualizada a origin/main e678a09 antes de publicar.
Solo esta fase: ampliar descubrimiento
de cinco páginas existentes, preservando el piloto y sus metadatos.

Ampliar enlaces útiles desde el inicio a categorías existentes: Armenia,
Neiva, Ibagué y Popayán para Colombia; ingeniero civil para Venezuela. Mantener
Bogotá/Cúcuta/Caracas y la separación de país. Cubrir naturalmente sinónimos
de empleo/trabajo/vacantes en una única página por intención, sin duplicar URLs.

Primera revisión de implementación: helper compartido de descubrimiento,
getHomeContent, bloque visible de HomeLanding y sus pruebas de HTML/Markdown/
DOM. Si se mezclan cargos y ciudades, el encabezado y descripción deben
representar ambos; no llamar «ciudad» a ingeniero civil. Sin nuevas consultas,
rutas, conteos, cambios de caché/warmup o afirmaciones de indexación.

Antes de editar: inspección almacenada de las cinco URLs y confirmar
inventario/canonical/país. Gates y despliegue según el plan. Observar 7/14/28
días; rollback por revert. Excluye remoto VE, alias Puerto Ordaz y cargos
nuevos: requieren resolver los hallazgos correspondientes antes de promocionarlos.
