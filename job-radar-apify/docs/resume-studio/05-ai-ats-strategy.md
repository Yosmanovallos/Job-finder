# 05 — AI & ATS Strategy

**Fecha:** 2026-11-14 · **Marcas:** [V] verificado · [P] propuesto · [?] pendiente

Fuente de precios y términos: `research/ai-pricing-legal-2026-11-14.md` (investigación
de esta fase, consultado 2026-11-14, URL oficial y fecha en cada dato). Las
cifras se leyeron a través de resúmenes de páginas oficiales: **volver a abrir
cada URL antes de contratar**.

| Tema | Estado |
|---|---|
| Qué usa JobStep | [V] su política de privacidad declara OpenAI (GPT-5), sin entrenamiento según su acuerdo (`jobstep.io/en/privacy`, vigente desde 2025-01-15) |
| Precios de modelos | [V] páginas oficiales, ver §7 |
| Proveedor recomendado | [P] §7.3, condicionado a la revisión legal del doc 07 |
| Fórmula de puntuación | [P] §4, implementada en el prototipo y probada (57 → 83 con el caso sintético) |
| Calidad real de extracción y sugerencias | [?] requiere evals con CV sintéticos (doc 09) |

## 1. Dónde se usa IA y dónde no (AGENTS.md regla 4) [P]

| Tarea | Método | Por qué |
|---|---|---|
| Validar archivo, tipo, tamaño, páginas | Código | Determinista |
| Extraer texto de PDF/DOCX | Código (librería de parseo, doc 06 §5) | Determinista |
| Separar el texto en secciones y campos (JSON) | **LLM** con esquema JSON estricto | El formato de los CV varía demasiado para reglas |
| Detectar requisitos en la vacante | Primero `requirements[]` y `technologies[]` que ya trae la vacante; LLM solo si vienen vacíos y hay `description` | Muchas vacantes ya traen la lista |
| Clasificar obligatorio / deseable | Reglas por palabras («mínimo», «indispensable», «se valorará», «deseable») + LLM como desempate | Explicable |
| Decidir si un requisito está demostrado | **LLM** propone evidencia (cita literal del CV); **código** verifica que la cita existe en el CV | La IA no puede marcar «demostrado» sin una cita real |
| Puntuación | **Código** (§4) | Reproducible |
| Reescribir redacción | **LLM** | Tarea semántica |
| Proponer preguntas por requisitos faltantes | **LLM** con plantilla | — |
| Validar que la propuesta no agrega hechos | **Código** + LLM verificador (§5) | Defensa en profundidad |
| Comprobaciones de legibilidad | Código | Determinista |

## 2. Extracción del CV [P]

1. Texto plano por código. Si el PDF no tiene capa de texto (escaneado): se
   rechaza con mensaje claro. **Sin OCR en el MVP** (costo y errores).
2. LLM → JSON con esquema Zod (`ResumeFacts`): contacto, resumen, experiencias
   (cargo, empresa, ciudad, inicio, fin, viñetas), formación, habilidades,
   idiomas, certificaciones. **Cada campo lleva `source_span`** (texto exacto
   del que salió).
3. Código comprueba que cada `source_span` aparece en el texto original. Si no
   aparece, el campo se descarta y se pide al usuario.
4. Fechas que no se pueden leer → `null` y pregunta al usuario (pantalla S4).
   Nunca se completan.
5. Datos sensibles que no hacen falta (foto, documento, estado civil, edad,
   religión, salud, afiliación política): se detectan por patrón y se
   **excluyen del documento y del análisis**, con aviso.

Patrón heredado del CV Generator retirado: «cada frase generada lleva
`supporting_fact_ids`; el validador de factualidad bloquea afirmaciones sin
evidencia» (AGENTS.md, Fase 8 del monorepo). Se reutiliza la idea, no el código.

## 3. Análisis de la vacante [P]

- Entrada: `title`, `description`, `requirements[]`, `technologies[]`,
  `employmentType` de la vacante (forma en `src/sources/types.ts:4-47` [V]).
- Si `description` es `null` y `requirements` está vacío (caso frecuente en
  Computrabajo [V: 2 de 3 vacantes de la muestra del 2026-11-14]), **no hay
  análisis de compatibilidad**: solo revisión general del CV.
- Salario: se muestra como información; nunca se compara con el CV.
- Se guarda una **foto** de la vacante (texto + fecha) con el análisis, porque
  la vacante puede cambiar o vencer.
- El texto de la vacante es contenido externo no confiable (AGENTS.md regla 6):
  va entre delimitadores y el prompt dice que es dato, no instrucción (doc 08 §3).

## 4. Puntuación transparente [P]

**Nombre en la interfaz:** «Compatibilidad estimada». **Nunca** «puntuación ATS».

