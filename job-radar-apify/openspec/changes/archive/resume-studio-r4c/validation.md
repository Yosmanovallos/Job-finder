# Validación: Resume Studio R4c

Fecha: 2026-11-23. Rama `codex/resume-studio-r4c`.

## 1. Prueba real (Qwen real, servidor local del propietario)

- **Servidor:** `npm run dev:resume-studio`, arrancado desde el worktree de R4c con `--env-file`. La base es desechable y se usó el login de desarrollo.
- **CV:** el PDF real del propietario (2 páginas, 5.582 caracteres), que no se copió al repo.
- **Vacante:** Workday de Amadeus, «QA Engineer», 6.617 caracteres.
- **Script:** vive fuera del repo e imprime solo códigos y conteos.
- **Prueba de que era el código de R4c:** `/tailor/start` aceptó `clientKey`. El esquema estricto de R4b lo rechaza con 400.

| Paso | Antes (R4b, 2026-11-22) | R4c |
|---|---|---|
| `/extract` | 502 `invalid_output` ×2 en 23 s (JSON cortado) | **200 en 10,8 s**. Salió: 6 experiencias, 26 viñetas, 2 estudios, 36 habilidades, 5 certificaciones, 2 idiomas, perfil y título. Descartados: 0. |
| Datos inventados en la extracción (`newClaims` contra el CV) | — | **0** |
| `/job-link` | 200 | 200 «QA Engineer», 6.617 caracteres |
| `/tailor/start` ×2 simultáneos, misma clave | 2 POST, cupo doble | 200 y 200, **mismo id, cupo usado 1 de 2** |
| Requisitos y puntaje | — | 12 requisitos (modelo, comprobados en la vacante); compatibilidad inicial 45 |
| Cola de tarjetas | — | título, habilidades, 5× «¿Dónde hiciste esto?», resumen |
| Tarjeta de título | — | `proposal` (1,4 s) |
| Mapeos respondidos (2) | — | 1 `proposal` (1,3 s); 1 `discarded` por el validador (3,0 s) |
| Tarjeta de resumen | — | `proposal` (4,5 s) |
| Datos inventados en la hoja de vida final (contra el CV + las respuestas) | — | **0** |

- **Respuestas en los mapeos:** se usaron palabras del propio propietario, tomadas de una viñeta de su CV en esa experiencia. El script no inventa experiencia.
- **«No literales»:** 9 textos de la extracción aparecen como «no literales» en el chequeo del script. Son exactamente las 2 formaciones, los 2 idiomas y las 5 certificaciones. `factTexts` las une como «título · institución», «idioma nivel» y «nombre · emisor», y esa unión no es una subcadena del CV. Cada parte por separado sí sale del CV (`literal()` en `extractCvFacts`).

### 1.1 Tercera y cuarta corrida (servidor reiniciado, solo datos ciertos)

- **Qué cambió en el script:**
  - Marca una habilidad solo si el mismo verificador de la auditoría (`newClaims` contra el CV) no encuentra nada nuevo.
  - Responde cada requisito con la viñeta del CV que más coincide.
  - Si ninguna coincide, responde «En ninguna».
- **Extracción:** 200 en 9,9 s, con los mismos conteos. Inicio duplicado: mismo id.
- **Habilidades:**
  - La vacante ofreció Java, Jenkins y Office; se marcaron 0, porque el CV no las respalda como habilidad.
  - En la corrida 3, el script usó una comparación por subcadena y marcó 1. La auditoría final la detectó como 1 «skill» inventada.
  - **El fallo era del script, no de la IA.** Se corrigió y la corrida 4 dio 0.
- **Tarjetas (corrida 4):**

| Tarjeta | Resultado |
|---|---|
| Título | `proposal` |
| Mapeos 1/5 y 2/5 | `proposal` |
| Mapeo 3/5 | `question` (el validador pidió el dato) |
| Mapeo 4/5 | sin coincidencia en el CV → «En ninguna» |
| Mapeo 5/5 | `discarded` |
| Resumen | `proposal` |

  - Total: 4 propuestas, 1 pregunta y 1 descartada; 4 preguntas respondidas.
