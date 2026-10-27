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
- Corrección de la medición anterior: los 24 errores se obtuvieron usando la
  configuración de otro checkout. Con dependencias instaladas y eslint.config.js
  de esta rama, solo había un error real: any en el índice abierto de Job.
  Se reemplaza por seis propiedades opcionales existentes, sin cambio runtime.
  `pnpm lint` global pasa, sin supresiones. Typecheck del app vuelve a pasar.
- `pnpm typecheck` pasa; `pnpm test`: 214 pruebas pasan, 8 de integración
  del monorepo se omiten por su configuración habitual (no se cuentan como pasadas).
- `npm run test:job-render`: 10 pruebas pasan, incluido el caso adversarial
  que excluye campos privados del snapshot y el cliente con API bloqueada.
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

Repetición tras corregir tipos y usar la configuración real del repo: todos pasan.

- Unit 39 suites: `job-radar-test-f9a00813ff9cbb1424cd4add9b5cdae2-AvJgdC/results.json`.
- Job-render 10 pruebas: `job-radar-test-36c05a8be1a5808c7b8ed84ffaaad231-GeReiS/results.json`.
- Baseline 13 rutas: `job-radar-test-ad4c69de15cacdbb98662cead5c03fea-CKnmi2/results.json`.
- Integración 18 suites: `job-radar-test-9304de89705e299f35b295a673313bed-eT664e/results.json`.

## Publicación y cierre

PR #66 fusionado en `3c8608222aaef79ba0b850f362183a22fa739915`.
CI [40597108930](https://github.com/Yosmanovallos/Job-finder/actions/runs/40597108930)
pasa completo (job-render, unit, job-seo, baseline, integration).
Render confirma este commit como Last successfully deployed commit en
el servicio existente Starter, sin cambios de plan o configuración.

Verificación pública 2026-10-27: `/`, `/ve`, Bogotá, Cúcuta, Caracas,
Manizales, cargo project-manager VE, ambos dashboards y login responden 200.
`/api/health` 200 y `/api/me` 401 sin sesión. Los dos inicios incluyen los
destinos esperados en HTML y Markdown con Vary Accept, Accept-Encoding.
Navegación real del navegador a Cúcuta y Caracas confirmada por URL y H1.
Comparación antes/después: sin cambios en title, H1, canonical, robots,
hreflang o tipos de schema en las diez páginas inspeccionadas.

Dashboard con URL única y Cloudflare MISS: CO 221 ms, VE 240 ms en este
muestreo posterior. No se cambian consultas/cachés/arranque. Bogotá respondió
200 en 3758 ms con MISS: anotación de latencia de primera carga para investigar
en otra entrega, no evidencia de regresión atribuible a estos enlaces.

Evidencia HTTP pública en OS temp: home-city-pre.json, home-city-post.json y
home-city-post-comparison.json. Fase completada y archivada con gates verdes.
Rollback: revertir el merge del PR #66; sin migraciones o datos que deshacer.
La entrega prueba descubrimiento y navegación, no una mejora de indexación,
posiciones o crecimiento. Siguiente fase: ampliar cobertura por ciudad/cargo
según vacantes reales y demanda medida; no implementada en esta entrega.
