# Spec — adsense-readiness

Requisitos observables. Cada uno cubre una o más reglas de la matriz de
`proposal.md` (entre paréntesis).

## ADS-001 Auditor de reglas (todas)

El sistema DEBE ofrecer un comando que evalúe cada regla de la matriz y
devuelva su estado con evidencia.

- **Escenario: una regla no cumple.** Dado un build donde una ruta no
  elegible carga el script de anuncios, cuando se ejecuta el auditor,
  entonces la regla PP-1 sale como «falla», nombra la ruta y el comando
  termina con código distinto de cero.
- **Escenario: todo cumple.** Dado un build que satisface las 50 reglas,
  el comando termina con código cero y un informe con 50 entradas.
- **Escenario: sin escrituras.** El auditor nunca hace peticiones distintas
  de GET ni escribe fuera del directorio temporal.

## ADS-010 Anuncios solo donde hay contenido del editor (PP-1…PP-5)

El script de anuncios DEBE cargarse únicamente en rutas elegibles.

- **Escenario: pantalla sin contenido.** Dado `/login`, `/cuenta`, una URL
  inexistente o una vacante vencida, la página no lleva el marcador
  `<meta name="bt-ads" content="on">` y el navegador no crea ni pide el
  script `adsbygoogle.js` (el cargador sí contiene su URL como texto).
- **Escenario: buscador.** Dado `/dashboard` con o sin filtros, no se carga
  el script.
- **Escenario: vacante de terceros.** Dada una vacante cuya procedencia es
  un portal de terceros, no se carga el script.
- **Escenario: contenido propio.** Dada una guía, un informe o una
  herramienta, el script se carga con la misma estrategia diferida actual.
- **Escenario: estado vacío.** Dado un hub con menos de 10 vacantes o una
  página sin resultados, no se carga el script.
- **Escenario: retroceso.** Revertir el commit de F1a devuelve el
  comportamiento de `320fcec` (no hay interruptor de entorno: el marcador
  es la única dependencia).
- **Limitación conocida.** Si una visita entra por una página elegible y
  navega dentro de la app a una no elegible, Auto ads ya cargado sigue
  activo. Complemento: exclusiones de página de Auto ads en el panel de
  AdSense para `/dashboard`, `/login`, `/cuenta`.

## ADS-015 Texto en el HTML inicial (TX-1, SP-1, SP-5)

Las páginas de texto DEBEN entregar su contenido en la respuesta del
servidor.

- **Escenario: página legal.** Dado `GET /legal/privacidad` sin ejecutar
  JavaScript, la respuesta contiene todas las secciones de la política.
- **Escenario: preguntas.** Dado `GET /preguntas`, la respuesta contiene
  cada pregunta y su respuesta completa.
- **Escenario: paridad.** El texto del HTML inicial de cualquier página
  pública está contenido en el DOM hidratado; no hay texto que solo vea el
  rastreador ni texto visible solo con estilos que lo oculten.

## ADS-018 Una sola política de privacidad (CX-5, PG-5)

- **Escenario: resumen.** `GET /privacy` sigue en 200 (contrato de agentes)
  como resumen, y no contradice a `/legal/privacidad`.
- **Escenario: una redacción.** La versión HTML y la versión Markdown para
  agentes dicen lo mismo sobre pagos, cookies y publicidad.
- **Escenario: publicidad declarada.** La política nombra a Google como
  proveedor de anuncios, el uso de cookies publicitarias y cómo desactivar
  la personalización.

## ADS-020 Identidad, metodología y contacto (AV-5, CX-7, SP-17, SP-19)

- **Escenario: responsable.** «Acerca de» identifica al responsable del
  sitio con los datos que el propietario aprobó; no contiene datos
  inferidos.
- **Escenario: metodología.** Existe una página que explica cómo se
  obtienen, deduplican, verifican y retiran las vacantes, y coincide con el
  comportamiento real del sistema.
