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

## 4. Gates

Se llenan con la última corrida; ver la sección 5.

## 5. Gates (última corrida)

PENDIENTE
