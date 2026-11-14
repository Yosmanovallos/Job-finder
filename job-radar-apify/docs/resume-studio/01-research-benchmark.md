# 01 — Research & Benchmark: JobStep y alternativas

**Fecha:** 2026-11-14 · **Fase:** 1 (Discovery) · **ADR:** 0015

Convención de todos los documentos de esta carpeta:

- **[V] Verificado:** visto en una fuente citada, en el código o en la grabación.
- **[P] Propuesto:** decisión de diseño nuestra, pendiente de aprobación.
- **[?] Pendiente:** falta validarlo (legal, medición, prueba, cotización).

| Tema | Estado |
|---|---|
| Flujo de JobStep pantalla por pantalla | [V] grabación del 2026-11-14 (6 min 6 s, 1868×926) |
| Precio de JobStep | [V] en la grabación: suscripción, no pago único |
| Modelo de IA que usa JobStep | [V] su política de privacidad declara OpenAI (GPT-5); ver `research/ai-pricing-legal-2026-11-14.md` §C y doc 05 §8 |
| Página jobstep.io/features/resume/new y TikTok | [?] ver §4 (limitaciones de acceso) |
| Qué copiar, qué mejorar, qué descartar | [P] §3 |

> **Datos personales en la grabación.** El CV que aparece es de una persona
> real (nombre, foto, estudios, publicaciones) y el selector de cuentas de
> Google muestra correos reales. Ningún cuadro del video se guarda en el
> repositorio y ningún dato de esa persona aparece en estos documentos ni en
> el prototipo. Las pantallas se describen en texto con su minuto aproximado.

## 1. Flujo observado, pantalla por pantalla [V]

Tiempos aproximados (mm:ss). La grabación empieza con el cuestionario ya
abierto; no muestra la landing ni la carga inicial del archivo.

