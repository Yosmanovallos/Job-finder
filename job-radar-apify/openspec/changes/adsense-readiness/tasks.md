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
