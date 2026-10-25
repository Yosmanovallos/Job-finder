# C1 — censo de Computrabajo Colombia

- [x] Inspeccionar la fuente primaria y deduplicada, la asociación de alias y el flujo de portales oficiales.
- [x] Implementar el censo de solo lectura y su modo manual en Actions.
- [x] Pasar lint de los archivos modificados, TypeScript, build, unitarias e integración aislada (CI; Docker local no disponible).
- [x] Ejecutar el censo en producción y registrar empresas y vacantes pendientes.
- [ ] Revisar las 11 empresas con dominio curado y separar portales propios de páginas alojadas por Computrabajo.
- [ ] Concentrar el descubrimiento programado en empresas de Computrabajo Colombia, conservando el modo manual de todas las fuentes; verificar en CI y con una corrida acotada.
- [ ] Incorporar Cemex desde `jobs.cemex.com` tras canario completo de 5 vacantes colombianas; usar seed dirigido con revisión previa de conflictos y comprobar el tick.
