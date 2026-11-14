# 04 — Mockup Specification: 12 pantallas

**Fecha:** 2026-11-14 · **Marcas:** [V] verificado · [P] propuesto · [?] pendiente

| Tema | Estado |
|---|---|
| Tokens visuales usados | [V] `src/index.css:10-42,246-259`, `src/lib/brand-tints.ts`, `tailwind.config.js` fontFamily |
| Componentes base | [V] `src/components/ContentPage.tsx` (`PageHero`, `InkPanel`, `SectionHeading`, `PillLink`, `ContentCta`) |
| Mockups de alta fidelidad + prototipo navegable | [P] `mockups/resume-studio-prototype.html` (copia local del artifact) |
| Vacante real usada en el ejemplo | [V] ver §3 |

## 0. Revisión 2 (2026-11-14) — mapa de las 12 pantallas a 5 vistas [P]

El propietario pidió un diseño mucho más minimalista y «agéntico», sin el
onboarding y con el pago como en la referencia. El prototipo publicado es
ahora esta versión.

| Vista | Cubre las pantallas | Notas |
|---|---|---|
| Vacante | S1 | Botón de IA con borde degradado animado; «Aplicar» igual que hoy |
| Tu CV | S3, S4 | Tres casillas con enlace a panel legal; zona de carga; «crear desde cero» como enlace |
| Agente | S5–S11 | Pasos del agente, preguntas con respuestas rápidas, tarjeta de compatibilidad, propuestas con diff, «De 57 a 83 sin inventar nada»; CV en vivo con Antes/Después, plantilla, deshacer |
| Descarga (pase) | S12 | Banner de la vacante; planes 1 y 3 meses; ventajas; «Desbloquear»; Wompi simulado |
| Listo | S12 | Descargar PDF/DOCX, aplicar, versiones, exportar o borrar datos |
| — | S2 (onboarding) | **Eliminado**: los datos salen de la vacante |

Lenguaje visual: fondo blanco, una sola cosa importante por vista, bordes
finos en vez de sombras duras, tinta y verde de la marca, Space Grotesk en
titulares, un orbe con degradado verde-dorado como señal del agente
(gira cuando trabaja), texto que aparece al escribirse, transiciones cortas
que respetan `prefers-reduced-motion`.

## 1. Sistema visual aplicado [V]

| Token | Valor | Uso en el Resume Studio |
|---|---|---|
| `--foreground` | `hsl(210 7% 6%)` ≈ `#0e1011` | Texto, borde y sombra ink |
| `--primary` | `hsl(160 75% 24%)` ≈ `#0f6b4f` | Botón principal, estado «Demostrado» |
| `--green-deep` | `hsl(163 82% 16%)` | Banda de cierre, cabecera del paso de pago |
| `--green-soft` | `hsl(152 45% 92%)` | Fondo del hero, resaltado de cambios aplicados |
| `--gold-2` | `hsl(43 64% 53%)` | CTA de pago/descarga (como `ContentCta`) |
| `--destructive` | `hsl(0 72% 51%)` | Errores, «No demostrado» (con icono, no solo color) |
| TINTS | `#fdf1d3`, `#e8f1fb`, `#fde8dc`, `#e4f6f5`, `#efe9fd` | Tarjetas de pasos, plantillas y componentes de la puntuación |
| `.ink-card` / `.ink-card-sm` | borde 2 px + sombra dura 4/3 px | Tarjetas, paneles, botones secundarios |
| Fuentes | Space Grotesk (titulares), Inter (texto), JetBrains Mono (etiquetas) | Igual que el sitio |

El CV en sí (la hoja) **no** usa la estética ink: es blanco, una columna,
fuente de sistema neutra, porque es un documento para reclutadores y ATS.

## 2. Pantallas

Cada pantalla tiene versión escritorio y móvil en el prototipo (conmutador
arriba). Componentes reutilizados entre paréntesis.

