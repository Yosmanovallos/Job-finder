# C1 — censo de Computrabajo Colombia

- [x] Inspeccionar la fuente primaria y deduplicada, la asociación de alias y el flujo de portales oficiales.
- [x] Implementar el censo de solo lectura y su modo manual en Actions.
- [x] Pasar lint de los archivos modificados, TypeScript, build, unitarias e integración aislada (CI; Docker local no disponible).
- [x] Ejecutar el censo en producción y registrar empresas y vacantes pendientes.
- [ ] Revisar las 11 empresas con dominio curado y separar portales propios de páginas alojadas por Computrabajo.
- [x] Concentrar el descubrimiento programado en empresas de Computrabajo Colombia, conservando el modo manual de todas las fuentes; verificar en CI y con una [corrida acotada](https://github.com/Yosmanovallos/Job-finder/actions/runs/40235688825).
- [x] Incorporar Cemex desde `jobs.cemex.com` tras canario completo de 5 vacantes colombianas; usar seed dirigido con revisión previa de conflictos y comprobar el [tick](https://github.com/Yosmanovallos/Job-finder/actions/runs/40239337651).
- [x] Incorporar TP Colombia desde el listado oficial de `tp.com`: conector paginado, canario completo, [seed sin conflictos](https://github.com/Yosmanovallos/Job-finder/actions/runs/40257036353) y [tick de producción](https://github.com/Yosmanovallos/Job-finder/actions/runs/40257107820).
- [x] Exportar el censo completo como JSONL desde un modo manual de solo lectura, con estado de revisión humana separado del sondeo ATS automatizado.
- [ ] Incorporar Frisby desde su [portal corporativo](../../../docs/source-catalog/frisby.md) solo si permite acceso al runner o facilita un feed autorizado. Canario local 91/91; [canario del runner](https://github.com/Yosmanovallos/Job-finder/actions/runs/40521001805) HTTP 403; tablero deshabilitado.
- [ ] Habilitar NEXA BPO desde Workeando solo si el portal concede acceso desde el runner; el [403 comprobado](../../../docs/source-catalog/workeando-nexa.md) mantiene el tablero deshabilitado. La fuente solo atribuye ofertas que mencionan NEXA.
- [ ] Revisar todas las empresas objetivo pendientes; conservar evidencia y clasificación de cada una. El [primer lote](../../../docs/source-catalog/computrabajo-official-batch-2026-10-25.md) documenta cinco casos, ninguno importable todavía.
