# Tareas — adsense-readiness

Una fase por sesión. No se empieza una fase sin cerrar el gate de la
anterior. **No se pulsa «Solicitar revisión» antes de F6.**

## Decisiones previas (propietario)

- [ ] D1 vacantes de terceros: (a) completas sin anuncios / (b) extracto
- [ ] D2 nombre y rol del responsable para «Acerca de»
- [ ] D3 quién revisa y firma las guías
- [ ] D4 correo con dominio propio
- [ ] D5 activar el mensaje de consentimiento (CMP) en AdSense
- [ ] D6 incluir una calculadora antes de la primera solicitud

## F0 — Línea base y auditor

> Diferida (2026-11-14): el propietario pidió empezar por las correcciones.
> F1a se hizo antes de F0; sus reglas quedan cubiertas por
> `validate-adsense-readiness.test.ts`. El auditor sigue siendo requisito
> del gate F6.

- [ ] Pruebas que fallan primero: una por regla de la matriz (ADS-001…)
- [ ] `scripts/adsense-audit.ts` + `npm run adsense:audit` (build sintético)
- [ ] Modo `--live` (solo GET, con límite y pausa; requiere aprobación)
- [ ] Medir: vacantes indexables por procedencia (oficial / terceros)
- [ ] Medir: clics de Google a vacantes de terceros (28 días) → insumo de D1
- [ ] Prueba de paridad HTML inicial ↔ DOM hidratado (SP-1, SP-5)
- [ ] Guardar la línea base en `docs/seo-evidence/` (solo indicadores)
- **Gate:** el auditor reproduce los 26 ✅ / 15 ⚠️ / 9 ❌ de `proposal.md`

## F1 — Confianza, higiene y elegibilidad de anuncios

### F1a — hecho en `codex/adsense-readiness` (2026-11-14)

- [x] Pruebas: `tests/validate-adsense-readiness.test.ts` (ADS-010, ADS-015,
      ADS-018), en la suite `unit`
- [x] Anuncios por marcador del servidor (`src/lib/ad-eligibility.ts`): el
      cargador de `index.html` solo inyecta `adsbygoogle.js` si la página
      trae `<meta name="bt-ads" content="on">`. Marcadas: portada CO/VE,
      `/empleos` y hubs indexables con ≥ 10 vacantes, `/empresas` y empresas
      con ≥ 10, vacante de «Portal oficial» lista para Google. Sin marcador:
      todo lo demás (PP-1…PP-5). gtag.js y la meta de verificación no cambian
- [x] Texto completo en el HTML inicial de `/legal/*`, `/preguntas` y
      `/como-funciona`, desde los mismos módulos que pinta React
      (`legal-content.ts`, `faq-content.ts`, `process-steps.ts`) (TX-1).
      `/fuentes`, `/about` y `/contact` ya lo tenían
- [x] `/privacy` se queda en 200 (contrato de agentes: tests, sitemap,
      `llms.txt`), pero ya no contradice a `/legal/privacidad` sobre pagos
      (CX-5, PG-5). Cambio de diseño respecto al plan: sin 301
- [x] Pie: enlace a Contacto (CX-7)
- [x] `/opiniones` vacía: sin anuncios (no lleva marcador); la invitación a
      opinar se mantiene porque es diseño, no una sección en construcción

### F1b — hecho (2026-11-14)

- [x] `/metodologia` (en `PUBLIC_PAGES`: HTML y Markdown, sitemap, pie,
      enlazada desde «Acerca de» y «Contacto»): fuentes, deduplicación por
      URL normalizada y huella cargo + empresa + ubicación, prioridad del
      portal oficial (ADR 0006), máximo de 30 días (ADR 0005), archivo
      privado de 180 días (ADR 0008), qué no se hace y cómo reportar (AV-5)
- [x] «Reportar esta vacante» en cada vacante → `/opiniones` con la
      categoría nueva «Una oferta parece falsa o pide dinero» (SP-19)
- [x] Sección «Retirar una vacante o reportar una oferta» en `/contact`
      (SP-17). Sin plazo de respuesta publicado: no hay uno comprometido
- [x] Pruebas ADS-020 en `validate-adsense-readiness.test.ts`

### F1c — pendiente de datos del propietario