- **Datos inventados en el CV final:** **0**.
- **Puntaje 45 → 45.** Las respuestas solo pueden reutilizar texto que ya estaba en el CV, así que no agregan evidencia para requisitos que no estaban cubiertos. El puntaje sube cuando la persona aporta información nueva y cierta: en la revisión con la IA mock, una respuesta nueva subió la compatibilidad de 88 a 97. Un agente no puede aportar esa información sin inventarla.
- **Pendiente para el propietario:** hacer una adaptación desde el navegador en `/hoja-de-vida` con sus propias respuestas.

## 2. Revisión en el navegador (servidor local con IA mock)

Hecha a 1280 px y 375 px, con datos sintéticos. Las capturas están en [`screens/`](screens/).

- **Inicio:** solo autorizaciones (la primera vez), vacante (link o texto) y hoja de vida (guardada o PDF/Word). Sin precios, sin editor y sin barra de botones. Sin scroll horizontal a 375 px (`scrollWidth` 375).
- **Agente:** pasos de carga y puntaje (88 → 97 en el ejemplo). Las tarjetas salen una por una: título, habilidades, «¿Dónde hiciste esto? 1/1» con texto libre y viñeta en verde, y resumen. El CV se ve en vivo, con pestañas en móvil.
- **Peticiones:** se hizo **1** `tailor/start` y **1** `tailor/card` por tarjeta.
- **Mock adversarial:** inventó «duplicando las ventas» y «Senior». El validador lo convirtió en pregunta o lo descartó; nada se aplicó.
- **Pase:** solo aparece al pulsar «Descargar mi hoja de vida», en un diálogo. En móvil es una hoja inferior.
- **Diálogo:** Esc lo cierra y el foco vuelve al botón que lo abrió.
- **«Más opciones»:**
  - Menú con teclado: flechas, Esc y Tab.
  - Opciones: editar a mano, mis postulaciones, versiones, exportar, autorizaciones, borrar todo y revocar.
  - «Borrar todo» abre un diálogo propio de confirmación.
- **`window.confirm`/`alert`/`prompt` en `src/`:** **0**.

## 3. Header

- **Bandera apagada:** el SSR de la home (`renderHomeAppHtml("/")`) es idéntico byte a byte con el `Header.tsx` de antes (71.442 bytes).
- **Bandera encendida:** sale 1 enlace `/hoja-de-vida` en lugar de `/preguntas`.
- **T-FREE:** ahora acepta esa única diferencia con la bandera encendida y exige 0 con la bandera apagada.
- **Hash del CSS global:** sin cambios, `1d7ac0969c32df8a…`.
  - Se quitaron 3 clases que se habían colado: `ease-out`/`ease-in-out` (texto del CSS propio), `max-h-[60vh]` y `md:text-left`.

## 4. Gates (2026-11-23, HEAD de la rama)

| Gate | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ |
| `npm run build` | ✅. CSS `index-BeuqwIzT.css`, hash `1d7ac0969c32df8a…` (igual que R4b). |
| `npm run test:unit` | ✅ (exit 0) |
| `npm run test:integration` | ✅ (exit 0) |
| `npm run test:resume-studio` | ✅ 53 suites `PASSED`, incluidas R4c (5 inicios simultáneos = 1 cupo; reintento tras reinicio sin cobro) y T-FREE |

- **Falso positivo de `validate-job-seo-v2`:** fallaba cuando `public/` venía del build del lanzador local (bandera y login de desarrollo). Con `npm run build` normal pasa, igual que en R4b.
- **Orden para las gates:** correr siempre `npm run build` antes de las pruebas de integración.

## 6. Tarjetas: «la IA propone, tú apruebas» (2026-11-24/25)

Lo pidió el propietario tras probar las tarjetas: nunca una caja vacía, y cada propuesta debe estar sustentada.

### Qué cambió

