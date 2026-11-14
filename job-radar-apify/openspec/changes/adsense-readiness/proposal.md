# Pasar la revisión de AdSense: cumplir el 100 % de las reglas con evidencia

**Base:** `origin/main` en `320fcec`. **Fecha:** 2026-11-14.
**Tipo:** propuesta y plan. Sin código de producción todavía.
**Estado en AdSense:** «Requiere su atención — Contenido de poco valor».

## Meta

**Las 50 reglas de la matriz de abajo en estado CUMPLE, cada una con una
prueba o evidencia reproducible, antes de pulsar «Solicitar revisión».**

Eso es lo que se puede controlar. La aprobación la decide Google y nadie
puede garantizarla; lo que este cambio garantiza es que no queda ninguna
regla publicada sin cubrir ni ninguna causa conocida sin corregir. Hoy:
**26 cumplen, 15 en riesgo, 9 fallan.**

No se solicita revisión hasta que el gate de la fase F6 esté en verde.

## Fuentes leídas (2026-11-14)

1. Aviso del panel de AdSense para `buscotrabajo.co` (captura del
   propietario): «Contenido de poco valor».
2. «Google AdSense: contenido y experiencia de usuario»
   (support.google.com/adsense/answer/10015918).
3. Políticas de spam de la Búsqueda web de Google, completas
   (developers.google.com/search/docs/essentials/spam-policies, versión del
   2026-09-01), enlazadas desde publisherpolicies/answer/11035931.
4. Informe «Acciones manuales» → «Contenido con poco o ningún valor añadido»
   (support.google.com/webmasters/answer/9044175).
5. Políticas del programa AdSense (answer/48182, versión del 2026-08-04),
   requisitos de participación (answer/9724) y Políticas para editores →
   «Valor del inventario» (publisherpolicies/answer/11112688).

## Evidencia medida en producción (2026-11-14)

| Dato | Valor | Cómo se midió |
|---|---:|---|
| URLs de vacante en el sitemap | 12.460 (+2.000 recientes) | `sitemap-jobs*.xml` |
| URLs de hubs y categorías | 114 | `sitemap-categories.xml` |
| Páginas propias (no vacantes) | 18 | `sitemap-pages.xml` |
| Palabras propias en esas 18 páginas | 180–400 por página | texto renderizado |
| Guías, artículos o blog | **0** | `/blog`, `/guias`, `/ayuda` → 404 |
| Texto de la vacante copiado de la fuente | mediana 70 % del texto de la página; 76–94 % coincide textual con el original | `job-page-differentiation/proposal.md` (2026-10-30) |
| Vacantes de portal oficial del empleador | ~7 % de la muestra | misma muestra |
| Search Console: indexadas / sin indexar | 9,4 mil / 51,9 mil | informe de páginas, hoy |
| — «Rastreada: actualmente sin indexar» | 9.295 | ídem |
| — «No se ha encontrado (404)» | 35.343 | ídem |
| — Soft 404 | 2.003 | ídem |
| Acciones manuales | ninguna | Search Console, hoy |
| Problemas de seguridad | ninguno | Search Console, hoy |
| HTML crudo de `/legal/*` | 6–8 palabras (el resto llega con JS) | `curl` |
| HTML crudo de `/como-funciona`, `/preguntas` | 39 palabras | `curl` |
| Script de Auto ads | se inyecta en **todas** las rutas (login, cuenta, 404, buscador) | `index.html` |
| `ads.txt`, meta de verificación | correctos | `curl` |

## Diagnóstico

El aviso dice una sola cosa («contenido de poco valor»), pero las páginas que
enlaza lo definen con precisión, y el sitio encaja en tres definiciones a la
vez:

1. **Contenido copiado / raspado a escala (causa principal).** La política
   de spam nombra el caso literalmente: «raspar feeds, resultados de
   búsqueda u otro contenido para generar muchas páginas» y «reproducir
   feeds de contenido de otros sitios sin proporcionar ningún tipo de
   beneficio único». El 99,9 % de las URLs del sitio son vacantes cuyo texto
   principal es la descripción de LinkedIn, Computrabajo, Elempleo o Magneto.
   La Búsqueda de Google ya lo está diciendo con sus propios datos: 9.295
   páginas rastreadas y no indexadas.