- [ ] «Acerca de» con responsable real: nombre y rol (D2)
- [ ] Correo con dominio propio (D4)
- [ ] Actualizar `llms.txt`, API Catalog, docs y digests con las rutas reales
- [ ] lint, typecheck, `test:unit`, `test:integration`, `test:baseline`
- [ ] Dashboard en frío y con URL única según el runbook
- **Gate:** PP-1…PP-5, TX-1, CX-5, CX-7, PG-5, SP-17, SP-19 en CUMPLE

## F2 — Superficie copiada

- [ ] Pruebas que fallan primero: ADS-030…ADS-039
- [ ] Procedencia oficial / terceros expuesta a la capa de render
- [ ] Vacante de terceros: sin script de anuncios (ya cubierto por F1) y
      bloques propios visibles en el HTML inicial
- [ ] D1(b) implementada detrás de `THIRD_PARTY_JOB_EXCERPT_ENABLED` (apagada)
- [ ] ADR si se enciende D1(b) (enmienda al contrato JobPosting)
- [ ] Vacante vencida: 404/410 real, sin enlaces entrantes desde hubs (CX-9)
- [ ] «Más empleos en <ciudad>» ordenado por cercanía de cargo (CX-5)
- [ ] `test:seo` y comparación de drift en 2 vacantes de cada procedencia
- **Gate:** CX-4, CX-9, SP-11, SP-12, PP-4 en CUMPLE según la opción de D1

## F3 — Guías

- [ ] Pruebas que fallan primero: ADS-040…ADS-049 (rutas, JSON-LD, autor,
      fuentes obligatorias, sin párrafos repetidos, 404 con el interruptor)
