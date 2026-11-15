# Ubersuggest al 100 %: plan de posicionamiento orgánico sin depender de TikTok

**Fecha:** 2026-11-15. **Base:** `origin/main` en `320fcec`.
**Tipo:** investigación y plan. No hay código de producción en este cambio.
**Relación con otros documentos:** este plan **alimenta**
`docs/SEO-GROWTH-ROADMAP-2026-11.md`, que sigue siendo la única lista de
prioridades vigente. No la sustituye. Las acciones de código siguen la regla
de una fase por sesión, con OpenSpec, y las puertas comunes del §4 del
roadmap: guarda de ≥10 vacantes, nada inventado y TTFB.

## 0. Cómo leer las cifras

- **Ubersuggest da estimaciones de un tercero.** Cada fila trae su fecha de
  actualización: entre «hace 1 semana» y «hace 3 meses». Sirven para comparar
  patrones y ordenar, no como medición.
- **Para nuestro dominio manda Search Console.** Ubersuggest muestra para
  buscotrabajo.co **84 visitas, 73 palabras clave, DA 5 y 39 backlinks**. Son
  las mismas cifras del 2026-11-07: es una foto congelada. GSC daba el
  2026-11-10 **1,13 mil clics en 28 días**. Nuestro avance se mide con GSC y
  con el Rank Tracking de abajo, nunca con la estimación de tráfico de
  Ubersuggest.
