# 02 — Product Requirements: AI Resume Studio

**Fecha:** 2026-11-14 · **Fase:** 2 · **Marcas:** [V] verificado · [P] propuesto · [?] pendiente

| Tema | Estado |
|---|---|
| Alcance MVP y fuera de alcance | [P] |
| Modelo de cobro: trabajo gratis, pago al final | [V] decisión del propietario (ADR 0015) |
| Precio | [P] doc 06 §9, pendiente de aprobación |
| Vacantes gratis y sin condiciones | [V] decisión del propietario; `PAYWALL_ENABLED=false` en `src/config.ts:20` |

## 1. Objetivo

Que un candidato en Colombia o Venezuela pueda crear o mejorar su hoja de
vida y **adaptarla a una vacante real de BuscoTrabajo**, viendo por qué su
perfil cumple o no cada requisito, sin que el sistema invente datos. Pagar
solo cuando quiera descargar el CV final.

## 2. Principios no negociables [V: decisiones del propietario y prompt maestro]

| ID | Principio |
|---|---|
| RS-P1 | Las vacantes, la búsqueda, el detalle y el enlace de aplicación siguen gratis y funcionan exactamente como hoy (el detalle es público; «Aplicar» pide sesión desde `openspec/changes/job-trust-2026-10`, `ApplyGateModal`), sin pago y sin depender del Resume Studio. |
| RS-P2 | Nunca se inventan empleos, fechas, estudios, certificaciones, habilidades, cifras ni logros. Solo se reescribe lo que el usuario dio o confirmó. |
| RS-P3 | Todo cambio de **hechos** (no de redacción) requiere confirmación explícita del usuario. |
| RS-P4 | La puntuación es una estimación propia y explicable, nunca «puntuación ATS» ni garantía de pasar filtros o de ser contratado. |
| RS-P5 | Autorización de tratamiento de datos previa, expresa e informada, separada de los términos; casillas opcionales sin marcar. |
| RS-P6 | El trabajo (onboarding, carga, chat, vista previa, análisis) es gratis. El pago desbloquea la descarga del CV final sin marca de agua. |
| RS-P7 | Sin urgencia falsa, sin prueba social no verificable, sin renovación automática. |
| RS-P8 | Sin anuncios dentro del flujo del Resume Studio (carga, chat, pago, descarga, consentimiento). |

## 3. Alcance

### MVP (Fase de implementación R1–R4, doc 10) [P]

1. Entrada desde el detalle de vacante («Analizar mi perfil para esta vacante»), desde la home y desde `/hoja-de-vida` (landing pública con contenido útil).
2. ~~Onboarding~~ Eliminado en la revisión 2: cargo, ciudad y requisitos salen de la vacante elegida.
3. Crear desde cero (formulario guiado) o subir PDF/DOCX (≤ 2 MB, ≤ 4 páginas).
4. Revisión de datos extraídos campo por campo antes de usarlos.
5. 3 plantillas ATS-friendly de una columna (doc 05 §6).
6. Editor con chat IA y vista previa por páginas, propuestas «Aplicar / Editar / Descartar», historial y deshacer/rehacer.
7. Análisis de compatibilidad contra una vacante de BuscoTrabajo con requisitos, evidencia y brechas.
8. Comparación antes/después.
9. Pase de 1 mes (COP 14.900) o 3 meses (COP 9.900/mes, COP 29.700 en un pago) con Wompi, sin renovación automática, para desbloquear descargas PDF/DOCX, plantillas y adaptaciones (revisión 2, doc 06 §9.3).
10. Versiones: una base y hasta 5 adaptaciones por vacante.
11. Derechos del titular: ver, descargar, corregir y borrar todo.

### Fuera del MVP

- Cartas de presentación, seguimiento de postulaciones, suscripción, importación de LinkedIn, foto en el CV, plantillas de dos columnas, traducción a inglés, postulación automática (prohibida, AGENTS.md regla 7).

## 4. Historias de usuario y criterios de aceptación

Formato: **RS-USn** historia → criterios (Dado/Cuando/Entonces resumido).

