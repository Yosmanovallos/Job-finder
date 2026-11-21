# AI Resume Studio — paquete de diseño (Fase 6: para aprobación)

**Fecha:** 2026-11-14 · **Rama:** `codex/resume-studio-design` · **ADR:** [0015](../adr/0015-resume-studio-design-thaw.md)

Solo diseño y documentación. **No hay código de producción.** La
implementación sigue congelada hasta una aprobación explícita.

Marcas en todos los documentos: **[V]** verificado · **[P]** propuesto · **[?]** pendiente.

| # | Documento | Contenido |
|---|---|---|
| 01 | [Research & Benchmark](01-research-benchmark.md) | Flujo de JobStep pantalla por pantalla (grabación), qué copiar, mejorar y descartar |
| 02 | [Product Requirements](02-product-requirements.md) | Principios, alcance MVP, historias y criterios de aceptación |
| 03 | [User Flow & UX](03-user-flow-ux.md) | Recorrido, estados, accesibilidad, responsive |
| 04 | [Mockup Specification](04-mockup-specification.md) | 12 pantallas, tokens, vacante real del ejemplo |
| 05 | [AI & ATS Strategy](05-ai-ats-strategy.md) | Extracción, puntuación transparente, no fabricar datos, plantillas, proveedores y costo por CV |
| 06 | [Architecture Proposal](06-architecture-proposal.md) | Componentes, datos, Wompi, **costos y precio (§9)** |
| 07 | [Privacy & Compliance](07-privacy-compliance.md) | Ley 1581, proveedores de IA, **matriz de cumplimiento** |
| 08 | [Security & Threat Model](08-security-threat-model.md) | Amenazas, controles, hallazgos |
| 09 | [Testing Strategy](09-testing-strategy.md) | Perfiles sintéticos, evals, pruebas de seguridad |
| 10 | [Implementation Roadmap](10-implementation-roadmap.md) | Decisiones previas, fases R0–R5, rollback |
| 11 | [JobStep a fondo y réplica](11-jobstep-replica.md) | Video del flujo por link, negocio y precios de JobStep, IA, economía con Qwen, qué copiar y qué no, plan R0–R5 actualizado |

**Mockups y prototipo:** [`mockups/resume-studio-prototype.html`](mockups/resume-studio-prototype.html)
(abrir en el navegador; también publicado como artifact privado). Las 12
pantallas en escritorio y móvil, recorrido automático, datos ficticios y la
vacante real `mockups/sample-job-2026-11-14.json`.

## Revisión 2 (2026-11-14)

A pedido del propietario: diseño minimalista y con estilo de agente; sin
onboarding; «Analizar mi perfil» lleva directo a subir el CV; la
autorización son tres casillas con el texto legal completo detrás de cada
enlace; el chat es un agente que trabaja a la vista; y la descarga es una
pantalla de pase (1 o 3 meses) como la referencia, con la vacante arriba.
Ver doc 03 §0, doc 04 §0 y doc 06 §9.3. Donde los documentos de abajo
contradigan esta revisión, manda la revisión.

## Estado (2026-11-21)

**Implementación aprobada: [ADR 0017](../adr/0017-resume-studio-implementation.md).**
Flujo por link (doc 11), IA Qwen en Alibaba Cloud Virginia (sustituye la
recomendación de Gemini de abajo), pases sin renovación (precio final D2
abierto). Rama de integración `codex/resume-studio`; nada a `main` hasta R5.
El resumen de abajo es el de la revisión 2 y se conserva como historial.

## Resumen para decidir

- **Precio (revisión 2):** pase de 1 mes COP 14.900 o 3 meses COP 9.900/mes
  (COP 29.700 en un pago), sin renovación automática; margen 64–82 % (doc 06
  §9.3). Antes: COP 9.900 IVA incluido, pago único por CV (30 días
  de re-ediciones). Margen bruto 63–79 % con 10 CV gratis por cada pago;
  baja a 17–33 % si son 100 gratis por pago (doc 06 §9.1), de ahí los topes
  de IA por sesión.
- **Qué compra el pago:** PDF/DOCX limpio, 30 días de re-ediciones y más
  adaptaciones. El contenido del CV no queda bloqueado (vive en el
  navegador y exportar los propios datos es un derecho).
- **Proveedor de IA recomendado:** Gemini 2.5 Flash-Lite en **Vertex AI con
  región de EE. UU. fijada** (la Gemini API directa no deja fijar región),
  respaldo gpt-5-nano. ~USD 0,013 por CV.
- **Con pocos usuarios gratis, el costo dominante es la comisión de Wompi**, no la IA.
- **AdSense:** el beneficio posible viene de la landing `/hoja-de-vida` y de
  guías editoriales indexables; los rastreadores no ven la herramienta
  interactiva ni lo que hay tras el pago. Nada garantiza la aprobación.
- **Fuentes:** `research/ai-pricing-legal-2026-11-14.md` (precios, términos y
  normas con URL y fecha).
- **Corrección de premisa:** COP 12.300 de JobStep es el precio mensual del
  plan trimestral (suscripción), no un pago único.
- **Vacantes intactas:** el módulo vive detrás de banderas propias;
  `PAYWALL_ENABLED` sigue en `false`.
- **Pendiente de terceros:** revisión legal (doc 07 §8) y contable (IVA).

Los cuadros del video de referencia **no** están en el repositorio: el CV que
aparece es de una persona real.