- Todas las cifras de este documento se leyeron el 2026-11-15 con la cuenta
  del propietario (Chrome «Browser 1»), en **Español / Colombia**, salvo que
  se indique otra cosa. Las de Computrabajo y elempleo son del 2026-11-07
  (estudio #121, §8.4) y no se gastaron búsquedas en refrescarlas.

## 1. La cuenta: qué plan hay y qué incluye

**Plan: Individual.** Lo dice la etiqueta del menú de la cuenta, y quedan
250 créditos. Límites publicados en `ubersuggest.com/en/pricing`:

- 1 usuario y **1 proyecto**;
- **125 palabras clave rastreadas** por proyecto;
- **1.000 páginas** por auditoría;
- 5 competidores por proyecto y 20 ubicaciones;
- 150 búsquedas al día y 50 palabras por análisis masivo;
- 250 créditos al mes;
- 10 prompts de IA por proyecto al mes;
- exportación a CSV y PDF.

Business ($49) da 7 proyectos y 5.000 páginas por auditoría. Enterprise ($99)
da 15 proyectos, 300 palabras y 10.000 páginas.

**Hoy no hay ningún proyecto creado.** Rank Tracking y el panel muestran la
pantalla de «Añade tu sitio web». Por eso el propietario siente que no le saca
provecho: sin proyecto, la herramienta solo hace consultas sueltas.

## 2. Inventario de herramientas

Las rutas se leyeron del menú de la cuenta (`/es/...`).

| Herramienta | Ruta | ¿Se usa hoy? | Qué aporta a un portal de empleo CO/VE |
|---|---|---|---|
| Proyecto + Panel + «Próximas acciones» | `analyze/dashboard`, `analyze/next-actions` | **No** (no hay proyecto) | Junta auditoría, ranking y competidores en un solo sitio. Es la base de todo lo demás. |
| Rank Tracking | `analyze/rank-tracking` | **No** | Posición semanal de las 125 consultas que importan, por país y por dispositivo. Ubersuggest lo dice en su FAQ: **semanal por defecto; diario solo con un add-on de pago**. Permite importar las palabras desde un CSV. |
| Rastreo por píxel | `analyze/pixel-rank-tracking` | No | Distancia en píxeles desde arriba de la SERP. Importa porque el bloque de Google Empleos empuja hacia abajo el resultado orgánico. Es secundario. |
| Site Audit | `analyze/site-audit` | No | Problemas técnicos y on-page con puntuación sobre 100. Sin proyecto es una foto suelta; con proyecto, cada auditoría se compara con la anterior. Ubersuggest recomienda una al mes. **Tope: 1.000 páginas.** |
| Keyword Ideas / Overview / Bulk | `research-topics/keyword-ideas`, `ai-keyword-overview`, `keyword-bulk-analysis` | **Sí**, en el estudio #121 (§8.2 y §8.3) | Volumen, SD y CPC para elegir qué hub o qué guía crear. El análisis masivo admite 50 palabras a la vez. |
| Keyword Lists | `research-topics/keyword-lists` | No | Guarda listas por tema (hubs, intención, guías, VE). Se pueden reconsultar cada mes sin volver a teclearlas. |
| AI Prompt Ideas | `research-topics/ai-prompt-ideas` | No | Preguntas que la gente hace a ChatGPT y compañía sobre un tema. Alimenta los bloques AEO (roadmap #6). |
| Traffic Analyzer | `competitive-research/traffic-overview` | Sí (§8.1 y §8.4) | Tráfico, palabras clave, DA y backlinks de cualquier dominio. |
| Keywords by Traffic | `competitive-research/keyword-coverage` | Parcial | Las palabras clave de un competidor, con su URL, posición, SD y fecha. Así se ve la **brecha**: lo que ellos ganan y nosotros no. |
| Top Pages | `competitive-research/top-pages` | Sí (§8.4) | Las 500 páginas que más tráfico le traen a un competidor. Revela **plantillas de URL**. |
| Content Ideas | `competitive-research/content-ideas` | No | Artículos con más tráfico y enlaces sobre un tema. Sirve para elegir y validar las guías de F3. |
| Content Studio (AI Writer) | `content-studio` | No | Redactor con IA. **Solo como esquema**: el texto final no puede ser IA sin revisar. Lo exigen la política de AdSense (contenido escalado) y la regla «nunca inventar datos». |
| Visibilidad en búsquedas con IA | `ai-search-visibility` | No | Si ChatGPT, Claude, Perplexity y AI Overviews mencionan la marca en ciertos prompts. 10 prompts al mes en Individual. Es relevante porque «AI Assistant» trae el 12 % de las sesiones con la mejor conversión (memoria del 2026-11-10). |
| Backlinks (General) | `backlinks/overview` | Parcial | Dominios de referencia, anclas y nuevos o perdidos de cualquier dominio. |
| Oportunidades de backlinks | `backlinks/opportunity` | **No**, hasta hoy | Sitios que enlazan a hasta 5 competidores y no a nosotros. Es la lista de prospección de enlaces. |
| SEO local | `local-seo` | No | Para un perfil de Google Business. **No aplica**: somos un portal sin local físico. |
| Chat IA | `ai-chat` | No | Preguntas en lenguaje natural sobre los datos. Prescindible. |
| Conector MCP oficial / plugins de Claude | `/es/mcp`, `/es/claude-plugins` | No | 42 herramientas, con autenticación OAuth de la cuenta, incluidos proyectos y auditoría. Permitiría a Claude leer Ubersuggest sin navegar. **Instalarlo es decisión del propietario**: da acceso a la cuenta. |
| Extensión de Chrome | `/es/extension` | No | Volumen y SD dentro de la SERP de Google mientras se navega. Útil para la rutina manual. |
| Exportar CSV / PDF | botón en cada informe | No | Permite guardar las fotos del mes en `docs/seo-baseline/` para comparar. |

**Lo que no hay en esta cuenta o no se encontró:**

- **Content Gap y Similar Websites** no aparecen como herramientas separadas en
  el menú. La brecha se hace con *Keywords by Traffic* del competidor contra
  nuestras palabras en GSC.
- **No se encontró integración con Google Search Console** en las páginas
  leídas. Tampoco **alertas por correo** ni **API pública**: el acceso
  programático es el conector MCP.
- La base de ayuda (`ubersuggest.zendesk.com`) devuelve 403 a lecturas
  automáticas. Si hace falta, se confirma dentro de la cuenta.

## 3. Lo que muestran los datos

### 3.1 opcionempleo.com.co: cómo creció tan rápido

Cifras de Traffic Analyzer:

- 26.004 visitas orgánicas al mes y 20,8 mil palabras clave (−6,2 mil);
- DA 35 y 24.665 backlinks (11.490 nofollow) desde 1.808 dominios.

La curva marca 0 hasta junio de 2026, unas 23 mil en julio, estable en agosto
y septiembre, y 26 mil en octubre.

**Lectura.** No es un crecimiento «desde cero»:

1. **Es una red ya establecida.** `opcionempleo.com` es el mismo producto y la
   misma plantilla para España: 24,2 mil visitas, **DA 50 y 136,9 mil
   backlinks**. Su gráfico de backlinks empieza en 2024.
2. **El salto de junio a julio parece un hueco en los datos de Ubersuggest o el
   lanzamiento del ccTLD.** En cualquier caso es una red con autoridad que
   publica su plantilla en un dominio nuevo. No es una técnica que podamos
   copiar tal cual.
3. **El tráfico sale de la amplitud de la cola larga, no de enlaces.** Sus
   500 páginas principales tienen **0 backlinks**, salvo la portada (8.657) y
   dos páginas de «escolta» (~220). Las anclas incluyen spam de PBN
   («high quality dofollow backlinks… buy backlinks»). Esos enlaces no
   explican nada.
4. **Plantillas de URL** (Top Pages):
   - `/trabajo-{consulta}/{Ciudad}`: rol × ciudad e intención × ciudad.
     Ejemplos: `/trabajo-enfermera/Meta` 2.115 visitas,
     `/trabajo-remoto-desde-casa-sin-experiencia/Bogotá-DC` 525,
     `/trabajo-sin-experiencia/Valledupar` 118,
     `/trabajo-medio-tiempo-sin-experiencia/Barranquilla` 90;
   - `/trabajo/{Ciudad}`: municipios medianos y pequeños, como Zipaquirá
     320, Ipiales 191, Fusagasugá 166, Girardot 156, Facatativá 150,
     Ubaté 138, Buga 127, Riohacha 123, Apartadó 122, Chía 120 y
     Sogamoso 117. **Las grandes rinden poco:** Bogotá 50, Cali 75 y
     Barranquilla 84;
   - `/trabajo-{empresa}` y `/empresa/{Nombre}/empleos`: Health & Life IPS
     1.166, Avianca 241, Colanta 73, Bancolombia 78, Kuehne+Nagel 64,
     El Éxito en Soacha 71.
5. **Dificultad baja.** En Keywords by Traffic casi todas sus palabras tienen
   **SD 11–19**. Ocupan la posición 1 en cola larga (por ejemplo «trabajo en
   villeta», 720/mes) y la 7–10 en «empleo {municipio}» (por ejemplo
   «empleos zipaquira», 1,6 mil, posición 8).

**Qué copiamos y qué no.** El patrón (municipios, rol × ciudad, intención ×
ciudad y empresas) es el mismo que ya va en el roadmap (#1, #4, #4b y las
páginas de empresa). La diferencia es que **cada página de opcionempleo es un
listado de feed sin contenido propio**. Eso es lo que `adsense-readiness`
diagnostica como «contenido escalado de poco valor». Solo se toma el patrón
con tres condiciones:

- guarda de ≥10 vacantes por clasificador real;
- un bloque de datos propios por página (F4: número de vacantes, empresas,
  modalidad, salario mediano solo si hay datos);
- `noindex` por debajo de la guarda.

No se abren miles de combinaciones de golpe.

### 3.2 Magneto365: el contenido útil es su mayor fuente

Tiene 474,1 mil visitas en CO. Su Top 100 está dominado por blog y
herramientas, no por vacantes:

| Página | Visitas/mes | Tipo |
|---|---:|---|
| Plantillas de hoja de vida en Word | 43.664 | guía + plantilla |
| Festivos Colombia 2025 | 31.850 | calendario |
| Carta de recomendación (Word y PDF) | 30.614 | plantilla |
| Hora de trabajo 2026: valor, extras, recargos | 28.647 | guía con cifras |
| Portada `/co` | 20.802 | — |
| Salario mínimo 2026 | 13.679 (124 backlinks) | guía con cifras |
| Ofertas en Medellín | 12.974 | hub |
| Nuevo festivo 2026 | 12.634 | noticia |
| Empleos SENA | 8.972 | hub de empresa |
| Sin experiencia Bogotá | 8.030 | intención × ciudad |
| Empleos en Comfama | 5.582 | empresa |
| Auxilio de transporte 2026 | 5.103 | guía con cifras |
| Empleos en Grupo Éxito | 4.969 | empresa |
| Calculadora de liquidación | 3.809 (**428 backlinks**) | herramienta |
| `/preguntas-frecuentes/{cargo}` (asistente administrativo, impulsador, auxiliar de bodega, paramédico) | 1.835 / 908 / 903 / 831 | rol: funciones + salario |
| Calculadora de prima | 1.369 | herramienta |

Además, sus títulos llevan mes y año: «Trabajo sin experiencia Bogotá Octubre
2026», «Empleos en Comfama septiembre 2026».

### 3.3 Indeed Colombia: consulta × ciudad y salarios

Tiene 227 mil visitas en CO.

- **Portada:** 39.348 visitas.
- **`/q-{consulta}-l-{ciudad}`:**
  - sin experiencia en Bogotá 3.378;
  - fines de semana sin experiencia en Bogotá 2.255;
  - remoto sin experiencia 1.928;
  - remoto asesor en Bogotá 1.909;
  - remoto desde casa 1.242;
  - sin experiencia en Medellín 944;
  - medio tiempo en Medellín 479.
- **`/l-{ciudad}`:** Simijaca 4.950, Cali 1.489, Soacha 327, Zipaquirá 325,
  Barrancabermeja 259.
- **Salarios `/career/{rol}/salaries`:** diseñador gráfico 744, médico general
  310.
- **Evaluaciones de empresas `/cmp/{x}/reviews`:** hasta 8.116.

### 3.4 Computrabajo y elempleo

Datos del 2026-11-07, estudio §8.4, sin cambios.

- **Computrabajo:** su n.º 1 es «Bogotá sin experiencia», con 49,6 mil
  visitas.
- **elempleo:** la portada y las páginas SENA, roles y calculadora salarial.

### 3.5 Backlinks: dónde están los enlaces que nos faltan

Oportunidades de backlinks, buscotrabajo.co contra magneto365.com, devuelve
100 dominios. Los colombianos relevantes son prensa:

- **DA 89–91:** eltiempo.com (91), semana.com (91), elespectador.com (89);
- **DA 80–82:** portafolio.co (82), eluniversal.com.co (81), elheraldo.co
  (81), caracol.com.co (80);
- **DA 74–79:** noticiascaracol.com (79), elpais.com.co (78),
  elcolombiano.com (78), colombia.com (77), kienyke.com (77),
  larepublica.co (76), bluradio.com (76), lafm.com.co (75), enter.co (75),
  pulzo.com (75), las2orillas.co (75), vanguardia.com (74),
  wradio.com.co (74).

El enlace principal de Semana a Magneto es un artículo de servicio:
`semana.com/finanzas/articulo/si-es-docente-y-busca-trabajo-estas-ofertas-de-empleo-son-para-usted-le-contamos-como-aplicar/202510/`.
**La prensa enlaza a portales cuando publica notas del tipo «estas son las
vacantes de…» y cuando cita datos** (salario mínimo, festivos,
calculadoras). Magneto recibe 428 enlaces en su calculadora de liquidación y
124 en la guía del salario mínimo.

Para nosotros eso significa:

- el informe mensual de F4 (datos propios con metodología);
- las guías de F3 y las herramientas de F5;
- una ficha de prensa para notas de servicio.

No hay atajo de compra de enlaces: opcionempleo muestra el resultado de esa
práctica, que son anclas de spam.

### 3.6 Nosotros en Ubersuggest (foto congelada)

| URL | Visitas est. | Lectura |
|---|---:|---|
| `/empresas/elempleo` | 32 | posiciona por la marca de un competidor (ya anotado en el roadmap) |
| `/` | 20 | tiene los 39 backlinks |
| `/empleos/santa-marta` | 15 | — |
| `/empleos/palmira` | 2 | — |
| `/empleos/armenia` | 2 | — |

Palabras: «buscador de empleo(s)» (12,1 mil, posiciones 25 y 28), «trabajos
neiva» (27) y «trabajo santa marta» (29–30). Todo está en las páginas 2 y 3.

## 4. Plan priorizado

Esfuerzo: **S** = menos de 1 día · **M** = 1–3 días · **L** = una fase
completa. El impacto se da como orden relativo (alto, medio, bajo). **No se
dan cifras de tráfico prometidas**: el dato real lo darán GSC y el Rank
Tracking.

### 4.A Configuración de la cuenta

**Requiere el sí del propietario: cambia la cuenta.**

| # | Acción | Flujo de Ubersuggest | Evidencia | Impacto | Esfuerzo |
|---|---|---|---|---|---|
| A1 | **Crear el proyecto `buscotrabajo.co`** (el único del plan Individual) con los 5 competidores: `co.computrabajo.com`, `elempleo.com`, `magneto365.com`, `opcionempleo.com.co`, `co.indeed.com` | Proyecto → Panel → Próximas acciones | Hoy no hay proyecto (§1) | Alto: habilita todo lo demás | S |
| A2 | **Rank Tracking semanal** con la lista del anexo A: ≤125 palabras, ubicaciones Colombia y Venezuela, móvil. Se importa desde CSV. El rastreo diario es un add-on de pago y no se propone. | Rank Tracking | FAQ de la herramienta: semanal por defecto | Alto: es el único termómetro por consulta que no depende de GSC | S |
| A3 | **Site Audit mensual** (≤1.000 páginas). **Es un rastreo automatizado de producción**, así que necesita aprobación explícita. Lanzarlo fuera de horas pico y vigilar Render Starter según el runbook del dashboard. Como las 1.000 páginas se las comerían las vacantes, el valor está en hubs, intención, empresas y páginas propias. Si la herramienta no permite elegir el inicio, se audita por URL exacta un lote de hubs. | Site Audit | Tope del plan; 12.460 vacantes en el sitemap (`adsense-readiness`) | Medio: `test:seo` y el auditor `adsense:audit` ya cubren gran parte | S |
| A4 | **Visibilidad en IA**: 10 prompts al mes. Por ejemplo: «mejores páginas para buscar empleo en Colombia», «trabajo remoto en Venezuela», «empleos sin experiencia Bogotá». | Visibilidad en búsquedas con IA | AI Assistant = 12 % de las sesiones con la mejor conversión (memoria del 2026-11-10) | Medio | S |
| A5 | **(Opcional) Conector MCP oficial** para que Claude lea el proyecto sin navegar | `/es/mcp` | 42 herramientas, OAuth | Bajo/medio: ahorra tiempo en las rutinas | S |

### 4.B Trabajo de código

Cada fila es un cambio OpenSpec propio, una fase por sesión.

| # | Acción | Flujo que la alimenta | Evidencia | Impacto | Esfuerzo |
|---|---|---|---|---|---|
| C1 | **Páginas de empresa «Empleos en {empresa}» con datos propios.** Empezar por las empresas que salen en los competidores **y** en nuestro inventario: SENA, Comfama, Grupo Éxito, Avianca, Colanta, Bancolombia, Homecenter, Ecopetrol, Compensar. Con guarda ≥10 y un bloque F4. Ya es la F2 del plan maestro del 2026-11-10. | Top Pages + Keywords by Traffic de los competidores | Magneto: Comfama 5.582, Grupo Éxito 4.969, SENA 8.972. Opcionempleo: Health & Life IPS 1.166, Avianca 241. Ideas de «empleos»: del SENA 110 mil, Comfama 22 mil, EPM 14,8 mil, Bancolombia 8,1 mil (memoria del 2026-11-10). | **Alto** | L |
| C2 | **Ola de municipios** que opcionempleo gana en las posiciones 7–10 con SD 15–17 y que no tienen hub: Ipiales, Girardot, Ubaté, Buga, Riohacha, Chía, Sogamoso, Tuluá, Pitalito, Chiquinquirá, Jamundí. Medir antes el inventario y aplicar la guarda ≥10. Es el mismo mecanismo que `GUARDED_CITY_HUBS` del #133. | Keywords by Traffic de opcionempleo e Indeed | Por ejemplo «empleos zipaquira» 1,6 mil (posición 8 de opcionempleo); Zipaquirá, Fusagasugá, Facatativá y Apartadó ya están en el #133 | Medio | M |
| C3 | **Rol × ciudad** para los roles que se repiten en los tres competidores: auxiliar de enfermería, enfermera, fisioterapeuta, arquitecto, conductor, vigilante o escolta, psicólogo, trabajo social. Solo en las ciudades donde el clasificador real da ≥10. **Ojo:** `DEFAULT_ROLES_200` alimenta el scraping, así que esto va en un cambio aparte (ya anotado en la memoria del plan maestro). | Top Pages de opcionempleo e Indeed + Keyword Ideas | Opcionempleo: enfermera en Meta 2.115, fisioterapeuta en Bogotá 130. Indeed: auxiliar de enfermería en Medellín 487, psicólogo en Bogotá 719. Estudio: auxiliar de enfermería 5,4 mil, SD 13. | Medio | L |
| C4 | **Intención combinada:** «remoto sin experiencia», «fines de semana sin experiencia Bogotá», «medio tiempo sin experiencia» en Barranquilla y Medellín | Top Pages de Indeed y opcionempleo | Indeed: 1.928 / 2.255 / 487 (Barranquilla). Opcionempleo: remoto desde casa sin experiencia en Bogotá 525. | Medio | M |
| C5 | **Mes y año en el título de los hubs** («… noviembre 2026»), como experimento con hubs de control | Rank Tracking (antes y después) | Magneto lo hace en todos sus hubs de intención y empresa | Bajo/medio | S |
| C6 | Limpieza ya anotada: `/empresas/elempleo` posiciona por la marca de un competidor; `/ve/dashboard` posiciona por «trabajo en venezuela» | Traffic Analyzer (nosotros) | §3.6 | Bajo | S |

### 4.C Trabajo de contenido

Encaja con `adsense-readiness`: F3 guías, F4 informes y F5 herramientas.

| # | Acción | Flujo | Evidencia | Impacto | Esfuerzo |
|---|---|---|---|---|---|
| K1 | **Lista de las 12 guías de F3 tomada de las páginas de Magneto con volumen real.** F3 exige «12 temas desde el estudio #121, aprobados por el propietario». Propuesta en orden: 1) hoja de vida (plantillas y sin experiencia), 2) salario mínimo y auxilio de transporte 2026→2027, 3) valor de la hora, extras y recargos, 4) festivos 2027, 5) carta de recomendación, 6) referencias personales, 7) preguntas de entrevista, 8) cómo sacar el RUT, 9) caja de compensación, 10) trabajo remoto: qué es y cómo buscarlo (CO/VE), 11) cómo conseguir trabajo sin experiencia, 12) liquidación y prima explicadas, enlazadas a las herramientas de F5. | Top Pages de Magneto + Content Ideas + Keyword Ideas para validar el volumen de cada tema antes de escribir | §3.2: 43,7 mil / 13,7 mil + 5,1 mil / 28,6 mil / 31,9 mil / 30,6 mil / 1,1 mil / 0,8 mil / 0,8 mil / 1,2 mil / 0,9 mil / … | **Alto**: es el tipo de página que más tráfico trae al competidor más cercano y además es lo que AdSense pide | L |
| K2 | **Herramientas de F5:** calculadora de liquidación y de prima con la norma citada | Top Pages de Magneto | Liquidación 3.809 visitas y **428 backlinks**; prima 1.369 | Alto, y atrae enlaces | M |
| K3 | **Páginas de rol «qué hace y cuánto gana»**, solo con salario de vacantes reales y sin inventar | Top Pages de Magneto (`/preguntas-frecuentes/{cargo}`) e Indeed (`/career/{rol}/salaries`) | Asistente administrativo 1.835, auxiliar de bodega 903; Indeed diseñador gráfico 744 | Medio | M |
| K4 | **Calendario estacional.** Publicar antes de diciembre lo que tiene pico en enero: festivos 2027, salario mínimo 2027 cuando salga el decreto, auxilio de transporte 2027 | Keyword Ideas (tendencia) | El roadmap §1 fija enero como pico de búsqueda; Magneto saca 12,6 mil de «nuevo festivo» | Alto en temporada | S por pieza |
| K5 | **AI Writer solo como esquema.** Cada guía pasa por verificación de fuentes, dato propio con fecha de corte y firma (D3 de `adsense-readiness`) | Content Studio | Política de spam de Google y AdSense | — (es una regla) | — |

### 4.D Trabajo de enlaces

| # | Acción | Flujo | Evidencia | Impacto | Esfuerzo |
|---|---|---|---|---|---|
| E1 | **Lista de prospección de prensa** con los 20 medios de §3.5. Ofrecer el informe mensual de F4 (cifras propias: vacantes por ciudad, remoto, sin experiencia) y una ficha «vacantes de la semana» para notas de servicio | Oportunidades de backlinks (repetir con elempleo y Computrabajo; hoy solo se cruzó Magneto) | Semana enlaza a Magneto desde una nota «estas ofertas de empleo son para usted» | **Alto**: es el único camino visible para subir del DA 5 | M y continuo |
| E2 | **Enlaces institucionales hacia los hubs** (alcaldías, SENA, universidades por ciudad), ya previstos en el roadmap #8 y en el estudio §8.5. La prioridad la da el Rank Tracking: hubs entre las posiciones 11 y 30 | Rank Tracking + Backlinks (General) | El top 10 de cola larga tiene ~3 backlinks de media (estudio §8.4) | Medio | M |
| E3 | **Vigilar los enlaces perdidos o tóxicos** cada mes. No comprar enlaces ni usar PBN | Backlinks (General) | Las anclas de spam de opcionempleo (§3.1) | Protección | S |
| E4 | **TikTok como fuente de enlaces y menciones**, no solo de visitas: cada video lleva a una guía o un informe enlazable | Visibilidad en búsquedas con IA + Backlinks | ~54 mil vistas → ~400 registros (checkpoint del 2026-11-06) | Medio | continuo |

## 5. Rutinas

### Semanal (lunes, ~30 min)

1. **Rank Tracking:** anotar en `docs/seo-baseline/` las consultas que suben o
   bajan ±3 posiciones. Las que caen al rango 11–20 son las candidatas a
   enlace interno o contenido esa semana.
2. **Cruzarlo con GSC** de 7 días (clics e impresiones por hub). Si GSC y el
   Rank Tracking no coinciden, manda GSC.
3. **Próximas acciones** del panel: copiar los 3 primeros puntos al backlog
   solo si no los cubre ya `test:seo` o `adsense:audit`.
4. **Backlinks (General) de buscotrabajo.co:** dominios nuevos y perdidos.
5. **Top Pages de opcionempleo y Magneto**, solo la primera página: ¿hay una
   plantilla o un tema nuevo? Eso son 2 búsquedas de 150.

### Mensual (primera semana, ~2 h)

1. **Site Audit** del proyecto (con la aprobación ya dada en A3). Comparar con
   la puntuación anterior y separar errores de vacantes de errores de hubs o
   páginas propias.
2. **Keywords by Traffic** de los 5 competidores, exportado a CSV y guardado
   con fecha. La brecha es: sus palabras con SD ≤ 25, en posición 1–10 para
   ellos y ausentes en nuestras consultas de GSC.
3. **Oportunidades de backlinks** con los 5 competidores. Actualizar la lista
   de prospección (E1).
4. **Keyword Lists:** volver a consultar las listas «hubs», «intención»,
   «empresas», «guías» y «VE».
5. **Visibilidad en IA:** los 10 prompts del mes.
6. **Revisar este documento:** pasar acciones a hecho o descartado y anotar
   las cifras nuevas con su fecha.

**Presupuesto:** las dos rutinas caben en las 150 búsquedas al día y los
250 créditos al mes. No hace falta subir de plan. Solo valdría la pena si
hicieran falta más de 125 palabras rastreadas o una auditoría completa del
sitio (5.000 páginas en Business).

## 6. Decisiones del propietario

Aprobadas el 2026-11-15 en el chat:

1. ✅ **Proyecto y Rank Tracking creados** (A1 y A2) en la cuenta Individual:
   - **Proyecto «BuscoTrabajo»** (`buscotrabajo.co`), con mercados
     Español / Colombia y Español / Venezuela.
   - **Competidores:** co.computrabajo.com, elempleo.com, magneto365.com,
     co.indeed.com y opcionempleo.com.co. Se quitó linkedin.com, que venía
     sugerido.
   - **Sitemaps:** `sitemap-categories.xml` y `sitemap-pages.xml`, para que las
     1.000 páginas de la auditoría vayan a hubs y páginas propias y no a
     vacantes. Se quitó `sitemap.xml`.
   - **Temas para IA:** los 5 sugeridos, más «Empleos sin experiencia» y
     «Trabajo remoto en Venezuela». Ubersuggest generó 10 prompts para la
     Visibilidad en IA (A4).
   - **Rank Tracking:** 100 de 125 palabras, las del anexo A (78 ES-CO y
     22 ES-VE), importadas por CSV. Se descartaron las 50 que proponía la
     herramienta («maquilladora cerca de mi», «empleos en new york», …).
     Actualización semanal; la primera posición aparece tras la siguiente
     actualización.
   - **Auditoría:** crear el proyecto **lanzó automáticamente una auditoría**
     (≤1.000 páginas, ~10 min) el 2026-11-15. Es la auditoría inicial de A3.
     Las siguientes son mensuales.
2. ✅ **Auditoría mensual (A3):** aprobada dentro de «todo lo que contiene».
3. 🔄 **Conector MCP oficial (A5):** aprobado. Conectarlo requiere que el
   propietario inicie sesión (OAuth) desde la tarjeta del conector «Ubersuggest»
   en Claude.
4. ✅ **Lista de 12 guías de K1 para F3:** aprobada. Es la entrada del paso
   «Lista de 12 temas … aprobada por el propietario» de
   `openspec/changes/adsense-readiness/tasks.md`.

## Anexo A — Lista propuesta para el Rank Tracking

Son 100 palabras: 78 de Colombia y 22 de Venezuela. Quedan 25 de margen.
Salen de los hubs existentes, de las páginas de intención y de los volúmenes
de §8.2 y §8.3 del estudio #121. Antes de importarla, comprobar en Rank
Tracking si cada ubicación cuenta como una palabra más. Si es así, recortar
primero las de volumen menor a 1 mil.

**Colombia (ubicación Colombia):**

- **Genéricas:** empleos · trabajo · bolsa de empleo · buscador de empleos ·
  ofertas de empleo · vacantes · busco trabajo · trabajo desde casa
- **Remoto:** trabajo remoto · trabajo remoto colombia · trabajo remoto sin
  experiencia
- **Sin experiencia:** trabajo sin experiencia · trabajo sin experiencia
  bogota · trabajo sin experiencia cali · trabajo sin experiencia medellin
- **Jornada:** trabajo fines de semana · trabajo medio tiempo medellin ·
  trabajo medio tiempo cali · trabajo por días · trabajo nocturno
- **Ciudades grandes, «empleos {ciudad}» y «trabajo en {ciudad}»:** bogota,
  medellin, cali, barranquilla, cartagena, bucaramanga. Son 12 palabras.
- **Ciudades medianas, «empleos {ciudad}»:** valledupar, manizales, cucuta,
  ibague, pereira, santa marta, villavicencio, neiva, pasto, monteria,
  armenia, palmira. Son 12 palabras.
- **Hubs con guarda del #133:** empleos soacha, empleos rionegro, empleos
  zipaquira, empleos fusagasuga, empleos facatativa, empleos yopal, empleos
  barrancabermeja, empleos apartado
- **Candidatos C2:** empleos ipiales, empleos girardot, empleos sogamoso,
  empleos buga, empleos tulua, empleos chia
- **Empresas (C1):** empleos sena, empleos comfama, empleos epm, empleos
  bancolombia, empleos grupo exito, empleos avianca, empleos colanta,
  empleos ecopetrol
- **Roles:** auxiliar administrativo · auxiliar de enfermeria · ingeniero
  civil empleo · empleo abogado · analista de datos empleo · empleo
  fisioterapeuta · empleo arquitecto · empleo psicologo
- **Guías de F3, para medir desde el día 1:** salario minimo 2027 · festivos
  colombia 2027 · hoja de vida sin experiencia · calculadora liquidacion

**Venezuela (ubicación Venezuela):**

- **Remoto:** trabajo remoto · trabajo remoto venezuela · trabajo desde casa
  venezuela
- **Genéricas:** empleos en venezuela · trabajo en venezuela
- **Caracas:** empleos caracas · trabajo en caracas
- **Otras ciudades, «empleos {ciudad}»:** maracay, valencia carabobo,
  barquisimeto, maracaibo, maturin, puerto ordaz, anzoategui, puerto
  cabello, la guaira, san cristobal, margarita, merida venezuela
- **Empresas:** empleos farmatodo · empleos pdvsa
- **Intención:** trabajo sin experiencia caracas
