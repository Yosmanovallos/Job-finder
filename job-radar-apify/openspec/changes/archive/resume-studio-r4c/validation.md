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