2. **No hay contenido original suficiente.** AdSense pide «suficiente
   contenido original que permita determinar su temática» y «contenido nuevo
   y original de forma regular». Hay 18 páginas propias, cortas, y ninguna
   pieza editorial. La proporción original/copiado es de unas pocas miles de
   palabras contra millones.
3. **Anuncios en pantallas sin contenido del editor.** El script de anuncios
   carga en login, cuenta, 404 y en el buscador. La política «Valor del
   inventario» prohíbe anuncios en pantallas sin contenido, de navegación o
   con contenido replicado.

Y cuatro agravantes que un revisor humano ve en dos minutos:

- **Confianza.** `/about` no nombra a ningún responsable; el contacto es un
  Gmail con «123»; `/contact` no está enlazado desde el menú ni el pie.
- **Contradicción legal.** `/privacy` habla del «historial de transacciones
  procesadas con Wompi»; `/legal/privacidad` dice «hoy no procesamos pagos».
  Son dos políticas de privacidad distintas para el mismo sitio.
- **Señal de sitio vacío.** `/opiniones` muestra «Todavía no hay opiniones
  publicadas».
- **Texto que depende de JavaScript.** Las páginas legales y de ayuda casi no
  tienen texto en el HTML inicial.

## Matriz regla por regla

Estado: ✅ cumple · ⚠️ riesgo · ❌ falla. «Fase» es dónde se corrige.

### A. Aviso de AdSense — «Contenido de poco valor»

| ID | Regla | Estado | Qué tenemos | Fase |
|---|---|:-:|---|---|
| AV-1 | Valor único sustancial | ❌ | El valor único (deduplicar, verificar vigencia) existe pero no se ve en las páginas: se ve texto ajeno | F2–F5 |
| AV-2 | Presencia constante en la Web | ⚠️ | 35.343 URLs en 404 por la rotación de vacantes; casi nada permanente | F3, F4 |
| AV-3 | Interés genuino de los usuarios | ⚠️ | 3.790 sesiones / 28 días; 0 opiniones publicadas a la vista | F1, F6 |
| AV-4 | Información, herramientas o servicios auténticos de alta calidad | ⚠️ | El buscador es auténtico; no hay información ni herramientas propias | F3, F5 |
| AV-5 | Selección y mantenimiento estructural continuos | ⚠️ | Hay verificación de vigencia y deduplicación, pero no se explica ni se muestra | F1, F4 |

### B. Contenido y experiencia de usuario (answer/10015918)

| ID | Regla | Estado | Qué tenemos | Fase |
|---|---|:-:|---|---|
| CX-1 | Suficiente contenido original | ❌ | 18 páginas propias cortas, 0 editoriales | F3 |
| CX-2 | Valor sustancial frente a sitios similares | ❌ | Mismo texto que el portal de origen | F2, F4 |
| CX-3 | Contenido nuevo y original con regularidad | ❌ | Solo se renuevan vacantes ajenas | F3, F4 |
| CX-4 | Sin contenido copiado (tal cual, con sinónimos, o solo insertado) | ❌ | Descripciones copiadas de terceros | F2 |
| CX-5 | Sin duplicados internos ni texto largo repetido | ⚠️ | `/privacy` y `/legal/privacidad`; bloque «Más empleos en <ciudad>» repetido entre vacantes hermanas | F1, F2 |
| CX-6 | Páginas similares: ampliar o agrupar | ⚠️ | 114 hubs con la misma plantilla y cifras | F4 |
| CX-7 | Navegación alineada, legible, funcional y precisa | ✅ | Menú y pie correctos; falta enlazar contacto y las secciones nuevas | F1 |
| CX-8 | Contenido organizado por temática | ✅ | Ciudad, cargo, empresa | — |
| CX-9 | El sitio cumple lo que promete; sin enlaces a páginas inexistentes o irrelevantes | ⚠️ | 2.003 soft 404 y vacantes vencidas alcanzables | F2 |
| CX-10 | Se ve bien en los navegadores | ✅ | Falta dejarlo probado (Chromium, Firefox, WebKit) | F6 |