- [ ] `/guias` y `/guias/:slug` renderizadas en el servidor
- [ ] Lista de 12 temas desde el estudio de palabras clave (#121), aprobada
      por el propietario
- [ ] 12 guías: borrador → verificación de cada fuente → dato propio del
      corpus con fecha de corte → revisión y firma (D3)
- [ ] «Guías» en menú y pie; enlaces desde hubs y vacantes
- [ ] Sitemap, `llms.txt` y catálogo actualizados
- [ ] Calendario: 2 guías por semana después de la primera docena
- **Gate:** CX-1, CX-3, AV-4 en CUMPLE; `original_pages` ≥ 20

## F4 — Datos propios

Implementado el 2026-11-15 en `claude/adsense-f4-878771`, PR en borrador
contra `codex/adsense-readiness`. Ver la nota «Implementado» de F4 en
`design.md`: ediciones congeladas en el repositorio, sin consultas desde
ninguna página.

- [x] Pruebas que fallan primero: ADS-050…ADS-059 en
      `tests/validate-market-report.test.ts` (suite `unit`). Se escribieron
      antes del código: el primer commit tenía 050–055 en verde y 056–059 en
      rojo. Integración: `tests/validate-market-report.ts` (suites
      `integration`, `seo` y `market-report`)
- [x] Informe mensual calculado por código (`src/lib/market-report.ts`):
      vacantes por ciudad y por cargo, modalidad, cuota del portal oficial,
      fuentes, empresas que más publican, cobertura y mediana de salario
      publicado (mínimo 30 en una moneda), variación contra la edición
      anterior («sin datos suficientes» mientras no exista), fecha de corte,
      metodología (dentro del JSON) y límites. Solo agregados: grupos con
      menos de 10 vacantes suprimidos; sin URL, id ni datos personales
- [x] `scripts/build-market-report.ts`: una consulta acotada
      (`queryMarketRows`) en `BEGIN READ ONLY` con `statement_timeout` de
      60 s; `--dry-run` por defecto. La prueba de integración comprueba que
      un `UPDATE` falla dentro de esa transacción y que el total coincide
      con el de la portada
- [x] Rutas: `/informes/empleo-colombia-AAAA-MM` (HTML con el texto
      completo en el HTML inicial, Markdown y JSON), `/informes/empleo-colombia`
      → 302 a la más reciente, `/informes` (200 `noindex` hasta la primera
      edición). En `sitemap-pages.xml` desde la primera edición. Sin
      marcador de anuncios. `REPORTS_ENABLED=false`: 404 real y fuera del
      sitemap. «Informes» en el pie
- [x] Párrafo comparativo propio en cada hub (`buildHubComparison`):
      cuota frente al país, puesto entre ciudades o cargos, remoto y portal
      oficial de la muestra frente al país, empresa con más ofertas. ADS-055
      comprueba que no se repite entre hubs indexables
- [x] Hubs simples con menos de 10 vacantes: `noindex,follow` (antes solo
      con 0, SP-2) y fuera de `sitemap-categories.xml` cuando la edición más
      reciente (de menos de 45 días) los cuenta por debajo de 10; sin
      edición, el sitemap queda igual que hoy. Sin anuncios (ya lo hacía F1a)
- [x] Portada: frase de contexto de las ciudades (cuota del país de las
      tres primeras) y cuota por tarjeta en escritorio; cifra de cada cargo
      con la fecha de corte de la edición; enlace al informe. No se quitó
      ningún enlace (ADS-057)
- [x] Verificación (2026-11-15): `tsc`, `npm run build`, `test:unit`,
      `test:seo`, `test:job-render`, `test:agent-readiness`,
      `test:companies-search` y `test:baseline` en verde
- [x] En frío según el runbook (BD desechable, 9 procesos nuevos por lado,
      alternados, URL única `?coldcheck=`; base `449c981` frente a la rama;
      `npx tsx scripts/run-isolated-tests.ts home-cold`). Medianas:
      primer `/` móvil 391 → 337 ms; `/` escritorio 44 → 48 ms; `/` en
      caliente 17 → 18 ms; hub de Bogotá 52 → 51 ms; `/dashboard` 37 → 39 ms;
      arranque hasta `/api/health` 591 → 483 ms; informe 11 ms. HTML de
      `/` +2,6 KB y del hub +1,3 KB sin comprimir; JS inicial gzip
      137,6 → 138,9 KB. Sin regresión: no hay consultas nuevas, cachés ni
      precalentado nuevos; el caché y el precalentado del dashboard no cambian
- [ ] **Propietario, requisito antes de desplegar a `main`:** generar la
      primera edición de **ambos países** contra producción y hacer commit
      de los JSON. Sin ellos: los hubs no muestran comparación (CX-6), la
      portada no muestra cifras de cargos, el pie enlaza un `/informes`
      vacío (señal de sección en construcción, PP-2) y los hubs pequeños
      quedan `noindex` pero todavía en `sitemap-categories.xml` («URL
      enviada marcada como noindex» en Search Console). Comandos:
      `npx tsx scripts/build-market-report.ts --dry-run --country CO`,
      revisar, `--write --country CO`; lo mismo con `--country VE`. Hacerlo
      cerca del cierre de cada mes: volver a correrlo en el mismo mes
      reescribe esa edición. Si pasan más de 45 días sin edición nueva, el
      sitemap vuelve a listar todos los hubs (vuelve el mismo aviso)
- [ ] Después del despliegue: `/seo drift compare` de un hub y de `/`, y
      la comprobación en producción del runbook (URL única, `MISS`)
- [ ] Posible seguimiento (no en esta fase): automatizar la edición
      mensual con un cron o un Action que abra un PR con el JSON
- **Gate:** CX-2, CX-6, SP-2, SP-6, AV-1 y AV-2 tienen cobertura de
  pruebas. Quedan en CUMPLE en producción cuando exista la primera edición
  (paso del propietario de arriba)

## F5 — Herramientas (según D6)

- [ ] Pruebas que fallan primero: casos resueltos a mano por fórmula
- [ ] Calculadora de liquidación y de salario neto, con norma citada
- [ ] Valores anuales en un archivo con fuente y fecha
- [ ] «Herramientas» en menú y pie
- **Gate:** AV-4 reforzada; `original_pages` ≥ 40, `original_words` ≥ 30.000

## F6 — Gate final y solicitud

- [ ] `adsense:audit --live`: 50 de 50 en CUMPLE (adjuntar el JSON)
- [ ] Search Console: sin acciones manuales ni problemas de seguridad
- [ ] Guías e informes indexados (inspección de URL en una muestra)
- [ ] 14 días de la capa nueva en producción con publicación regular
- [ ] Chromium, Firefox y WebKit, escritorio y móvil (CX-10)
- [ ] CMP activo en AdSense (D5)
- [ ] El propietario solicita la revisión en su cuenta
- [ ] Si hay segunda negativa: encender D1(b), esperar un ciclo de rastreo,
      repetir F6
- [ ] Al aprobar: archivar el cambio y abrir uno nuevo para la colocación
      de anuncios

## No se toca

`src/lib/job-filters.ts` (`CITY_OPTIONS`), el caché de páginas del
dashboard y su precalentado, la regla de retención (ADR 0008), la
configuración de Render, cualquier función de auto-apply o CV.
