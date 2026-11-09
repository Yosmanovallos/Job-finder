# Tareas

- [x] Leer `DASHBOARD-PERFORMANCE-RUNBOOK.md`: sin consultas nuevas, misma clave de caché.
- [x] Ampliar `CategoryInsights` y añadir `buildCategoryStatsCopy` (SSR = React).
- [x] Mapear los números de salario en `queryJobsPage` y ocultarlos en `maskLockedFields`.
- [x] Meta descripción de ciudad orientada a consultas reales, ≤ 160 caracteres.
- [x] Enlaces del home a los hubs con impresiones (`home-city-discovery.ts`).
- [x] Pruebas: `validate-city-hub-stats.test.ts` (unit), baseline con hub sintético de Santa Marta.
- [x] Desplegar con aprobación y medir el MISS en frío de `/empleos/santa-marta` frente al runbook (ver validation.md).
- [ ] Checkpoints de posición en GSC a +14 y +28 días para Caracas, Santa Marta, Neiva, Ibagué y Armenia.

> **Nota 2026-11-07 (`seo-intent-wave2`, sin desplegar):** cuando se despliegue,
> los hubs de CO (Santa Marta, Neiva, Ibagué y Armenia incluidos) ganarán hasta
> 3 enlaces «Búsquedas populares» nuevos (fines de semana, medio tiempo,
> temporada), solo si esas páginas son indexables. Caracas no gana ninguno. El
> título, la meta y las cifras no cambian. Tenerlo en cuenta en las lecturas
> del 2026-11-12 y el 2026-11-26.