| Componente | Peso | Cálculo |
|---|---|---|
| Requisitos obligatorios | 40 | Reparte 40 entre los obligatorios. Demostrado = 100 %, Parcial = 50 %, No demostrado = 0 |
| Requisitos deseables | 15 | Igual, entre los deseables |
| Habilidades listadas por la vacante | 20 | Proporción de `technologies[]` que aparecen en el CV (sinónimos controlados) |
| Legibilidad y estructura | 15 | 5 comprobaciones × 3: resumen de 2–4 líneas, viñetas con verbo, fechas consistentes, contacto completo, una columna sin tablas/imágenes |
| Resumen enfocado | 10 | Nombra el área del cargo (5) y ≥ 2 tareas de la vacante (5) |

Reglas:

- Si la vacante no tiene obligatorios/deseables identificables, el peso se
  redistribuye y se dice en pantalla.
- Misma entrada → misma salida: el LLM solo produce las citas de evidencia; el
  número lo calcula el código. Las citas se guardan, así que recalcular no
  vuelve a llamar al modelo.
- **Variables prohibidas:** edad, sexo/género, foto, estado civil, nacionalidad,
  dirección exacta, origen étnico, religión, discapacidad, salud, afiliación
  sindical o política. No se envían al modelo ni entran en el cálculo.
- Texto fijo bajo la cifra: «Estimación de BuscoTrabajo con una fórmula
  pública. No es el puntaje de ningún ATS y no garantiza entrevistas.»
- Evaluación del propio modelo de puntuación: el doc 09 §4 define un conjunto
  de pares CV-vacante etiquetados a mano para medir acuerdo con evaluadores
  humanos antes del lanzamiento.

Caso sintético del prototipo (vacante real Alz Energy): base **57** (25 / 7,5
/ 10 / 9 / 5) → tras 4 sugerencias aceptadas **83** (40 / 7,5 / 10 / 15 / 10).
El requisito de IA queda «No demostrado» porque la usuaria respondió que no.

## 5. Sugerencias sin fabricar datos [P]

Cada propuesta del modelo es un objeto:

```
{ id, section, kind: "rewrite" | "new_fact" | "reorder" | "remove",
  before, after, supporting_fact_ids[], requirement_id?, question? }
```

- `rewrite` / `reorder`: solo puede usar hechos con `supporting_fact_ids`
  existentes. Validador por código: números, fechas, nombres propios,
  herramientas y títulos del `after` deben existir en los hechos citados. Si
  aparece uno nuevo → la propuesta se convierte en `new_fact` o se descarta.
- `new_fact`: nunca trae el dato. Trae una **pregunta**. El dato lo escribe el
  usuario; el modelo solo lo redacta y el usuario confirma el resultado.
- Una respuesta «No» deja el requisito «No demostrado» y la sugerencia se
  archiva. No se vuelve a insistir en la misma sesión.
- Verificador LLM opcional (segunda llamada barata) en las propuestas
  `rewrite` de más de 2 líneas: «¿el texto nuevo afirma algo que no está en
  los hechos?». Si dice sí, se descarta.

## 6. Plantillas ATS-friendly [P]

No hay compatibilidad universal: cada ATS extrae distinto. Principios
ampliamente recomendados para facilitar la extracción de texto: una columna,
encabezados de sección estándar («Experiencia», «Formación», «Habilidades»),
texto real (no imágenes), sin tablas ni cuadros de texto para el contenido,
fuentes de sistema, fechas en un formato, PDF con texto seleccionable o DOCX.
[?: estos principios vienen de guías de la industria, no de una fuente
normativa; validar con pruebas de extracción propias, doc 09 §3.]

| Plantilla | Para quién | Ventajas | Limitaciones | MVP |
|---|---|---|---|---|
| Clásica ATS (cronológico inverso) | Mayoría | Orden esperado por reclutadores | Sobria | Sí |
| Compacta | Mucha experiencia | Cabe en 1–2 páginas | Letra más pequeña | Sí |
| Primer empleo | Sin experiencia | Formación y proyectos primero | No sirve con 2+ años de experiencia | Sí |
| Funcional | Cambios de carrera | Destaca habilidades | Muchos reclutadores desconfían; oculta cronología | No |
| Híbrida | Perfiles mixtos | Habilidades + cronología | Más larga | Después |
| Tecnológica | TI | Sección de proyectos/stack | Requiere enlaces | Después |
| Ejecutiva | Directivos | Logros arriba | Pocos usuarios del sitio | No |
| Académica | Docentes/investigación | Publicaciones | Larga; nicho | No |
| Dos columnas / con foto | — | Estética | Extracción desordenada en algunos ATS; foto invita a sesgos | No |

## 7. Proveedor de IA