| ID | Historia | Criterios de aceptación |
|---|---|---|
| RS-US1 | Como candidato que ve una vacante, quiero saber qué tan bien encaja mi perfil. | El botón aparece debajo de «Aplicar en {fuente}» y no lo reemplaza ni lo oculta. Sin registro, el análisis corre con un CV pegado o subido en la sesión. Si la vacante no tiene descripción (`description: null`), se dice «Esta vacante no trae requisitos suficientes para un análisis» y no se calcula puntuación. |
| RS-US2 | Como candidato sin experiencia, quiero crear mi CV desde cero. | Plantilla «Primer empleo» sugerida si el usuario marca «sin experiencia». Formulario permite secciones de formación, proyectos, voluntariado y habilidades sin exigir experiencia laboral. |
| RS-US3 | Como candidato, quiero subir mi CV y que se lea bien. | Acepta PDF con texto y DOCX ≤ 2 MB. Rechaza otros tipos, archivos cifrados, con macros o escaneados sin texto, con mensaje claro. Cada campo extraído se muestra con su texto de origen y el usuario lo confirma o corrige. |
| RS-US4 | Como candidato, quiero pedir cambios en lenguaje natural. | Cada respuesta de la IA llega como propuesta con diff. Etiqueta «Redacción» o «Hecho nuevo». Un «Hecho nuevo» no se aplica sin que el usuario escriba o confirme el dato. Deshacer revierte el último cambio aplicado. |
| RS-US5 | Como candidato, quiero adaptar mi CV a una vacante. | Se listan requisitos obligatorios y deseables extraídos del texto de la vacante, cada uno con estado: Demostrado (cita del CV) / Parcial / No demostrado / No evaluable. Las sugerencias solo reordenan, destacan o reescriben datos existentes; para un requisito no demostrado se pregunta «¿Tienes experiencia con X?» y nunca se agrega sin respuesta afirmativa. |
| RS-US6 | Como candidato, quiero entender mi puntuación. | Se muestra el desglose por componente, los pesos, la evidencia y 3 acciones priorizadas. Texto fijo: «Estimación de BuscoTrabajo. No es la puntuación de ningún ATS ni garantiza entrevistas». Misma entrada → misma puntuación. |
| RS-US7 | Como candidato, quiero ver qué cambió. | Vista antes/después con inserciones y eliminaciones resaltadas; contador de cambios por sección. |
| RS-US8 | Como candidato, quiero descargar mi CV. | La vista previa completa es gratis con marca de agua «Vista previa». Tras el pago aprobado (webhook verificado), la descarga sin marca queda disponible para esa versión y sus re-ediciones por 30 días [P]. |
| RS-US9 | Como candidato, quiero borrar mis datos. | «Borrar todo» elimina CV, versiones, análisis y archivos en ≤ 24 h, y conserva solo el registro contable del pago y el de la autorización (doc 07 §5). |
| RS-US10 | Como visitante que no quiere el Resume Studio, quiero seguir usando las vacantes igual. | Ninguna ruta de vacantes cambia su HTML principal ni su tiempo de carga más allá del botón; Lighthouse y la línea base del dashboard no empeoran (`docs/DASHBOARD-PERFORMANCE-RUNBOOK.md`). |
| RS-US11 | Como candidato, quiero retomar donde quedé. | El borrador se guarda en el navegador sin cuenta; con cuenta, en el servidor. Al volver se ofrece «Continuar tu CV de [fecha]». |
| RS-US12 | Como titular, quiero revocar la autorización. | Desde «Mi cuenta → Datos y privacidad», revocar detiene el procesamiento con IA y ofrece borrar o descargar los datos. |

## 5. Requisitos no funcionales [P]

| ID | Requisito |
|---|---|
| RS-NF1 | Respuesta del chat: primer token < 3 s p50 con el proveedor elegido [?: medir]. |
| RS-NF2 | Costo de IA por CV completo ≤ USD 0,02 en el escenario medio (doc 06 §9). |
| RS-NF3 | Sin impacto en memoria de Render: nada de Chromium en el servidor; PDF en el cliente (doc 06 §6). |
| RS-NF4 | Móvil primero: todo el flujo usable en 360 px de ancho. |
| RS-NF5 | Accesibilidad WCAG 2.2 AA en contraste, foco y lectores de pantalla. |
| RS-NF6 | Ningún dato del CV en logs, analítica (GA4) ni URLs. |

## 6. Métricas de éxito [P]

- % de visitantes de vacante que abren el análisis (sin bajar el clic en «Aplicar»).
- % que llegan a vista previa completa; % que pagan; reembolsos.
- Reportes de «la IA inventó algo» (meta: 0 confirmados).
- Costo IA real por CV pagado vs. estimado.