| Pedido | Implementación |
|---|---|
| Antes/después, requisito, evidencia, por qué | Cada propuesta muestra el requisito de la vacante, «Antes» frente a «Después · dónde va», «Se apoya en» con la viñeta exacta del CV y su experiencia (o tu respuesta), «Por qué» y el cambio de compatibilidad. |
| «Editar» precargado | Se abre con la propuesta, el borrador descartado, el texto actual o la mejor viñeta del CV. Nunca vacío. |
| «no», «nada», «-» | `answerProblem`: lo negativo cuenta como «sin esa experiencia» y no se escribe nada; lo demasiado corto pide una frase. La confirmación aparece en el feed. |
| «Descartar» | Ahora se llama «No cambiar nada». Tiene explicación y confirmación no bloqueante en el feed; 0 `window.confirm`. |
| «✨ Mejorar con IA» / datos precalculados | Está en toda edición. Las tarjetas sin evidencia ofrecen «✨ Redactar solo con mi CV» y «← Elegir otra experiencia». Además, «Según las fechas de tu CV: ~X años» con «Usar este dato» (`yearsFromCv`). |
| Verificado o sin evidencia + puntaje | El sello «✓ Verificado con tu CV» o «Sin evidencia en tu CV: no se aplica nada», más «Compatibilidad: A → B» en cada propuesta y en las habilidades marcadas. |
| «¿Dónde hiciste esto?» | La acción principal es «✨ Que la IA lo redacte» (`card_draft@2`: solo con los hechos de esa experiencia). «Lo cuento yo» abre con la viñeta del CV que más coincide. |

### Defectos hallados con Qwen real y corregidos

1. **`card_chat` daba 502 cuando el CV no tenía nada que sirviera.** El texto vacío no pasaba el esquema. Desde v3 vale `text` vacío con `reply`, y se muestra como respuesta honesta.
2. **El borrador repetía una viñeta que ya existía, y aplicarlo la duplicaba.** Ahora `applyBullet` la sube al primer lugar, y la tarjeta dice «Ya está en tu CV: no se duplica, solo sube».
3. **El perfil salía en español con un CV en inglés.** `card_summary@4` escribe en el idioma del CV y puede usar las cifras del propio perfil.
4. **Una pregunta del modelo filtró jerga interna** («hechos [experience]», «instrucción»). Esas preguntas se reemplazan por una pregunta clara.
5. **Las fechas se perdían.** Solo se aceptaba «2023-01» literal, y los CV escriben «Jan 2023». `sourcedMonth` acepta la fecha si el CV muestra ese año con ese mes (nombre, abreviatura o número); si no, la deja vacía. Resultado: 6 de 6 experiencias con fecha, y «~5 años» calculado.
6. **El resumen usaba 381 de 400 tokens.** El tope sube a 600.

### Prueba en el navegador con Qwen real (CV del propietario, vacante de Amadeus, 1280 y 375 px)

- **Extracción:** 200; 6 experiencias (las 6 con fecha), 25 viñetas, 36 habilidades; 0 descartados.
- **Recorrido completo sin escribir en ninguna caja vacía:**
  - Título: verificado.
  - Habilidades: «No tengo ninguna» (el agente no marca nada por el usuario).
  - 5 requisitos: 3 verificados con la IA y aplicados; 2 sin evidencia, que se redactaron solo con el CV y siguieron sin evidencia, así que quedaron con «No cambiar nada».
  - Resumen: sin evidencia → «Según las fechas de tu CV: ~5 años» → «Usar este dato» → verificado y aplicado.
  - Total: 5 cambios aplicados y 3 sin cambio.
- **«no» escrito en «Editar»:** no entró al CV. El feed dice «Sin esa experiencia: no se escribió nada».
- **Hoja de vida final:** 0 líneas «no», «nada» o «-»; 0 líneas duplicadas.
- **Puntaje 50 → 50:** los borradores reutilizan lo que el CV ya probaba. El inicio pasó de 47 a 50 porque ahora cuentan las fechas.
- **Capturas:** las de esta prueba tienen datos del propietario. Se guardaron FUERA del repo, en la carpeta de notas compartida de la sesión. Las del repo usan datos sintéticos.

### Hallazgo extra en la revisión con mock (corregido)

En una tarjeta «sin evidencia», «Editar» se abría con el borrador DESCARTADO, que traía la cifra inventada del mock («reduciendo los defectos un 40%»). Un clic en «Aplicar mi texto» lo habría metido al CV. Ahora la edición solo se precarga con texto verificado: la propuesta aceptada, el texto actual o la viñeta del CV (captura `desktop-11-editar-precargado.jpg`).

Capturas con datos sintéticos de estas tarjetas: `screens/desktop-8` … `desktop-11`.

### Gates (2026-11-25)

- tsc ✅
- build ✅ (CSS `1d7ac0969c32df8a…`, igual)
- test:unit ✅
- test:resume-studio ✅ (53)
- test:integration ✅
  - Primera corrida: `validate-sitemap-streaming` falló por el tope de memoria (heap +69 MB con el servidor y Docker cargados); solo pasó con +55 MB.
  - Segunda corrida completa: ✅.
