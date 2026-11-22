# Resume Studio R4c: el flujo como JobStep, y la IA con un CV real

**Estado:** en curso (2026-11-22).
**ADR:** [`docs/adr/0017-resume-studio-implementation.md`](../../../docs/adr/0017-resume-studio-implementation.md).
**Rama:** `codex/resume-studio-r4c`, cortada de `codex/resume-studio-r4b`
(PR #152, `ca8387a`), con `codex/resume-studio-r3` (`1751c8e`) integrada
porque R4/R4b se cortaron antes del ajuste con Qwen real (prompts v2,
temperatura 0, esquema tolerante). El PR va en borrador contra
`codex/resume-studio`. Nada va a `main` ni a Supabase.
**Guías:** doc 11 §1 y §1.1 (el video de JobStep, pantalla por pantalla);
prototipo `docs/resume-studio/mockups/resume-tailor-link-prototype.html`;
`docs/DASHBOARD-PERFORMANCE-RUNBOOK.md` para el header.

## Problema

El propietario probó R4b en local:

1. **La IA falló al leer su CV.** `/api/resume/extract` con un CV real de
   2 páginas (5.582 caracteres) respondió 502 `invalid_output` dos veces.
   `cv_extract` pedía una `quote` literal por cada campo y cada viñeta, así
   que la respuesta repetía el CV dos veces y no cabía en
   `maxOutputTokens: 2500`: el JSON llegaba cortado.
2. **`/tailor/start` se disparaba dos veces por clic** (dos POST en el mismo
   segundo, el doble efecto de React en desarrollo). Cada uno consumía cupo.
3. **El flujo está desorganizado.** Precios, editor gigante y 8 botones
   arriba de la pantalla, `window.confirm` que bloquean, y el pase aparece
   antes de ver el resultado. JobStep hace lo contrario: link + CV →
   agente con tarjetas → pago solo al descargar.
4. El header dice «Preguntas» donde el propietario quiere «Hoja de vida».

## Alcance

### 1. IA

- **`cv_extract@3`:** anclas en vez de copias. Para el perfil y cada viñeta
  el modelo devuelve `start`/`end` (primeras y últimas 5–10 palabras,
  ≤ 80 caracteres); el **código** copia el texto del CV entre ellas
  (`sliceBetween`), así que el texto es literal por construcción. Si el
  ancla final no está, la copia llega al fin de la línea: un final
  inventado no agrega nada. Los campos cortos (cargo, empresa, habilidad…)
  se comprueban como subcadena del CV; los que no están se descartan y se
  informan. Respuestas con la forma vieja (`text`/`quote`) siguen sirviendo.
- `maxOutputTokens` 2500 → 4000 y `timeoutMs` mínimo 60 s solo para esta
  llamada. Peor caso ≈ USD 0,0005; sigue bajo el tope por adaptación.
- **Diagnóstico sin contenido:** una línea JSON por llamada (`promptId`,
  versión, intento, resultado, `finish_reason`, tokens de salida, largo de
  la respuesta en caracteres, latencia). Nunca texto del CV ni de la vacante.
- **`/tailor/start` idempotente:** el navegador crea un UUID al hacer clic
  (`clientKey`); el id de la adaptación se deriva de (usuario, clave). Las
  peticiones repetidas comparten la misma respuesta en memoria, y un índice
  único parcial `uq_rs_ai_usage_start` (aditivo) hace atómico el «claim»:
  el cupo se consume una sola vez, también tras un reinicio. Si el cupo se
  niega, el claim se deshace.

### 2. Flujo (móvil y PC)

- `/hoja-de-vida` empieza **solo** con: «Pega el link de la vacante» (o el
  texto) y «Tu hoja de vida» (subir PDF/DOCX o usar la guardada), más las
  autorizaciones mínimas. Sin precios, sin editor, sin barra de botones.
- Pantalla del agente: pasos «Leyendo la vacante → Comparando → Preparando
  sugerencias», puntaje y tarjetas una por una (título, habilidades,
  «¿Dónde hiciste esto? N/M» con texto libre y viñeta en verde, resumen),
  con el CV en vivo al lado (pestañas en móvil).
- **El pase aparece solo al final**, al pulsar «Descargar», en un diálogo.
- Editor manual, versiones, exportar, borrar, autorización y revocar pasan
  a un menú secundario «Más opciones».
- Cero `window.confirm`/`alert`/`prompt`: diálogo propio (`<dialog>` nativo,
  Esc, foco atrapado y devuelto, hoja inferior en móvil).
- Hash del CSS global sin cambios: solo clases que ya existen, estilos en
  línea o un `<style>` dentro del chunk perezoso de `/hoja-de-vida`.

### 3. Header

- «Preguntas» → «Hoja de vida» (`/hoja-de-vida`) solo con
  `RESUME_STUDIO_ENABLED=true`. En el servidor (SSR de la home) se lee del
  entorno; en el navegador, de una constante de compilación
  (`__RS_NAV__`) que Vite fija con la misma variable. Con la bandera
  apagada el HTML del header queda idéntico byte a byte.

## Fuera de alcance

- Precios, cupo gratis y textos legales (D2/D4): decisiones del propietario.
- Migraciones en Supabase y despliegue: R5.
- LinkedIn sigue siendo solo «pegar el texto».

## Decisiones abiertas para el propietario

- Si se acaba el cupo gratis al **empezar** una adaptación, hoy responde 402
  con un enlace al pase: es el único caso en que el pase aparece antes del
  final. ¿Se deja así o se permite terminar sin IA?
- Quitar «Preguntas» del header cambia el enlazado interno hacia
  `/preguntas` (SEO). Revisarlo antes de R5.
