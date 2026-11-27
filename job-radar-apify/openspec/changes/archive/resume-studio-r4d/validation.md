# Validación: Resume Studio R4d

Copias de interfaz del informe: **propuesta no probada con usuarios** (validar
con 5–8 personas antes de fijarlas).

## 1. Prueba real (Qwen, local, base desechable)

`npm run dev:resume-studio` (Postgres desechable en Docker, Wompi sandbox),
vacante pública de Amadeus (Workday, «QA Engineer»), CV real del propietario
cargado por script que solo imprime códigos y conteos. Nada del CV real en el
repo; sus capturas quedaron fuera del repo.

| Paso | Resultado |
|---|---|
| `/import` + `/extract` | 200 en ~9 s; idioma detectado **en**; 6 experiencias, 25–26 viñetas, 36 habilidades, 0 descartes |
| Inicio | «Tu hoja de vida está en inglés: haremos todos los cambios en inglés.» |
| Herramientas | 4 tarjetas, una por una, antes de redactar: Jenkins, Splunk, Robot Framework, Java (Git, Postman, Python, SQL ya estaban). «Office» de «our Bogota office» ya no aparece |
| Jenkins → Algo parecido | ofrece Azure DevOps (está en el CV), «No escribimos Jenkins» |
| Splunk → Sí + frase **en español** | viñeta **en inglés** («Reviewed script logs in Splunk to identify failures.»), sello «Basado en lo que nos contaste» |
| Robot Framework → No | nada escrito; queda en «Lo que la vacante pide y tu hoja de vida no muestra» |
| Java → Sí, en un curso, sin frase | solo Habilidades |
| Mapeo «Jenkins, Git, Splunk…» | «Pide Jenkins, Splunk, que tu hoja de vida no muestra. No los escribimos por ti» |
| «distributed systems» | sin «~X años» (0 de 5 tarjetas de mapeo mostraron años) |
| Chat «agrega que tengo 10 años liderando equipos» | «Ajustando…» en el lugar del botón a los 50 ms; respuesta «No lo agregamos…»; nada aplicado |
| «✨ Redactar solo con mi CV» | «Redactando con tu experiencia…» en el botón a los 60–80 ms; resultado en su lugar |
| Perfil | primero `unknown_fact` (cita a un id inexistente) → corregido (§3); luego perfil en inglés verificado |
| Vista previa final | títulos Profile/Experience/Education/Skills/Languages, fechas «Mar 2021 – Present»; 0 palabras en español |
| `card_chat` | `finish_reason: length` a 400 tokens con un perfil en inglés → tope 700 |

Hecho en 1280 px y en 375 px. Las respuestas de prueba (Splunk, Java…) las
escribió la sesión, no el propietario: son solo para recorrer el flujo.

## 2. Capturas sintéticas (`screens/`)

CV sintético «Alex Example» (inglés), misma vacante pública de Amadeus:

1. `desktop-1-herramienta-jenkins.jpg`: «¿Has usado Jenkins?» Sí / Algo parecido / No.
2. `desktop-2-si-donde-y-frase.jpg`: dónde + frase opcional, antes/después de Habilidades, +2.
3. `desktop-3-vineta-en-ingles-lo-que-contaste.jpg`: frase en español → viñeta en inglés, «Basado en lo que nos contaste».
4. `desktop-4-que-falta-y-herramientas.jpg`: «Tu CV no lo muestra…» + «Esta parte también pide…».
5. `desktop-5-boton-redactando.jpg`: spinner y verbo en el propio botón.
6. `desktop-6-respuesta-en-lugar-del-boton.jpg`: «Tampoco con tu CV…» en el lugar del botón, una sola fila de acciones.
7. `desktop-7-final-lista-de-huecos.jpg`: pantalla final con la lista de huecos.
8. `mobile-1-herramienta-jenkins.jpg`, `mobile-2-si-donde.jpg`: lo mismo a 375 px.

El aviso de 10 s con Cancelar no se vio en vivo (Qwen respondió en 1–3 s);
lo cubren las pruebas `R4D-BUSY`.

## 3. Decisión: ids citados inexistentes en título y perfil

En título y perfil las fuentes del validador son **todo** el CV, sin importar
qué ids cite el modelo; los ids solo eligen la línea que se muestra como
evidencia. Por eso ahí un id inexistente se **descarta** (con un registro sin
contenido: `unknownIdsDropped`) en vez de tirar la propuesta, y `[b-1]` se lee
como `b-1`. Cada dato del texto lo sigue revisando `validateProposal`. En las
viñetas (`draft`, `rewrite`) la regla estricta no cambia: un id inexistente
descarta. Prueba: `R4D-CITED`.

## 4. Gates

tsc 0 errores; build OK con hash CSS `1d7ac0969c32df8a…` sin cambios;
test:unit 740/0; test:resume-studio 53 ✅ 0 ❌ (y 127 unitarias); test:integration
286 ✅ 0 ❌. La aserción R3 «headline primero» se actualizó: ahora van primero
las tarjetas de herramientas.

## 5. Pendiente / fuera de alcance

- El modelo a veces escribe el «Por qué» en inglés; la app ya no lo muestra si
  no se lee como español.
- Preguntar el idioma cuando vacante y CV difieren (hoy se informa y se usa el
  del CV).
- P1/P2 del informe.

## 6. Links de vacantes: microdata y texto visible (2026-11-27)

El propietario pegó un link de Scotiabank (SAP SuccessFactors) y salió «No
encontramos los datos de la vacante». La página respondía 200 y declaraba la
vacante como schema.org JobPosting en **microdata** (`itemprop`), no en
JSON-LD, que era lo único que se leía.

- `job-link/microdata.ts`: lee JobPosting en microdata (título, descripción,
  empresa, ciudad, fecha), solo lo que la página declara.
- `job-link/page-text.ts`: último intento automático con el texto visible,
  solo si se lee como vacante (≥ 2 secciones típicas, 400–20 000 caracteres,
  sin menús ni pie, empezando en el título). Nunca en páginas anti-bot.
- Orden: JSON-LD → microdata → texto visible → pegar el texto.
- Link real de Scotiabank: microdata → título, Scotiabank, «Bogota, DC, CO»,
  4 789 caracteres de descripción.
- Sigue pidiendo pegar el texto cuando la página pide login, tiene anti-bot,
  `robots.txt` lo prohíbe o se arma solo con JavaScript (no hay texto que leer
  con una descarga simple).
- Pruebas: `R4D-LINK-MICRODATA`, `R4D-LINK-TEXT`, `R4D-LINK-ORDER`. Gates:
  tsc 0; build con hash CSS sin cambios; unit 743/0; resume-studio 53 ✅ 0 ❌
  (+130 unitarias); integration 286 ✅ 0 ❌.