| # | Tiempo | Pantalla | Qué hace el usuario | Observación |
|---|---|---|---|---|
| 1 | 00:00 | «Tu currículum necesita trabajo» | Ve una puntuación **4/100**, etiqueta «Por debajo de la media» y barras por sección (Estructura 0 %, Datos 40 %, Resumen 0 %, Experiencia 17 %, Formación 28 %, Habilidades 34 %). Texto: las puntuaciones por debajo de 80 «suelen no superar los filtros ATS». | El CV ya se había subido antes del inicio del video. La afirmación sobre filtros ATS no tiene fuente visible. |
| 2 | 00:08 | «¿Con qué rapidez quieres encontrar empleo?» | Deslizador; elige «3 meses». | Una pregunta por pantalla, barra de progreso arriba, botón naranja fijo abajo. |
| 3 | 00:16 | «¿Qué te impide alcanzar tus objetivos?» | Opciones: no postulo lo suficiente / no consigo entrevistas / faltan buenas ofertas. | Pregunta de motivación, no cambia el CV. |
| 4 | 00:24 | «¿Dónde exactamente en Colombia?» | Campo de ciudad con autocompletado. | |
| 5 | 00:32 | «¿Qué puesto buscas?» | Texto libre con el cargo. | |
| 6 | 00:40 | «¿Qué tipo de contrato?» | Jornada completa / parcial / becario / freelance (selección múltiple). | |
| 7 | 00:48 | «¿Cuál es tu rango salarial esperado?» | Deslizador en COP. | |
| 8 | 00:56 | «Tienes un gran potencial…» | Gráfica de «entrevistas» que sube en 7 días / 14 días / 3 meses. | Gráfica sin datos explicados. |
| 9 | 01:04 | «Creando tu plan de 3 pasos…» | Espera con animación. | |
| 10 | 01:12 | «Consigue un puesto de … antes del [fecha]» | Gráfica «entrevistas esperadas» con la fecha objetivo. Sello de Trustpilot. | Promesa de resultado con fecha. |
| 11 | 01:20 | «Tu plan personal de 14 semanas» | Tres pasos: mejora tu CV, postula 6–8 puestos por semana, apunta a las empresas adecuadas. | |
| 12 | 01:28–01:45 | «Para Colombia, estas plantillas consiguen más entrevistas» | Carrusel de plantillas; elige «Clásico». | Afirmación de rendimiento sin fuente. |
| 13 | 01:52–02:00 | «¡Genial! Ahora tu currículum tiene un aspecto estupendo» | Vista previa del CV ya maquetado; selector de 5 colores; paginación 1/2. | Primer «momento mágico»: ve su CV con buen diseño. |
| 14 | 02:10 | «Encontramos 270 vacantes a tu medida» | Lista de vacantes con «82 % · Top Match»; de la segunda en adelante, borrosas. Botones «Continuar con Google» / «con email». | **Registro aquí.** Texto: «Al registrarte aceptas nuestra Política de Privacidad, Términos de Servicio y Política de Reembolsos». |
| 15 | 02:18 | Selector de cuentas de Google | Inicia sesión con Google. | |
| 16 | 02:26 | «¡Vamos a mejorar tu currículum paso a paso!» | Tres pasos: 1 Estructura, 2 Experiencia laboral, 3 Formación. | |
| 17 | 02:34– | Editor: pestañas «Chat IA» / «Estilo» a la izquierda, vista previa a la derecha, «Tu puntuación de currículum» arriba a la derecha. | La IA propone reordenar secciones (Experiencia → Formación → Habilidades → Idiomas → Publicaciones) con botones «Editar» y «Aceptar». | Propuesta visible antes de aplicar. |
| 18 | 02:50 | «Reordenación de secciones aprobada» | Etiqueta verde «Puntuación del CV +7». Vista previa actualizada; aviso «Actualizando vista previa». | Recompensa por puntos tras cada cambio. |
| 19 | 03:00–05:00 | Chat sobre la experiencia | La IA pregunta el cargo exacto, luego «qué haces, responsabilidad o logro», luego una cifra de volumen y su periodo, luego el tipo de trabajo. El usuario responde con palabras sueltas: un verbo, una cifra, un periodo, una especialidad. La IA escribe viñetas con verbo fuerte y cifra, y las muestra en la vista previa. | **Buen patrón:** la IA pregunta los datos y no los inventa. Las cifras salen del usuario. |
| 20 | 05:10 | «Iniciando chat y vista previa…» | Cambio a otra sección. | |
| 21 | 05:44–06:06 | **Muro de pago** «Empleos relevantes cada día» | Planes: **1 mes COP 18.900/mes** o **3 meses COP 12.300/mes** («Más popular», «Ahorra 35 %»). Botón «Desbloquear ahora». «Cancela cuando quieras». Ventajas: adaptar CV en segundos, plantillas ilimitadas, CVs y cartas ilimitados, seguimiento de postulaciones, puntuación completa, garantía de devolución del 100 %, atención 24/7. Prueba social: «532 personas eligieron este plan en 24 h», «120.000+ personas», «4,8 sobre 5». Medios: Apple Pay, Mastercard, Visa, PayPal, Klarna. | El usuario trabajó gratis ~5 minutos y el pago aparece al final. |

### Lo que la grabación **no** muestra [V]

- La landing, la carga del archivo y su validación.
- La pestaña «Estilo» en uso, el historial o deshacer.
- La exportación a PDF/DOCX ni qué se obtiene tras pagar.
- La adaptación del CV a una vacante concreta (solo la lista de vacantes con
  porcentaje de «match»).
- Ningún consentimiento separado para tratamiento de datos.

No se describe nada de eso como función de JobStep.

## 2. Precio de referencia: corrección de una premisa [V]

El encargo toma «unos COP 12.300» como precio de JobStep. En la grabación
**COP 12.300 es el precio mensual del plan de 3 meses**, es decir unos
COP 36.900 por adelantado si se cobra el trimestre completo [?: la grabación
no muestra el total cobrado]. El plan de un mes cuesta COP 18.900. Es una
**suscripción** con renovación («Cancela cuando quieras»), no un pago único
por CV.

Consecuencia para nuestro precio (doc 06 §9): se modelan las dos opciones,
pago único por desbloqueo de un CV y pase mensual, y se comparan contra
COP 12.300 y COP 18.900.

## 3. Qué reproducir, qué mejorar, qué descartar [P]

### Reproducir (aporta valor)

