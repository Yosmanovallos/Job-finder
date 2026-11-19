# Tareas — adsense-readiness

Una fase por sesión. No se empieza una fase sin cerrar el gate de la
anterior. **No se pulsa «Solicitar revisión» antes de F6.**

## Decisiones previas (propietario)

- [ ] D1 vacantes de terceros: (a) completas sin anuncios / (b) extracto
- [x] D2 nombre y rol del responsable para «Acerca de» (2026-11-18: LinkedIn del propietario)
- [ ] D3 quién revisa y firma las guías
- [ ] D4 correo con dominio propio
- [ ] D5 activar el mensaje de consentimiento (CMP) en AdSense
- [x] D6 incluir una calculadora antes de la primera solicitud: sí, las dos
      (liquidación y salario neto), aprobado por el propietario el 2026-11-18

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

- [x] «Acerca de» con responsable real (D2, propietario 2026-11-18): sección «Quién está
      detrás de BuscoTrabajo» con nombre, ciudad, perfil profesional y enlace a su LinkedIn,
      solo con datos de su perfil público. Prueba ADS-021
- [ ] Correo con dominio propio (D4)
- [ ] Actualizar `llms.txt`, API Catalog, docs y digests con las rutas reales
- [ ] lint, typecheck, `test:unit`, `test:integration`, `test:baseline`
- [ ] Dashboard en frío y con URL única según el runbook
- **Gate:** PP-1…PP-5, TX-1, CX-5, CX-7, PG-5, SP-17, SP-19 en CUMPLE

## F2 — Superficie copiada

> Hecho 2026-11-14 en `claude/adsense-f2-5c9a7f` (PR en borrador contra
> `codex/adsense-readiness`). D1 = (a), la opción actual.

- [x] Pruebas que fallan primero: `tests/validate-adsense-f2.test.ts`
      (ADS-030…ADS-039, suite `unit`), escritas antes del código; fallaban
      por los módulos inexistentes
- [x] Procedencia: `jobProvenance()` en `src/lib/ad-eligibility.ts`
      («Portal oficial» → `official`, el resto → `third_party`); la regla
      de anuncios la usa. La composición de la página de vacante sale de
      `server.ts` a `src/lib/job-page-render.ts` (`renderJobPageHtml()`),
      probable sin red
- [x] Vacante de terceros: sin marcador de anuncios y con los bloques
      propios en el HTML inicial (miga, ficha, fuente nombrada, enlace al
      original, reputación, otras vacantes de la empresa, «Más empleos en
      <ciudad>») — ADS-032. Sin dato, el bloque no se pinta — ADS-033
- [x] D1(b) detrás de `THIRD_PARTY_JOB_EXCERPT_ENABLED`, **apagada**
      (`src/lib/third-party-excerpt.ts`): extracto ≤ 300 caracteres (prefijo
      literal), sin requisitos, sin JobPosting, `noindex,follow`, el mismo
      extracto en `__SSR_JOB__`, fuera de `sitemap-jobs.xml`,
      `sitemap-jobs-recent.xml`, `URL_UPDATED` e IndexNow — ADS-034/035.
      Con la bandera apagada (o con cualquier valor que no sea
      `true`/`1`/`on`) el HTML de la vacante es byte a byte el de 449c981:
      ADS-031 contra `tests/fixtures/job-page-golden/` (una vacante de
      terceros y una oficial, generadas antes del cambio)
- [x] ADR `docs/adr/0016-third-party-job-excerpt.md` en **borrador**,
      requisito antes de encender la bandera (enmienda al contrato
      JobPosting; abierto: `/api/jobs/:id` se queda completo) — ADS-039
- [x] Vacante vencida: ya respondía 410 real (archivada, purgada o vencida
      en sitio) y 301 al portal oficial si fue reemplazada (ADR 0006, sin
      tocar), sin el shell ni el cargador de anuncios; `test:seo` lo
      comprueba ahora también (ADS-035). Enlaces: los hubs ya consultan con
      `liveJobSql()`; además `liveListingJobs()` quita en el render las
      filas de la caché que ya pasaron los 30 días (o su `validThrough`)
      en hubs, intención, empresas, `/empleos`, portada y «Más empleos» —
      ADS-036. Límite: una fila archivada aún joven dentro de una entrada
      de caché no se detecta hasta que la caché se refresca; el bloque
      «otras vacantes de la empresa» no trae fecha y no se filtra
- [x] «Más empleos en <ciudad>» ordenado por cercanía de cargo (palabras
      del título en común, desempate por el hash del id), mismo número de
      enlaces — ADS-037
