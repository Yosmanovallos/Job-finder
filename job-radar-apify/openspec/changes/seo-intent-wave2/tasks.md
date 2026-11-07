# Tareas — seo-intent-wave2

Las pruebas que fallan van antes del código. Reloj fijo en todas las
pruebas nuevas.

## 0. Decisión y contrato

- [x] Leer `seo-intent-pages` (proposal, design, spec, validation), ADR
      0012 y `docs/SEO-GROWTH-ROADMAP-2026-11.md` §3–4.
- [x] Confirmar que Ciudad Guayana no está en las mediciones abiertas
      hasta el 2026-11-26 (design D6).
- [x] Fijar la regla de decisión D2 antes del conteo.
- [x] Enmienda al ADR 0012: intenciones de jornada, países por intención y
      alias de ubicación.

## 1. Conteo previo (solo lectura, antes de escribir código)

- [x] `scripts/count-intent-wave2.ts`: `BEGIN READ ONLY`, statement
      timeout de 60 s y `ROLLBACK`.
- [x] El propietario lo autorizó y se corrió desde el checkout con `.env`.
- [x] Registrar los conteos y las muestras en `validation.md` y aplicar D2:
      qué intenciones y qué países entran, y con qué variante del
      clasificador.

## 2. Clasificador de jornada

- [x] Pruebas rojas de SIW-010 a SIW-013 con un fixture compartido.
- [x] `src/lib/job-schedule.ts` (memoria y SQL) y el filtro `schedule`.

## 3. Resolución, países y tipo exhaustivo

- [x] Pruebas rojas de SIW-001, SIW-002, SIW-012 y SIW-020 a SIW-022.
- [x] `IntentId`, `INTENT_COUNTRIES`, `CITY_INTENTS` y `switch`
      exhaustivos en filtros, meta, etiquetas y respuesta.

## 4. Guarda, sitemap, enlaces, keeper y caché

- [x] Pruebas rojas de SIW-030 a SIW-034.
- [x] Sitemap con conteos conocidos y `intentPageCache` dimensionada.

## 5. Contenido

- [x] Pruebas rojas de SIW-040 y SIW-041.
- [x] Copia D4 en el SSR y en `CategoryLanding`.

## 6. Ciudad Guayana

- [x] Pruebas rojas de SIW-050 a SIW-053.
- [x] Alias en `cityHubFilters`, `hubMatcher` y el respaldo del cliente; title/H1/meta. Sin bandera (design D6, rollback en una línea).

## 7. Rendimiento y no regresión

- [x] Benchmark SIW-062 con 3.000 filas.
- [x] Drift SIW-060 frente a `origin/main`.
- [x] TTFB en frío SIW-061.
- [x] `tsc`, build, `test:unit`, `test:seo`, `test:dashboard-filters`,
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