- **Escenario: contacto alcanzable.** Desde el pie de cualquier página se
  llega a contacto en un clic.
- **Escenario: reportar una vacante.** Cada página de vacante ofrece una
  forma visible de reportarla como falsa, vencida o para pedir su retiro.
- **Escenario: sección vacía.** Si no hay opiniones publicadas, la página
  de opiniones no muestra un apartado vacío.

## ADS-030 Tratamiento por procedencia (CX-4, SP-11, SP-12, PP-4)

- **Escenario: portal oficial.** Una vacante del portal del empleador
  muestra la descripción completa, su JobPosting y los bloques propios.
- **Escenario: terceros, opción (a).** Una vacante de un portal de terceros
  muestra la descripción y los bloques propios en el HTML inicial, nombra
  la fuente, enlaza al original y no carga anuncios.
- **Escenario: terceros, opción (b).** Con
  `THIRD_PARTY_JOB_EXCERPT_ENABLED=true`, la misma vacante muestra un
  extracto de hasta 300 caracteres, no emite JobPosting, lleva `noindex` y
  no aparece en el sitemap.
- **Escenario: sin invención.** Ningún bloque propio muestra un dato que no
  esté en el corpus; si falta, el bloque no se renderiza.

## ADS-035 Sin páginas muertas alcanzables (CX-9)

- **Escenario: vacante vencida.** Responde 404 o 410 real, sin anuncios.
- **Escenario: enlaces internos.** Ningún hub, guía, informe ni portada
  enlaza a una vacante vencida ni a una ruta inexistente.

## ADS-040 Guías (CX-1, CX-3, AV-4, SP-11)

- **Escenario: guía publicada.** `/guias/:slug` responde 200 con el texto
  completo en el HTML inicial, autor, fecha de publicación, fecha de
  revisión, fuentes enlazadas y datos estructurados de artículo.
- **Escenario: fuente obligatoria.** Una guía con una cifra o una norma sin
  fuente no pasa la validación de contenido y no se publica.
- **Escenario: sin relleno repetido.** Ningún párrafo de más de 40 palabras
  aparece en dos guías.
- **Escenario: navegación.** «Guías» está en el menú y en el pie; el índice
  lista todas las guías publicadas.
- **Escenario: interruptor.** Con `GUIDES_ENABLED=false`, `/guias` y sus
  hijas responden 404 real y salen del sitemap.

## ADS-050 Datos propios (CX-2, CX-6, SP-2, SP-6, AV-1, AV-2)

- **Escenario: informe mensual.** El informe muestra cifras calculadas del
  corpus con fecha de corte, metodología y límites declarados; una cifra con
  cobertura insuficiente se muestra como «sin datos suficientes».
- **Escenario: hub.** Cada hub indexable incluye un análisis propio que no
  es idéntico al de ningún otro hub.
- **Escenario: hub pequeño.** Un hub con menos de 10 vacantes lleva
  `noindex`, no está en el sitemap y no carga anuncios.
- **Escenario: portada.** La portada no contiene bloques que solo enumeren
  ciudades o cargos sin contexto.

## ADS-060 Herramientas (AV-4)

- **Escenario: cálculo verificable.** Para cada caso de prueba resuelto a
  mano, la calculadora devuelve el mismo resultado.
- **Escenario: norma citada.** Cada resultado muestra la fuente normativa y
  la vigencia de los valores usados.
- **Escenario: privacidad.** Los datos introducidos no salen del navegador.

## ADS-090 Invariantes que no cambian

- **Escenario: dashboard.** El primer acceso en frío y en una URL única se
  mantiene dentro de la línea base del runbook de rendimiento.
- **Escenario: agentes.** Las superficies REST, MCP, A2A y WebMCP siguen
  siendo públicas, acotadas y de solo lectura; los documentos de
  descubrimiento listan solo rutas reales.
- **Escenario: sin auto-apply.** Ninguna ruta nueva envía candidaturas ni
  genera CV.
