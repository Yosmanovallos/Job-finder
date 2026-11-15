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

- [ ] Pruebas que fallan primero: ADS-050…ADS-059
- [ ] Informe mensual calculado por código, con metodología y límites
- [ ] Párrafo comparativo propio en cada hub; hubs < 10 siguen sin indexar
- [ ] Portada: secciones con cifra y contexto en lugar de listas de enlaces
- [ ] Dashboard en frío y con URL única según el runbook
- **Gate:** CX-2, CX-6, SP-2, SP-6, AV-1, AV-2 en CUMPLE

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