### 7.1 Supuestos de tokens por CV completo [P]

| Etapa | Llamadas | Entrada (tokens) | Salida (tokens) |
|---|---|---|---|
| Extracción del CV (sistema 1.500 + CV 2.500) | 1 | 4.000 | 2.500 |
| Chat de edición (12 turnos; sistema + CV + historial ≈ 6.000) | 12 | 72.000 | 3.600 |
| Análisis vs. vacante (sistema + CV + vacante) | 1 | 6.000 | 1.500 |
| Sugerencias + verificador | 1 + 1 | 6.000 | 2.000 |
| **Total escenario medio** | 16 | **88.000** | **9.600** |
| Escenario pesado (×3: más turnos, reintentos) | ~48 | 264.000 | 28.800 |

Estos números son supuestos de diseño, no mediciones. Se reemplazan por los
del ledger de costos tras la beta (doc 10, R3).

### 7.2 Costo de IA por CV [V precios · P cálculo]

| Modelo (precio oficial USD/1M entrada / salida) | Medio | Pesado | ¿Viable legalmente? (doc 07) |
|---|---|---|---|
| Gemini 2.5 Flash-Lite en **Vertex AI, región EE. UU.** (precio de la API: 0,10 / 0,40; precio en Vertex [?] por confirmar) | USD 0,0126 | 0,038 | Sí, con contrato de transmisión; región fijable; EE. UU. está en la lista de la SIC |
| Gemini 2.5 Flash-Lite, **Gemini API de pago** (0,10 / 0,40) | 0,0126 | 0,038 | [?] La región **no se puede fijar** («Google global») [V research §B]; el argumento de país adecuado queda débil |
| Gemini 3.1 Flash-Lite, pago (0,25 / 1,50) | 0,036 | 0,109 | Igual que arriba |
| OpenAI gpt-5-nano (0,05 / 0,40) | 0,0082 | 0,025 | Sí, igual; es lo que declara JobStep (familia GPT-5) |
| Claude Haiku 5.5 (0,10 / 0,50, prompts ≤ 100K) | 0,0136 | 0,041 | Sí, igual |
| Groq gpt-oss-20b (0,075 / 0,30), ZDR activable | 0,0095 | 0,029 | Sí, igual; entrenamiento [?] no verificado |
| Qwen Flash, Singapur (0,05 / 0,40) | 0,0082 | 0,025 | Solo con autorización expresa o declaración de conformidad SIC (Singapur no está en la lista) |
| GLM-4.5-Flash, Z.ai (gratis) | 0 | 0 | Igual que Qwen; además, gratis no trae garantías contractuales |
| DeepSeek flash (0,15–0,30 / 0,60–1,20) | — | — | **No**: almacena en China y puede entrenar |
| Gemini **free tier** | — | — | **No**: sus términos piden no enviar datos personales y pueden usarse para mejorar productos |
| Kimi K2 | — | — | **No**: no admite usuarios nuevos desde 2026-10-31 y entrena |

Con la TRM supuesta de **COP 4.000/USD** [?: actualizar con la TRM del día],
el escenario medio cuesta **COP 33–146** por CV y el pesado **COP 100–436**.

### 7.3 Recomendación [P]

**Gemini 2.5 Flash-Lite en Vertex AI con región de EE. UU. fijada** (no el
endpoint global; retención cero disponible), con **gpt-5-nano** como alternativa de
respaldo detrás de un alias (patrón de gateway con alias, presupuesto y ledger
del monorepo, Fase 5). Motivos, en orden:

1. Legal: procesamiento en una región de EE. UU. que se puede fijar (país
   con nivel adecuado según Circular SIC 005/2017 [V, vía normograma de
   Cancillería]), sin entrenamiento, caché ≤ 24 h, DPA de Cloud [?: no
   verificado en esta investigación]. La Gemini API directa no permite fijar
   región, por eso queda como opción [?].
2. Costo: ~USD 0,013 por CV medio.
3. Riesgo: Gemini 2.5 Flash se depreca el 2026-12-01 [V]; Flash-Lite 2.5 no
   tiene fecha publicada [?]. Planear migración a 3.1 Flash-Lite (×3 de costo,
   sigue siendo < COP 150 por CV).

No se usa ningún nivel gratuito con datos de usuarios reales.

## 8. Benchmark de proveedores en herramientas similares [V]

Según sus políticas de privacidad publicadas (consulta 2026-11-14): JobStep →
OpenAI (GPT-5); Teal → Claude vía OpenRouter y Bedrock con retención cero;
Kickresume → OpenAI y Anthropic; Resume Worded → OpenAI, Gemini y Anthropic;
Enhancv → OpenAI; Rezi → no lo divulga; Huntr → la página no cargó. Ninguno
usa proveedores chinos según lo publicado.