| Patrón de JobStep | Por qué |
|---|---|
| Trabajo gratis primero, pago al final | El usuario ve su CV terminado antes de pagar. Lo pide el propietario. |
| Una pregunta por pantalla con barra de progreso | Baja la carga cognitiva en móvil. |
| Vista previa del CV al lado del chat | Retroalimentación inmediata. |
| La IA **pregunta** cifras y logros en vez de inventarlos | Coincide con nuestra regla de no fabricar datos. |
| Propuesta → «Aceptar» / «Editar» antes de aplicar | Control del usuario sobre cada cambio. |
| Pocas plantillas, una recomendada | Evita parálisis de elección. |

### Mejorar

| Patrón de JobStep | Nuestra versión |
|---|---|
| Puntuación 4/100 sin explicación de fórmula | Puntuación con desglose, fórmula pública y evidencia de cada punto (doc 05 §4). Nunca «puntuación ATS». |
| «Match 82 %» con vacantes genéricas | Análisis contra **una vacante real** de BuscoTrabajo, requisito por requisito, con la frase del CV que lo demuestra o «no demostrado». |
| Aceptación de políticas en una sola frase al registrarse | Autorización de tratamiento separada, expresa, con finalidades y casilla sin marcar; aceptación de términos aparte (doc 07). |
| Chat que solo pregunta | Chat que distingue «mejorar redacción» de «cambiar hechos»; los hechos nuevos requieren confirmación explícita (doc 05 §5). |
| Suscripción con renovación | Pago único por CV, sin renovación automática [P, doc 06 §9]. |
| Sin «antes / después» | Comparación lado a lado con las diferencias resaltadas. |
| Registro con Google obligatorio para seguir | El borrador vive en el navegador hasta que el usuario decide guardarlo; registro con el sistema actual de BuscoTrabajo. |

### Descartar (no aporta valor o va contra nuestras reglas)

| Patrón | Motivo |
|---|---|
| «Puntuaciones por debajo de 80 suelen no superar los filtros ATS» | Afirmación sin fuente; el prompt maestro §E prohíbe presentarlo como puntuación oficial de ATS. |
| «532 personas eligieron este plan en 24 h» | Urgencia artificial no verificable. |
| Vacantes borrosas hasta registrarse | En BuscoTrabajo las vacantes son gratis y visibles sin condiciones. |
| Gráficas de «entrevistas esperadas» y fecha objetivo | Promesa de resultado sin datos. |
| «Estas plantillas consiguen más entrevistas en Colombia» | Sin evidencia. |
| Preguntas de motivación que no cambian el CV («qué te impide…») | No aportan al documento; alargan el onboarding. |
| Logos de empresas «donde fueron contratados nuestros clientes» | No verificable para nosotros. |

## 4. Referencias web y limitaciones

- `https://www.jobstep.io/features/resume/new` (consulta 2026-11-14): HTTP
  200, pero solo un cascarón «Dashboard | JobStep» con el logo; el contenido
  se pinta con JavaScript o exige sesión. **No se pudo leer.**
- Video de TikTok `@dani.trabaja/7707018090118237448` (2026-11-14): HTTP 200,
  solo el título genérico de TikTok; la descripción no está en el HTML.
  **No se pudo leer.**
- Por eso este análisis se basa solo en la grabación. No se atribuye a
  JobStep nada que no aparezca en ella o en su política de privacidad y su
  home (`jobstep.io/en/privacy`, `jobstep.io`, consultadas el mismo día:
  planes Gratis, Mensual y Trimestral; «Unlimited Downloads» solo en los de
  pago; proveedor de IA declarado OpenAI GPT-5; opera desde Zúrich; montos en
  euros no visibles en la versión /es).
- Alternativas revisadas (políticas de privacidad y subprocesadores
  publicados): ver doc 05 §8. No se usan como fuente de diseño visual.

## 5. Conclusiones para BuscoTrabajo [P]

1. El valor diferencial no es la plantilla bonita: es **adaptar el CV a una
   vacante real del sitio con requisitos explicados**. JobStep no lo muestra
   en la grabación.
2. El patrón «trabajo gratis → pago al final» se mantiene, pero sin urgencia
   falsa, sin puntuaciones «ATS» y sin bloquear vacantes.
3. El costo de IA por CV es bajo comparado con la comisión de pago (doc 06
   §9), así que el precio lo define sobre todo la pasarela, no el modelo.