- [x] `test:seo` en verde
- [x] Drift local de la ruta real (2026-11-14, `npm run drift:adsense-f2`,
      `tests/drift-adsense-f2.ts`): 449c981 y esta rama, uno tras otro,
      contra la misma BD desechable con un hub sintético de Bogotá
      (16 vacantes, 2 de «Portal oficial»). URLs: 2 vacantes oficiales,
      2 de terceros (LinkedIn, Computrabajo), `/empleos/bogota`,
      `sitemap-jobs.xml` y `sitemap-jobs-recent.xml`. Idénticos: status,
      title, meta description, canonical, robots, H1, JSON-LD (los 4 con
      JobPosting), `__SSR_JOB__`, marcador de anuncios (sí en las 2
      oficiales, no en las 2 de terceros), el cuerpo de `#app` fuera de
      «Más empleos», `__SSR_JOB_LINKS__` fuera de `related`, el hub y los
      dos sitemaps. **Única diferencia:** la lista de «Más empleos» de las
      4 vacantes, con 6 enlaces en ambas versiones. Ejemplo: «Mesero» ahora
      abre con «Mesero de Eventos» y sigue con la rotación anterior
- [ ] `/seo drift compare` de 2 vacantes de cada procedencia en producción,
      tras desplegar
- [x] CX-5 sin perder variedad: en un hub sintético de 60 vacantes con
      títulos repetidos, 37 listas distintas por rotación → 38 por cercanía;
      hermanas con el mismo título siguen con listas distintas (ADS-037)
- [ ] D1(b): API pública de agentes y `/api/jobs/:id` siguen con el texto
      completo; quedan en «Abierto» del ADR 0016 (no afecta al gate con D1(a))
- **Gate:** CX-4, CX-9, SP-11, SP-12, PP-4 en CUMPLE con D1(a) — probado
  por ADS-030…039 y `test:seo`; D1(b) implementada y apagada, con dos
  consumidores abiertos en el ADR. Drift local de la ruta real hecho;
  falta el de producción tras desplegar

## F3 — Guías

> Infraestructura en `codex/adsense-guides` (2026-11-14), apagada
> (`GUIDES_ENABLED = false` en `src/config.ts`). Sin guías firmadas,
> `/guias*` es un 404 real y no aparece en el sitemap ni en el menú.

- [x] Pruebas que fallan primero: `tests/validate-guides.test.ts` (ADS-040:
      rutas, JSON-LD `Article`, autor, fechas, fuentes obligatorias, sin
      párrafos repetidos, ≥ 800 palabras, revisión del propietario, 404 y
      sitemap con el interruptor), en la suite `unit`
- [x] `/guias` y `/guias/:slug` renderizadas en el servidor
      (`src/server/routes/guides.ts`): texto completo en el HTML inicial,
      Markdown con `Accept: text/markdown`, `/api/guias` para la navegación
      del cliente, marcador de anuncios solo en la guía publicada (el índice
      es navegación, PP-3)
- [x] Contenido en `content/guias/*.md` con validador
      (`src/lib/guides.ts`, formato en `content/guias/README.md`)
- [x] `sitemap-guides.xml` en el índice del sitemap solo con guías publicadas
- [x] «Guías» en menú y pie detrás de `GUIDES_ENABLED`; «Guías
      relacionadas» (máx. 3, mapeo estático de etiquetas, sin consultas) en
      hubs y vacantes