### C. Políticas de spam de la Búsqueda (todas)

| ID | Regla | Estado | Qué tenemos | Fase |
|---|---|:-:|---|---|
| SP-1 | Encubrimiento | ✅ | El HTML del servidor y la página hidratada muestran lo mismo; falta prueba de paridad | F0 |
| SP-2 | Páginas puerta | ⚠️ | Hubs por ciudad y cargo «considerablemente similares»; la guarda ≥10 ayuda | F4 |
| SP-3 | Dominio caducado | ✅ | No aplica | — |
| SP-4 | Contenido pirateado | ✅ | Search Console sin problemas de seguridad | — |
| SP-5 | Texto y enlaces ocultos | ✅ | Sin texto oculto; se añade prueba | F0 |
| SP-6 | Exceso de palabras clave | ⚠️ | La portada enumera ciudades y cargos como listas de enlaces | F4 |
| SP-7 | Spam de enlaces | ✅ | Sin compra ni intercambio | — |
| SP-8 | Tráfico automatizado hacia Google | ✅ | No se raspa la Búsqueda | — |
| SP-9 | Prácticas maliciosas | ✅ | Sin descargas ni secuestro del botón atrás | — |
| SP-10 | Funciones engañosas | ✅ | El buscador hace lo que dice | — |
| SP-11 | Abuso de contenido a gran escala | ❌ | 14 mil páginas generadas desde feeds ajenos | F2 |
| SP-12 | Raspado de datos | ❌ | Ídem; sí se cita y enlaza la fuente | F2 |
| SP-13 | Reputación de sitios | ✅ | No se aloja contenido de terceros para posicionar | — |
| SP-14 | Redirecciones engañosas | ✅ | Solo 301 legítimos | — |
| SP-15 | Afiliación sin valor | ✅ | No hay enlaces de afiliado | — |
| SP-16 | Spam generado por usuarios | ✅ | Opiniones moderadas antes de publicarse | — |
| SP-17 | Retiradas legales y de información personal | ⚠️ | No hay procedimiento público de retiro | F1 |
| SP-18 | Elusión de políticas | ✅ | No aplica | — |
| SP-19 | Estafa y fraude | ⚠️ | Vacantes de terceros sin canal visible para denunciar una oferta falsa | F1 |

### D. Acción manual «contenido con poco o ningún valor añadido»

| ID | Regla | Estado | Qué tenemos | Fase |
|---|---|:-:|---|---|
| MA-1 | Sin acción manual activa | ✅ | Verificado hoy; se vuelve a verificar en F6 | F6 |

### E. Políticas para editores — valor del inventario

| ID | Regla | Estado | Qué tenemos | Fase |
|---|---|:-:|---|---|
| PP-1 | Sin anuncios en pantallas sin contenido o de poco valor | ❌ | Auto ads en login, cuenta, 404 | F1 |
| PP-2 | Sin anuncios en pantallas en construcción | ⚠️ | «Todavía no hay opiniones publicadas» | F1 |
| PP-3 | Sin anuncios en pantallas de navegación o alertas | ⚠️ | Buscador `/dashboard` | F1 |
| PP-4 | Sin anuncios junto a contenido replicado | ❌ | Vacantes de portales de terceros | F1, F2 |
| PP-5 | Más contenido que anuncios | ✅ | Aún no hay bloques; se fijan límites | F1 |
| PP-6 | Idioma admitido | ✅ | Español | — |

### F. Políticas del programa AdSense

| ID | Regla | Estado | Qué tenemos | Fase |
|---|---|:-:|---|---|
| PG-1 | Sin clics ni impresiones no válidos | ✅ | Conducta del propietario: no abrir ni pulsar anuncios propios | — |
| PG-2 | Fuentes de tráfico permitidas | ✅ | Orgánico, directo, redes; sin tráfico comprado | — |
| PG-3 | Comportamiento del sitio (sin emergentes que estorben) | ✅ | Solo el botón «Califícanos» | — |
| PG-4 | Navegación no engañosa | ✅ | El botón «Aplicar en <portal>» dice a dónde lleva | — |
| PG-5 | Privacidad: aviso de cookies y consentimiento donde se exige | ⚠️ | Aviso presente; dos políticas contradictorias; sin CMP para EEE/Reino Unido/Suiza | F1 |
| PG-6 | Propiedad del sitio y `ads.txt` | ✅ | Verificado | — |
| PG-7 | Titular mayor de 18 años | ✅ | Propietario | — |

