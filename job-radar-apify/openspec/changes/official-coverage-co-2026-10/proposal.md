# Cobertura de empresas oficiales de Colombia — descubrimiento continuo

**Base:** `origin/main` en `5de8eac`. **Alcance de esta fase:** elegibilidad y ejecución fiable del descubrimiento de portales oficiales para empresas con vacantes visibles en Colombia. Los conectores, SEO y presentación pública quedan fuera.

## Evidencia

El reporte de solo lectura del 25 de octubre de 2026 (`Direct Employers Tick`, corrida `40213133749`) cuenta 9.705 empresas candidatas, 29.259 filas visibles, 2.162 empresas sondeadas y 114 con tablero oficial identificado. Hay 7.543 pendientes (8.809 filas). El script usaba `--min-count` implícito de 3, excluyendo a empresas con una o dos vacantes. El workflow compartía grupo de concurrencia entre el tick y un descubrimiento diario; no aparecieron corridas programadas de descubrimiento en los últimos tres días revisados.

## Decisión

- Toda empresa con al menos una vacante visible entra en la cola de descubrimiento.
- El descubrimiento tiene workflow y grupo de concurrencia propios, con tres horarios diarios, plazo de 12 minutos, máximo de 1.000 candidatos seleccionados y 10 tableros habilitados por corrida.
- El modo manual predeterminado es `dry-run`; la ejecución con escrituras es explícita. La automatización programada mantiene la promoción insert-only existente.
- La meta del 100 % significa **candidatos sondeados y clasificados con evidencia**. La proporción con vacantes oficiales se informa aparte: no toda empresa posee un portal público o permite su lectura.

## Salida de la fase

CI aislada y pruebas locales verdes; una corrida programada o manual de descubrimiento exitosa; reporte de cobertura posterior que muestre progreso del grupo pendiente y la capacidad del tick. No afirmar 100 % hasta que el denominador vivo se haya procesado y los casos de error/revisión estén resueltos.
