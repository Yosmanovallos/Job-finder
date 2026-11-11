# Tareas — seo-empleos-coverage

Archivos que se tocan: `src/lib/job-seo.ts`, `src/lib/intent-pages.ts`,
`src/lib/empleos-index.ts` (nuevo), `src/server.ts`,
`src/sections/EmpleosIndex.tsx` (nuevo), `src/App.tsx`, `tests/validate-empleos-coverage.test.ts` (nuevo),
`tests/validate-intent-pages.ts`, `tests/validate-seo-job-pages.ts`,
`scripts/run-isolated-tests.ts`,
`docs/adr/0014-empleos-index-and-guarded-city-hubs.md` (nuevo),
`docs/SEO-IMPROVEMENT-PLAN.md`, `docs/SEO-GROWTH-ROADMAP-2026-11.md`.
`llms.txt` y el catálogo de agentes no listan páginas de `/empleos`, así
que no cambian.

No se tocan: `src/lib/job-filters.ts` (`CITY_OPTIONS`),
`src/countries/index.ts`, `src/queue/scheduler.ts`, páginas de vacante.

## 0. Antes del código

- [x] Inventario y demanda medidos (proposal.md, 2026-11-10)
- [ ] Decisión del propietario: Soacha y Rionegro; profesiones en otro cambio
- [ ] Baseline `/seo drift` de portada, `/dashboard`, `/empleos/bogota`,
      `/empleos/caracas`, `/empleos/remoto` y 2 vacantes

## 1. Pruebas que fallan primero

- [x] SEC-001..004 resolución y colisiones de slugs (unit)
- [x] SEC-010..013 guarda: robots, sitemap y enlaces con total 9, 10 y
      desconocido (unit; HTTP en `validate-intent-pages.ts`)
- [x] SEC-020..026 `/empleos` y `/ve/empleos`: meta, canonical, hreflang,
      secciones, JSON-LD, 301 de la barra final, fallo de datos
- [x] SEC-030 los hubs existentes y las vacantes no cambian
- [x] SEC-040 bandera de rollback

## 2. Implementación

- [x] `GUARDED_CITY_HUBS`, `isGuardedCityHub`, resolución
- [x] Filtros, caché y keeper de los hubs con guarda
- [x] `empleos-index.ts`: meta, secciones, JSON-LD (puro, compartido)
- [x] Rutas del servidor y `/api/empleos-index`
- [x] `EmpleosIndex.tsx` y rutas en `App.tsx`
- [x] Sitemap
- [x] ADR 0014

## 3. Validación

- [x] `npx tsc --noEmit`, `npm run build`, `npm run test:unit` (2026-11-10)
- [ ] `npm run test:seo`, `test:agent-readiness`, `test:baseline` (CI si
      Docker local falla)
- [ ] Benchmark de intención ampliado: RSS y ms por petición
- [ ] `/seo drift compare`: sin diferencias en las URL de base
- [ ] EXPLAIN en producción de una consulta de hub con guarda

## 4. Publicación (cada paso con aprobación explícita)

- [ ] PR, revisión y merge
- [ ] Verificar en producción: 14 URL, robots, sitemap, TTFB, memoria
- [ ] IndexNow de las URL nuevas indexables
- [ ] Actualizar la tabla de `SEO-IMPROVEMENT-PLAN.md` y el roadmap
- [ ] Checkpoints en GSC a +14 y +28 días