### G. Condiciones técnicas de la revisión

| ID | Regla | Estado | Qué tenemos | Fase |
|---|---|:-:|---|---|
| TX-1 | El texto está en el HTML inicial | ⚠️ | `/legal/*`, `/como-funciona`, `/preguntas` dependen de JS | F1 |
| TX-2 | El rastreador de AdSense puede entrar | ✅ | `robots.txt` no lo bloquea | — |

## Qué cambia

Seis fases, una por sesión, cada una con su gate (detalle en `design.md` y
`tasks.md`):

- **F0 — Línea base y auditor.** `npm run adsense:audit`: mide cada regla y
  falla si alguna no cumple. Sin cambios en producción.
- **F1 — Confianza, higiene y anuncios solo donde hay contenido.** Texto en
  el HTML inicial, una sola política de privacidad, página «Acerca de» con
  responsable y metodología, contacto y retiro de contenido, lista de rutas
  con anuncios.
- **F2 — La superficie copiada.** Las vacantes se clasifican por procedencia.
  Portal oficial del empleador: página completa. Portal de terceros: sin
  anuncios y, según la decisión D1, con extracto en lugar del texto completo.
- **F3 — Capa editorial `/guias`.** Guías originales sobre buscar empleo en
  Colombia, con autor, fecha y fuentes oficiales; cadencia sostenida.
- **F4 — Datos propios.** Informe mensual del empleo calculado con nuestro
  corpus y hubs con análisis que ningún portal individual puede dar.
- **F5 — Herramientas.** Calculadoras laborales deterministas (liquidación,
  salario neto) con fuente normativa citada.
- **F6 — Gate, espera y solicitud.** Auditor en verde, contenido nuevo
  indexado, y recién entonces «Solicitar revisión».

## Decisiones del propietario

| # | Decisión | Recomendación |
|---|---|---|
| D1 | Vacantes de portales de terceros: (a) texto completo, sin anuncios; (b) extracto + datos propios + enlace al original | **(a) para la primera revisión, (b) ya diseñada como contingencia.** (a) no arriesga el tráfico de Google que viene creciendo; (b) es la que más reduce la superficie copiada, pero rompe el contrato JobPosting y exige ADR |
| D2 | Nombre y rol reales del responsable en «Acerca de» | Publicarlos. No se inventa ningún dato |
| D3 | Quién revisa y firma cada guía | El propietario; ninguna guía se publica sin revisión humana |
| D4 | Correo con dominio propio (`contacto@buscotrabajo.co`) | Sí |
| D5 | Mensaje de consentimiento de Google (CMP) para EEE/Reino Unido/Suiza | Activarlo en AdSense → Privacidad y mensajes |
| D6 | Incluir F5 (calculadoras) antes de la primera solicitud | Sí, al menos una |

## Fuera de alcance

- Colocar bloques de anuncios manuales u optimizar ingresos (después de
  aprobar).
- Cambiar la regla de 30 días de retención (ADR 0008).
- Auto-apply, CV o cualquier función retirada.
- Subir el plan de Render o añadir servicios de pago.

## Riesgos

- **Contenido generado a escala.** Publicar decenas de guías escritas por IA
  sin revisión es justo la infracción SP-11. Por eso F3 limita el ritmo y
  exige revisión y fuentes.
- **Rendimiento.** `/guias` y las calculadoras no deben tocar el caché ni el
  precalentado del dashboard (runbook de rendimiento).
- **Contrato de agentes.** Las rutas nuevas se reflejan en `llms.txt`, API
  Catalog y docs solo si son reales.
- **Segunda negativa.** Si AdSense vuelve a rechazar con el gate en verde, se
  ejecuta D1(b) y se espera un ciclo de rastreo antes de reintentar.
