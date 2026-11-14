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

**Mockups y prototipo:** [`mockups/resume-studio-prototype.html`](mockups/resume-studio-prototype.html)
(abrir en el navegador; también publicado como artifact privado). Las 12
pantallas en escritorio y móvil, recorrido automático, datos ficticios y la
vacante real `mockups/sample-job-2026-11-14.json`.

## Resumen para decidir

- **Precio recomendado:** COP 9.900 IVA incluido, pago único por CV (30 días
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