| # | Pantalla | Contenido | Interacciones | Estados |
|---|---|---|---|---|
| S1 | Entrada | En la vacante: botón outline ink «Analizar mi perfil para esta vacante» bajo «Aplicar en LinkedIn». En `/hoja-de-vida`: `PageHero` con eyebrow «Hoja de vida con IA», 3 pasos en tarjetas TINTS y precio visible desde el inicio. | Ir al onboarding; «Aplicar» sigue igual. | — |
| S2 | Onboarding | 1 pregunta por pantalla, barra de progreso ink, «Omitir» en cada una salvo cargo: cargo objetivo, nivel (sin experiencia/junior/medio/senior), ciudad, modalidad, idioma del CV, objetivo (primer empleo, cambio, ascenso). | Teclado: Enter avanza. | Validación del cargo vacío. |
| S3 | Autorización | `InkPanel` con aviso de privacidad resumido, finalidades, proveedor de IA y país, derechos, enlace a la política. Casilla obligatoria **sin marcar** para el tratamiento del CV; casilla opcional aparte (guardar en la nube); términos del servicio de pago se aceptan en S12. | No se puede seguir sin la obligatoria. | Muestra versión de la política (`v2026-11`). |
| S4 | Cargar o crear | Dos tarjetas: «Subir PDF o DOCX» (zona de arrastre, límites visibles) y «Crear desde cero». Luego revisión campo por campo con «Texto original» a la izquierda. | Corregir/confirmar cada campo. | Archivo inválido, escaneado, demasiado grande. |
| S5 | Plantillas | 3 tarjetas: Clásica ATS (recomendada), Compacta, Primer empleo. Cada una con «Para quién» y «Limitaciones». | Elegir; vista previa en vivo. | — |
| S6 | Editor + chat | Izquierda: chat con sugerencias rápidas («Mejora mi resumen», «Hazlo más claro», «Reordena habilidades»). Cada respuesta es una tarjeta propuesta con etiqueta Redacción/Hecho nuevo y botones Aplicar/Editar/Descartar. Barra: deshacer, rehacer, historial. | Aplicar actualiza la vista previa. | IA no disponible → modo manual. |
| S7 | Vista previa | Hoja A4/Carta con paginación, zoom, marca de agua «Vista previa — BuscoTrabajo», validaciones (fechas sin orden, viñetas > 2 líneas, datos de contacto). | Edición manual en línea. | — |
| S8 | Elegir vacante | La vacante de origen preseleccionada; buscador de vacantes del sitio (usa la búsqueda actual); aviso si la vacante no trae requisitos. | Elegir. | Vacante sin descripción. |
| S9 | Compatibilidad | Número grande «Compatibilidad estimada 64/100» con el texto fijo de descargo, desglose (Requisitos obligatorios, Habilidades, Experiencia, Formación, Legibilidad), tabla requisito → estado → evidencia citada. | Expandir cada requisito. | «No evaluable» cuando la vacante no lo especifica. |
| S10 | Recomendaciones | Lista priorizada (impacto estimado en puntos). Cada una: qué, por qué (requisito al que responde), diff propuesto. Las que requieren un hecho preguntan primero («¿Has usado nómina electrónica? Sí / No»). | Aplicar una por una. | Respuesta «No» → la recomendación se descarta y el requisito queda «No demostrado». |
| S11 | Antes/después | Dos hojas lado a lado (móvil: conmutador), cambios resaltados, puntuación antes→después con explicación de cada punto ganado. | Revertir un cambio individual. | — |
| S12 | Descargar y versiones | Lista de versiones (Base, Adaptada a «Auxiliar administrativo contable · Alz Energy»). Vista previa completa gratis. Bloque de pago: precio único, qué incluye, «sin renovación automática», pago con Wompi (tarjeta, PSE, Nequi, Bancolombia [?]). Tras pagar: descargar PDF. | Pagar (simulado en prototipo) → desbloquear. | Pendiente, aprobado, rechazado. |

## 3. Vacante real del ejemplo [V]

Tomada de la API pública `GET /api/v1/jobs?search=auxiliar administrativo`
el **2026-11-14**:

- **Título:** Auxiliar administrativo contable - Bogotá
- **Empresa:** Alz Energy · **Ubicación:** Bogotá D.C. Metropolitan Area · **Fuente:** LinkedIn
- **id:** `01811122-c6f6-4625-ab1b-e15411edf5ce`
- **Copia de la respuesta de la API:** `mockups/sample-job-2026-11-14.json`
  (`GET /api/v1/jobs/01811122-…`, datos públicos de la vacante, sin datos de
  candidatos).
- **Requisitos que trae la vacante** (campo `requirements`, resumidos):
  1. Técnico, tecnólogo o profesional en Contabilidad, Finanzas, Administración o afines.
  2. Experiencia mínima de un (1) año en funciones contables o administrativas.
  3. Conocimientos en nómina, novedades de personal y liquidación de conceptos laborales.
  4. Manejo de herramientas ofimáticas, especialmente Microsoft Excel.
  5. Conocimientos y experiencia en herramientas de inteligencia artificial aplicadas a tareas contables y administrativas.
  6. Capacidad para organizar y gestionar información financiera y documental.
  7–14. Funciones: registro y verificación contable, facturas y cuentas de cobro, consolidación de información, apoyo a nómina, archivo documental.
  15. Asignación salarial: «Entre $1.900.000 a $2.100.000 mensuales» (texto de la vacante; los campos `salaryMin/Max` vienen `null`).
- **Habilidades listadas por la fuente** (`technologies`): conciliación
  bancaria, conciliación de cuentas, contabilidad, comunicación, hablar en
  público, contabilidad tributaria, control interno, estados financieros,
  cuentas a pagar, aptitudes de organización.
- **Inconsistencia de la fuente [V]:** el campo `company` dice «Alz Energy»
  y la descripción dice «Empresa: Suncol Energy». El análisis no la resuelve;
  muestra la empresa del campo `company`.

El prototipo trata 1–6 como requisitos (1–4 obligatorios por su redacción
«mínimo», «especialmente»; 5–6 deseables [P: la clasificación obligatorio /
deseable es una heurística, doc 05 §3]) y 7–14 como funciones. La vacante
puede vencer; el análisis guarda la fecha de la foto.

Las otras dos vacantes del mismo resultado (Computrabajo) traen
`description: null` y sirven como caso de prueba «vacante sin requisitos».

## 4. Datos sintéticos del prototipo [P]

Candidata ficticia **«Laura Méndez Rincón»**, correo `laura.mendez@ejemplo.test`,
teléfono `300 000 0000`, Bogotá. Técnica en Contabilidad y Finanzas (institución
ficticia «Instituto Técnico Ejemplo»), 2 años como asistente contable en
«Comercializadora Andina Demo S.A.S.» (empresa ficticia). Sin foto. Ningún
dato corresponde a una persona real.
