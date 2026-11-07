# Tareas — seo-intent-wave2

Las pruebas que fallan van antes del código. Reloj fijo en todas las
pruebas nuevas.

## 0. Decisión y contrato

- [x] Leer `seo-intent-pages` (proposal, design, spec, validation), ADR
      0012 y `docs/SEO-GROWTH-ROADMAP-2026-11.md` §3–4.
- [x] Confirmar que Ciudad Guayana no está en las mediciones abiertas
      hasta el 2026-11-26 (design D6).
- [x] Fijar la regla de decisión D2 antes del conteo.
- [ ] Enmienda al ADR 0012: intenciones de jornada, países por intención y
      alias de ubicación.

## 1. Conteo previo (solo lectura, antes de escribir código)

- [x] `scripts/count-intent-wave2.ts`: `BEGIN READ ONLY`, statement
      timeout de 60 s y `ROLLBACK`.
- [ ] El propietario lo corre desde el checkout con `.env`.
- [ ] Registrar los conteos y las muestras en `validation.md` y aplicar D2:
      qué intenciones y qué países entran, y con qué variante del
      clasificador.

## 2. Clasificador de jornada

- [ ] Pruebas rojas de SIW-010 a SIW-013 con un fixture compartido.
- [ ] `src/lib/job-schedule.ts` (memoria y SQL) y el filtro `schedule`.

## 3. Resolución, países y tipo exhaustivo

- [ ] Pruebas rojas de SIW-001, SIW-002, SIW-012 y SIW-020 a SIW-022.
- [ ] `IntentId`, `INTENT_COUNTRIES`, `CITY_INTENTS` y `switch`
      exhaustivos en filtros, meta, etiquetas y respuesta.

## 4. Guarda, sitemap, enlaces, keeper y caché

- [ ] Pruebas rojas de SIW-030 a SIW-034.
- [ ] Sitemap con conteos conocidos y `intentPageCache` dimensionada.

## 5. Contenido

- [ ] Pruebas rojas de SIW-040 y SIW-041.
- [ ] Copia D4 en el SSR y en `CategoryLanding`.

## 6. Ciudad Guayana

- [ ] Pruebas rojas de SIW-050 a SIW-053.
- [ ] Alias en `cityHubFilters` y `hubMatcher`, title/H1/meta y bandera.

## 7. Rendimiento y no regresión

- [ ] Benchmark SIW-062 con 3.000 filas.
- [ ] Drift SIW-060 frente a `origin/main`.
- [ ] TTFB en frío SIW-061.
- [ ] `tsc`, build, `test:unit`, `test:seo`, `test:dashboard-filters`,
      `test:companies-search`. ESLint de `src/server.ts` sin errores
      (incluye quitar la importación sin uso de `resolveCategorySlug` que ya
      venía de `main`).

## 8. Publicación (cada paso con aprobación)

- [ ] PR con los conteos, el benchmark y el drift. Merge solo con
      aprobación.
- [ ] Tras desplegar: drift y TTFB en producción, memoria en Render,
      inspección en GSC y Bing, envío por IndexNow.
- [ ] Checkpoints en GSC a +14 y +28 días.
- [ ] Archivar el cambio en `changes/archive/`.
