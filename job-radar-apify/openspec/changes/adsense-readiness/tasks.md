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

### Hecho (2026-11-15), rama `claude/adsense-f0-audit-5fec2b`

- [x] Pruebas ADS-001 en `tests/validate-adsense-audit.test.ts` (suite
      `unit`, 17 pruebas): las 50 reglas una vez cada una (AV 5, CX 10, SP 19,
      MA 1, PP 6, PG 7, TX 2) y el recuento 26 ✅ / 15 ⚠️ / 9 ❌ de la
      propuesta; «todo cumple» da 50 entradas y código 0; `/login` con
      marcador hace fallar PP-1, la nombra y da código 1; MANUAL sin atestar
      nunca pasa; el fetcher solo hace GET, en el sitio auditado, con
      presupuesto y pausa
- [x] `scripts/adsense-audit.ts` + `npm run adsense:audit`: build sintético
      (`envDir: false`) y Postgres desechable vía `run-isolated-tests.ts`
      (suite `adsense-audit`, semilla `tests/fixtures/adsense-audit.sql`:
      vacante oficial, dos de terceros y una vencida). Reglas en
      `scripts/lib/adsense-audit-rules.ts`; CUMPLE / PARCIAL / NO CUMPLE /
      MANUAL con evidencia, umbral, valor y `pendiente_manual`. Informe JSON
      en el directorio temporal + resumen legible. Sale ≠ 0 si una regla
      medible no cumple; con `--expect <json>`, si la matriz cambia;
      `--attest <json>` registra decisiones (D1…) y confirmaciones MANUAL
- [x] Modo `--live` (solo GET a `https://buscotrabajo.co`, 40 URLs por
      defecto y tope de 120, pausa ≥ 1 s, User-Agent genérico). **No
      ejecutado: requiere aprobación del propietario.** Probado su perfil
      contra el servidor local (8 GET en ~7 s) y sin red (método, host,
      pausa, tope, User-Agent)
- [x] Medir: vacantes indexables por procedencia → `copied_indexable_share`
      (muestra del sitemap en `--live`; sintético: 0,667)
- [ ] Medir: clics de Google a vacantes de terceros (28 días) → insumo de D1.
      MANUAL: es dato de Search Console; el auditor no lo inventa
- [x] Prueba de paridad HTML inicial ↔ DOM hidratado en Chromium (SP-1 por
      palabras y por bloque; SP-5 texto oculto en escritorio **y** móvil,
      acordeones `<details>` permitidos). Anuncios observados por petición
      real a `adsbygoogle.js` (abortada) tras disparar el cargador diferido
- [x] Métricas `original_pages` / `original_words` desde
      `sitemap-pages.xml` (familias propias: institucionales, legales,
      `/guias/*`, `/informes/*`, `/herramientas/*`): 10 / 2.291
- [x] Línea base en `docs/seo-evidence/adsense-audit-baseline.json` (solo
      indicadores) y `adsense-audit-baseline-2026-11-15.md` (diferencias
      regla por regla con la propuesta)
- **Gate (ajustado por F1):** el auditor reproduce la matriz de la línea
  base — 21 CUMPLE · 1 PARCIAL · 14 NO CUMPLE · 14 MANUAL — con 0
  diferencias (`npm run adsense:audit` en verde). F1 movió PP-1…PP-4, AV-5,
  CX-5, CX-9, SP-17, SP-19 y PG-5 a CUMPLE; AV-1, AV-2, AV-4, CX-1…CX-4,
  CX-6, SP-2, SP-6, SP-11 y SP-12 siguen en NO CUMPLE porque F2 (#138),
  F3 (#137) y F4 (#139) no están fusionados; 14 reglas que la propuesta
  daba por ✅/⚠️ dependen del propietario o de Google (MANUAL)
- **Hallazgos nuevos:** TX-1 NO CUMPLE (`/fuentes` 130 palabras sin JS
  frente a 189 hidratada; 4 páginas < 150), SP-1 PARCIAL (93,6 % de
  palabras; miga de pan y «Más empleos» solo en el HTML del servidor),
  PP-5 NO CUMPLE en sintético (`/empresas` con anuncios y solo una lista de
  enlaces; medir con `--live`)
- Al fusionar cada fase, regenerar la línea base con el informe de la suite

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
