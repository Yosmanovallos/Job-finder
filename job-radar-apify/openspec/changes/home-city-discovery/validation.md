# Validación — 2026-10-27

Base `c724483735ba32fc7baa777acba8fa4cc09b3c27`. Rama
`codex/home-city-discovery`. Solo enlaces estáticos por país compartidos por
HTML, Markdown y React. No se modifica server.ts, consultas, caché, warmup,
metadatos, autenticación, presupuesto o despliegue.

## Resultados

- Prueba roja: HCD-001 falla antes de implementar por enlace a Bogotá ausente.
- `npm run test:unit`: pasa, 39 suites offline con TCP bloqueado.
- `npx tsc --noEmit --pretty false`: pasa antes y después.
- ESLint de los cinco archivos TypeScript del cambio: pasa.
- ESLint global: falla con exactamente los mismos 24 errores y mensajes
  antes/después, en cuatro archivos ajenos al cambio: driver.mjs (17),
  docs/seo-baseline/inventory-queries.mjs (3), inventory-queue-queries.mjs (3)
  y src/sources/types.ts (1). No se suprimen ni se declaran resueltos.
- `npm run test:baseline`: pasa, 13 rutas a 1440 y 390 px, PostgreSQL
  desechable. Enlaces SSR y Markdown, destinos 200 con canonical propio,
  bloque React visible, home-stats 503 y pestaña móvil Por cargo. Los enlaces
  pasan clic de prueba y las capturas centradas se revisaron visualmente.
- `git diff --check`: pasa.
- Primera integración: falla una página Workana con 500 durante un rebuild
  concurrente del baseline. `npm run test:job-seo` repetido solo pasa completo.
  No se atribuye el fallo a producción ni se oculta el intento fallido.
  Repetición de integración completa pasa (18 suites), sin build concurrente.

Evidencia local en el directorio temporal del SO, no contiene datos reales:

- Unit: `job-radar-test-9dbace26597cae32cf34638707f14327-l7fAnl/results.json`.
- Baseline final: `job-radar-test-9fea28fc03de12d5fbe28b00e6ad5fea-nrBrx0/results.json`.
- Integración inicial: `job-radar-test-08b7540c538b015bbf81eef615d2dc73-i3xC0n/results.json`.
- Job SEO solo: `job-radar-test-14d8d37f64a367b2c11f002df0fddb44-eScrKZ/results.json`.
- Integración final: `job-radar-test-7242815d5f0f88383482e4d4d524e5ea-f7PCHP/results.json`.

## Gate de publicación

Fase activa: no archivar ni declarar completa mientras fallen gates globales.
La autorización del usuario para desplegar sigue vigente; no sustituye la
verificación exigida por AGENTS.md. Pendientes: PR, resolver lint global y
verificar producción tras despliegue. Rollback por
revert del commit; no hay migraciones o escrituras de datos que deshacer.
No hay evidencia nueva de indexación, posiciones o crecimiento causada por
esta implementación local.