- [x] Lista de 12 temas desde el estudio de palabras clave (#121), aprobada
      por el propietario el 2026-11-14 (`f3-temas-propuestos.md`)
- [x] Autor y firmante: «Equipo de BuscoTrabajo» (Organization), decidido
      por el propietario el 2026-11-14 (D3)
- [ ] 12 guías: borrador → verificación de cada fuente → dato propio del
      corpus con fecha de corte → revisión y firma (D3)
  - [x] Borradores 1–5 (remoto, sin experiencia, APE del SENA, medio tiempo
        y fines de semana, temporada), normas leídas en el Gestor Normativo
        de Función Pública y en los portales oficiales; datos en
        `f3-datos-corpus-2026-11-14.md`. `secretariasenado.gov.co` no
        respondió desde este entorno, por eso se cita Función Pública
  - [x] Firma del propietario de las guías 1–5 (2026-11-14). Aprobadas y
        sin publicar: `publicada` se fija en el commit de salida
  - [x] Borradores 6–12 (tipos de contrato, prestaciones, periodo de
        prueba, liquidación, ofertas falsas, hoja de vida, entrevista),
        2026-11-14; revisión en `f3-revision-guias-6-12.md`
  - [x] Firma del propietario de las guías 6–12 (2026-11-14). Las 12
        están aprobadas y sin publicar
- [x] Publicación escalonada (decisión del propietario 2026-11-14): cada
      guía aparece sola en su fecha `publicada` (hora de Colombia); 4 el día
      del encendido y luego 2 por semana (`scripts/schedule-guides.ts`)
- [x] `scripts/check-guide-figures.ts`: vuelve a medir las cifras del corpus
      de cada guía (páginas públicas y API pública con pausas)
- [x] `llms.txt` lista `/guias` solo con el interruptor encendido
- [x] Prueba HTTP `tests/validate-guides-http.ts` en `test:seo`, para los dos
      estados del interruptor. Verificado en local con el interruptor
      encendido y fechas de prueba (sin commit de ese estado)
- [x] SEO antes del encendido (2026-11-18): `BreadcrumbList` (Inicio › Guías ›
      guía) en cada guía e `ItemList` + `BreadcrumbList` en `/guias`; `<title>`
      de 60 caracteres o menos con `titulo_seo` (el H1 conserva `titulo`; el
      validador rechaza títulos más largos); `indexnow:submit` añade las guías
      publicadas o actualizadas en la ventana y `/guias` (vacío con el interruptor
      apagado). Sin imagen social propia por guía: se usa la general del sitio
- [ ] **Día del encendido** (después de mergear #136 y #137):
  1. `npx tsx scripts/check-guide-figures.ts` y actualizar en cada guía las
     cifras que cambiaron y su `corte`. Con la cuota de la API agotada,
     esperar al día siguiente
  2. `npx tsx scripts/schedule-guides.ts --start <fecha real> --write`
  3. `GUIDES_ENABLED = true` en `src/config.ts`
  4. `tsc`, `build`, `test:unit`, `test:job-render`, `test:agent-readiness`,
     `test:seo`, `test:baseline`
  5. Desplegar; comprobar en producción `/guias`, una guía, el sitemap y un
     hub; `/seo drift compare` de un hub y una vacante (bloque nuevo
     «Guías relacionadas»)
  6. Enviar `sitemap-guides.xml` en Search Console (acción del propietario)
- [ ] Al encender: `test:seo` y `test:baseline` con la bandera activa y una
      guía de prueba, para cubrir la inyección en hubs y vacantes de
      `server.ts`, el índice del sitemap y que la ruta del payload coincida
      con `location.pathname` en vacantes con slug o tildes
- [ ] `llms.txt` y catálogo con `/guias` cuando esté encendido (no antes:
      anunciaría un 404)
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

> Hecho en `claude/adsense-f5-calculadoras-04ac33` (2026-11-18), en PR y
> sin desplegar.

- [x] Pruebas que fallan primero: casos resueltos a mano por fórmula
      (`tests/validate-labor-calculators.test.ts`, suite `unit`): contratos
      de 6 meses, 6,5 meses y 3,5 años; salario mínimo con y sin auxilio;
      auxilio en el borde de 2 SMMLV; salario integral (y su mínimo de 13
      SMMLV); renuncia, justa causa, vencimiento y despido sin justa causa en
      fijo, obra (mínimo 15 días) e indefinido (umbral de 10 SMMLV);
      vacaciones pendientes; tramos del fondo de solidaridad con sus bordes;
      fechas sin zona horaria; entradas fuera de alcance rechazadas
- [x] Calculadora de liquidación y de salario neto, con norma citada:
      `/herramientas/calculadora-de-liquidacion` y
      `/herramientas/calculadora-salario-neto`, explicación completa en el
      HTML inicial, cálculo en el navegador sin envío ni almacenamiento
      (prueba de privacidad), JSON-LD `WebApplication` + `BreadcrumbList`,
      marcador de anuncios en las calculadoras y no en `/herramientas`
- [x] Valores anuales en un archivo con fuente y fecha
      (`src/lib/labor-values.ts`); cada valor leído en `.gov.co` el
      2026-11-18, citas en `f5-fuentes-calculadoras.md`. La Ley 2466 de 2025
      no modifica los artículos usados (64, 132, 186, 189, 249, 306)
- [x] «Herramientas» en menú y pie; sitemap y `llms.txt`; enlaces con las
      guías de liquidación y prestaciones (bloque de render en la guía y
      «Guías relacionadas» solo con guías publicadas)
- [ ] Retención en la fuente: no se calcula (fórmula y UVT 2026 sin
      verificar); la página lo explica
- [ ] Tras desplegar: `/seo drift compare` de una calculadora, IndexNow de
      las 3 URLs y medir `original_pages`/`original_words` con el auditor F0
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

## Backlog (no implementar todavía)

- [ ] Interruptor por fuente (propietario 2026-11-18): retirar de la web todas
      las vacantes de una fuente (por ejemplo LinkedIn) con un cambio de
      configuración de minutos, sin borrar datos ni tocar la ingesta, para el
      caso de que una fuente pida salir. Debe cubrir páginas de vacante (410 o
      noindex según ADR), listados, hubs, sitemap, IndexNow, API pública y
      conteos. Hoy todas las fuentes tienen permiso; guardar esos permisos por
      escrito.

## No se toca

`src/lib/job-filters.ts` (`CITY_OPTIONS`), el caché de páginas del
dashboard y su precalentado, la regla de retención (ADR 0008), la
configuración de Render, cualquier función de auto-apply o CV.
