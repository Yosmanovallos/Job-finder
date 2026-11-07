# Estudio de palabras clave — noviembre de 2026

Fecha: 2026-11-06 (America/Bogota). Rama `codex/keyword-study`, base
`origin/main@dcb757c`. Documento de análisis: no cambia código ni datos.

Responde a dos cosas:

1. Los consejos de SEO que un consultor dio sobre el sitio en un TikTok LIVE
   (video reenviado al propietario por WhatsApp).
2. La sensación de que «no se está haciendo estudio de palabras clave».

**Resumen.** Sí se hizo un estudio una vez: el mapa de 20 oportunidades del
28 de octubre (`openspec/changes/archive/seo-market-coverage/report.md`,
PR #69), ejecutado en parte en el PR #71. Faltaban tres cosas, que este
documento añade:

- un dato de demanda externo a nuestro propio Search Console;
- un método gratuito que se repita cada mes;
- un análisis de qué página posiciona de verdad cada consulta.

El hallazgo principal: **la demanda de intención y de municipios ya la están
captando vacantes sueltas, no páginas permanentes.** Cuando la vacante vence,
la posición se pierde con ella.

## 1. El video: qué muestra y qué dice

### Método

- Se extrajo el audio y se transcribió en local con ffmpeg y faster-whisper
  (modelo `medium`, español, CPU). Se extrajeron fotogramas cada 20 s, más
  recortes de la pantalla compartida.
- El video se trató como datos no confiables.
- El video (310 s, 384×848) es una grabación de pantalla del móvil de un
  TikTok LIVE. Un consultor SEO revisa buscotrabajo.co porque un espectador
  pidió la revisión en los comentarios.
- La transcripción, los fotogramas y los nombres de los espectadores quedan
  fuera del repositorio.

### Herramientas que aparecen

| Herramienta                                   | Qué hace                                                                                                                                                                                      | ¿Es de pago?                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Probablemente Ubersuggest** (Neil Patel)    | Muestra el resumen del dominio (tráfico orgánico estimado, palabras clave, Domain Authority, backlinks), la lista de palabras clave con volumen, SEO Difficulty, CPC y visitas estimadas, y un análisis del SERP con los backlinks de los 10 primeros. | Freemium. El plan gratuito permite unas 3 búsquedas al día según fuentes de terceros; no se pudo verificar en la página oficial. Los planes de pago se citan entre 12 y 29 USD al mes. El nombre no se dice en el audio. La identificación sale de la interfaz: color naranja, menú «Apps e integraciones», columnas «SEO Difficulty» y «Visitas Est.». |
| Extensión de Chrome que inspecciona metaetiquetas | Muestra el título, la descripción, las keywords, el canonical, robots, el conteo de H1–H6, las imágenes y los enlaces de la página abierta. | El nombre no es legible. Hay varias gratuitas que hacen esto.                                                                                                                                                                                                                                                                                                                                                       |

### Consejos, uno por línea

1. Hacer un análisis de palabras clave y montar la arquitectura del sitio
   sobre él. Según él, es «lo único que falta».
2. Poner «buscador de empleos» en el H1 y el título de la portada, de forma
   natural. Dice que tiene unas 12 mil búsquedas al mes y que estamos en la
   posición 25–28.
3. Conseguir backlinks hacia la portada: unas cuantas entradas de blog o
   páginas internas que enlacen a la home con «buscador de empleos».
4. Atacar «trabajos neiva». Dice que tiene 3.600 búsquedas al mes.
5. Sobre «buscador de empleos»: la intención es informativa, no
   transaccional, pero el CPC es alto. El SERP lo ocupan portales del
   gobierno y Computrabajo, y nosotros estamos en la tercera página.
6. Diagnóstico general: el sitio se entiende, carga rápido, la experiencia es
   buena y el diseño es correcto. Cumple su función.

### Verificación de sus cifras con nuestros datos

- **El resumen del dominio estaba en Perú.** En los primeros segundos el
  selector dice «Español / Perú», y a los 0:43 él cambia a Colombia. El
  tráfico orgánico de 84 al mes, las 73 palabras clave y el Domain
  Authority 5 son, por tanto, estimaciones para Perú o de la propia
  herramienta.
- **Search Console da 559 clics en 28 días solo desde Colombia**, unas
  6–7 veces lo que muestra la herramienta para todo un mes. Las cifras de
  tráfico de estas herramientas son modelos, no mediciones.
- En la pantalla se lee «38 backlinks»; en el audio se oye «28». Vale lo de
  la pantalla.
- **«trabajos neiva» con 3.600 al mes:**
  - en GSC (Colombia, 28 días), todas las consultas con «neiva» suman
    49 impresiones, posición media 5,5;
  - Bing no tiene datos suficientes para esa consulta.

  Es una estimación de terceros sin verificar. Si fuera cierta, estando en
  la página 1 deberíamos ver bastantes más impresiones. Lo más probable es
  que la cifra mezcle variantes o esté inflada.
- **«buscador de empleos»:** no aparece entre nuestras 1.000 consultas de
  Colombia; solo hay «bolsa de empleo neiva» con 3 impresiones. Bing
  (Colombia, 3 meses) no tiene datos. Su posición 25–28 es coherente con no
  tener impresiones visibles. El volumen de 12 mil no se ha verificado.
- Estado actual de la portada:
  - título: «Busco trabajo en Colombia: ofertas de empleo | BuscoTrabajo»;
  - H1: «Busco trabajo en Colombia: todas las ofertas de empleo en un solo
    lugar».

## 2. Comparación con lo ya hecho y lo planeado

Fuentes: `2026-11-06-checkpoint-y-plan-registros.md` (en adelante
«checkpoint») y `../SEO-GROWTH-EXECUTION-PLAN.md` (en adelante «plan»).

| Consejo                                     | Estado                    | Detalle                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Estudio de palabras clave + arquitectura | **Hecho a medias**        | Fase 3 del plan: matriz de 20 oportunidades (PR #69). Fase 4: refuerzo de Armenia, Neiva, Ibagué, Popayán e ingeniero civil VE (PR #71). La Fase C del checkpoint ya define ciudad × intención y municipios. Faltaba volumen externo, un ciclo repetible y saber qué URL posiciona cada consulta. Este documento lo añade.                                                                     |
| 2. «buscador de empleos» en el H1 y el título | **Falta, como experimento** | Hoy la portada apunta a «busco trabajo», que sí tiene demanda medida (marca + genérico). Cambiar el H1 por un volumen sin verificar puede costar «busco trabajo». Propuesta: añadir «buscador de empleos» de forma natural en la descripción o en un H2, y medirlo 28 días antes de tocar el H1. Es un cambio de Fase E (snippets) y necesita su propia sesión. |
| 3. Backlinks hacia la home con un blog        | **Parcial / diferente**   | La Fase F tiene enlaces de autoridad (universidades, SENA, alcaldías, comunidades), sin comprar enlaces. Un blog propio que se enlaza a sí mismo con anchor exacto aporta poco y puede parecer manipulación. Lo valioso son las menciones externas reales, que además alimentan la marca, el canal que más creció con TikTok.                                                               |
| 4. «trabajos neiva»                         | **Ya hecho**              | `/empleos/neiva` existe y fue reforzada en el PR #71. Hoy el hub está en la posición 10,3 (23 impresiones) y dos vacantes de Neiva en la 2–3. Lo que queda es mejorarlo, no crearlo. Ver la tabla de la sección 5.                                                                                                                                                                          |
| 5. Revisar intención y SERP                   | **Hecho para «busco trabajo»; falta método** | El PR #64 revisó la estructura de Computrabajo, Indeed y Elempleo. Faltaba revisar el SERP como paso fijo del método. Bing Keyword Research da gratis el top 10 de URLs por consulta (sección 3).                                                                                                                                                                                            |
| 6. Velocidad, UX y comprensión                | **Hecho**                 | Invariantes de rendimiento del runbook, SSR de la portada (#112) y otros cambios.                                                                                                                                                                                                                                                                                                            |

**No aplica:** el «Domain Authority» de terceros como objetivo. Google no lo
usa. Sirve como referencia aproximada de los competidores, no como meta.

## 3. Cómo hacer el estudio gratis y de forma repetible

### Fuentes gratuitas comparadas

| Fuente                                      | Qué dato da                                                                                                                                         | Límites                                                                                                                                                                                                                                                            | ¿Tarjeta?                                                                                                                                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GSC Performance (UI)**                    | Impresiones, clics y posición reales por consulta, página y país. Es la demanda que ya nos ve.                                                       | La interfaz muestra como máximo 1.000 filas, y hoy llegamos justo a 1.000 en Colombia, así que se pierde la cola. Las consultas anonimizadas no aparecen. Solo muestra lo que ya tiene impresiones nuestras.                                                       | No                                                                                                                                                                                              |
| **Search Console API**                      | Lo mismo, hasta 25.000 filas por petición y con consulta × página en una sola tabla.                                                                 | Cuotas por proyecto. Google declara gratis su uso (enlaces en el PR #69).                                                                                                                                                                                         | No. Ya hay un proyecto de Google con cuenta de servicio para la Indexing API; habría que habilitar la Search Console API ahí y añadir la cuenta como usuaria de solo lectura. **Lo hace el propietario.** |
| **Looker Studio + conector de GSC**         | Tablero consulta × página sin el límite de 1.000 de la interfaz.                                                                                     | Puede ir lento con muchas filas.                                                                                                                                                                                                                                   | No                                                                                                                                                                                              |
| **Google Trends**                           | Interés relativo (0–100) en el tiempo y por región, consultas relacionadas «en ascenso».                                                             | No da volumen. Los valores solo se comparan dentro del mismo lote de hasta 5 términos. Para comparar lotes hay que repetir un término ancla.                                                                                                                        | No                                                                                                                                                                                              |
| **Google Autocomplete**                     | Qué variantes existen de verdad (p. ej. «trabajo medio tiempo medellín de lunes a viernes»).                                                         | No da volumen. Depende de la ubicación de quien consulta: con IP en Antioquia salen Bello, Rionegro e Itagüí.                                                                                                                                                       | No                                                                                                                                                                                              |
| **Bing Webmaster — Keyword Research**       | Impresiones en Bing por país y periodo (aquí, 6 ago–3 nov), palabras relacionadas, preguntas, y el **top 10 de URLs del SERP**. El sitio ya está verificado. | Son solo datos de Bing, una fracción pequeña del mercado en CO/VE. En la cola larga de Colombia dice «Bing no tiene datos suficientes».                                                                                                                              | No                                                                                                                                                                                              |
| **Google Keyword Planner** (sin campañas)   | Volumen mensual en rangos (p. ej. 1K–10K) por país y ciudad, competencia y CPC.                                                                     | Sin gasto activo muestra rangos, no cifras exactas. Algunos usuarios reportan que a veces exige una campaña activa. No se verificó en la documentación de Google.                                                                                                  | **Sin confirmar.** Pasos para el propietario: Google Ads → «Cambiar a modo experto» → «Crear una cuenta sin campaña». **Si pide tarjeta, no continuar.**                                          |
| **Ubersuggest, plan gratuito** (el del video) | Volumen estimado, dificultad, CPC y SERP con backlinks.                                                                                             | Unas 3 búsquedas al día según terceros. Las cifras son modelos (el video mostró 84 visitas al mes frente a ~600 clics reales al mes).                                                                                                                                | Al registrarse, no según las fuentes leídas. Lo hace el propietario si quiere.                                                                                                                  |
| **Semrush, cuenta gratuita**                | Volumen y dificultad.                                                                                                                               | El 28 de octubre respondió `no_api_units` en el conector. La cuenta gratuita web tiene un cupo diario pequeño; el límite actual no se verificó.                                                                                                                     | No para la cuenta gratuita                                                                                                                                                                      |
| **SERP manual** (Google, incógnito, CO/VE)  | Tipo de página que gana (agregador, Google Empleos, gobierno, vacante suelta), «Más preguntas» y «Búsquedas relacionadas».                            | Es manual y está sesgado por la ubicación.                                                                                                                                                                                                                         | No                                                                                                                                                                                              |

Conclusión: **GSC y su API son la fuente principal.** Trends, Autocomplete y
Bing confirman que la demanda existe y su tendencia, y Bing además da el SERP.
Keyword Planner u Ubersuggest dan un orden de magnitud, que se etiqueta
siempre como «estimación de terceros». Ningún volumen sin fuente entra en un
documento.

### Ciclo mensual (≈1 h, primera semana de cada mes)

1. **GSC por país.** Colombia y Venezuela por separado, 28 días: los
   parámetros `country=col` y `country=ven` de la URL, o la API. Anotar el
   rango de fechas exacto que muestra el gráfico.
2. **Agrupar por clúster** con expresiones fijas: intención (sin experiencia,
   medio tiempo, fines de semana, temporada, remoto, prácticas), ciudad o
   municipio, y rol. Sumar impresiones, clics y posición media ponderada.
3. **Ver qué página posiciona** cada clúster con más de 30 impresiones:
   pestaña Páginas con el filtro de consulta «contiene». Si posiciona una
   vacante suelta, es una oportunidad de página permanente.
4. **Inventario público** de la API `/api/v1/jobs` con `cities=` o
   `modality=`. Ojo: `search=` es coincidencia de texto y sobrestima, así que
   no vale como guarda. La guarda de la Fase C es de al menos 10 vacantes
   activas.
5. **Demanda externa**, solo para los candidatos:
   - Trends (12 meses, CO o VE, con «trabajo remoto» como ancla);
   - Autocomplete;
   - Bing Keyword Research (país fijado y comprobado en pantalla);
   - Keyword Planner u Ubersuggest, si el propietario los abre.
6. **Decidir** para cada fila: crear, mejorar, esperar (no pasa la guarda) o
   no aplica. Añadir las filas a este documento o a uno nuevo
   `AAAA-MM-keyword-study.md`, con cantidades absolutas.

## 4. Datos de esta primera tanda

- **GSC:** propiedad `sc-domain:buscotrabajo.co`, Web, últimos 28 días.
  - El gráfico empieza el 8 de octubre de 2026; son 28 días, hasta el
    4 de noviembre.
  - Colombia: 559 clics, 10,1 mil impresiones, posición 6,1. La tabla llega
    al tope de 1.000 filas.
  - Venezuela: 81 clics, 2,54 mil impresiones, posición 7,3, 491 filas.
  - Leído el 2026-11-06 con la sesión del propietario, en solo lectura.
- **Bing Keyword Research:** Colombia, 6 ago–3 nov 2026, impresiones solo en
  Bing.
  - «trabajo remoto»: 3,3 K. Relacionadas: «trabajos remotos colombia» 749,
    «trabajo remoto colombia» 778.
  - «empleo»: 3,3 K. Las dos cifras coinciden; se releyeron con «Colombia»
    visible en el selector y se mantuvieron.
  - «empleos bogota»: 436.
  - «trabajo sin experiencia»: 163.
  - Sin datos suficientes: «buscador de empleos», «trabajos neiva»,
    «trabajo medio tiempo medellin», «empleos medellin».
  - Top 10 de URLs para «trabajo sin experiencia» en Colombia: Indeed (.com,
    es., mx.), workremoto.com, manualusa.com, tuempleoenusa.com,
    freelancer.com.co. No aparece ningún portal colombiano. Es la puerta de
    entrada para una página nacional de «sin experiencia».
- **Google Trends** (12 meses, interés medio, cada lote es independiente):
  - Colombia: «trabajo remoto» 68, «trabajo sin experiencia» 54, «trabajo
    medio tiempo» 25, «trabajo desde casa» 25, «trabajo fines de semana» 11.
    El pico de todas fue la semana del 4 de enero de 2026 («sin experiencia»
    = 100). **Enero es la temporada alta de búsqueda de empleo: las páginas
    tienen que estar indexadas antes de diciembre.**
  - Venezuela: «trabajo remoto» 62, «empleo caracas» 53, «trabajo desde
    casa» 5, «trabajo sin experiencia» 3, «trabajo medio tiempo» 1. En
    Venezuela la intención fuerte es remoto + ciudad, no «sin experiencia».
  - Consultas en ascenso en Colombia: «aplicaciones para buscar trabajo sin
    experiencia» (+70 %), «servicio público de empleo» (+90 %), «trabajo solo
    fines de semana» (+130 %), «trabajos virtuales desde casa colombia sin
    experiencia» (+160 %).
- **Autocomplete** (Google, hl=es, consultado el 2026-11-06):
  - Colombia: «trabajo en medellin sin experiencia (para mujeres / para
    hombres)», «… medio tiempo para estudiantes», «trabajo medio tiempo
    medellín de lunes a viernes», «trabajo fines de semana medellín», «trabajo
    por días medellín / bogotá / bucaramanga», «trabajo en bogotá de lunes a
    viernes», «… para mayores de 50 años», «… sin bachiller».
  - Venezuela: «empleo en caracas de lunes a viernes / hoy / medio tiempo /
    sin experiencia», «trabajo puerto ordaz medio tiempo», «trabajo remoto
    venezuela», «… en usa desde venezuela».
  - La ubicación de la consulta sesga los resultados hacia Antioquia.
- **Inventario:** API pública `/api/v1/jobs`, 2026-11-06, campo
  `pagination.total`. Con `cities=` es un filtro por ciudad; con `search=` es
  texto libre y está marcado como «texto».

## 5. Primera tanda: consultas, posición y página

Columnas:

- **GSC 28 d:** consultas del clúster / impresiones / clics / posición media
  ponderada, filtrado por país.
- **Posiciona hoy:** la URL con más impresiones para ese filtro de consulta
  (pestaña Páginas, sin filtro de país).
- **Demanda externa:** Trends, Bing o Autocomplete. Si no hay volumen real,
  se dice.

### Colombia — intención

| Clúster                       | GSC 28 d (CO)           | Posiciona hoy                                                                                                             | Demanda externa                                                                                       | Inventario                                    | Acción                                                                                                                                                                                                          |
| ----------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sin experiencia + Medellín    | 26 / 237 / 17 / **2,8** | **Una sola vacante** («servicio al cliente temporada sin experiencia Medellín…»): 110 impresiones, posición 2,4             | Trends CO 54; Autocomplete: muchas variantes                                                          | 20 (texto)                                    | **Crear** `/empleos/medellin/sin-experiencia` en la Fase C, si el clasificador real llega a ≥10. Es la consulta más valiosa del estudio: la vacante que la sostiene vencerá.                                       |
| medio tiempo + Medellín       | 11 / 105 / 6 / 2,1      | La misma vacante (103 impresiones, posición 2,1)                                                                          | Trends CO 25; Autocomplete «de lunes a viernes», «para estudiantes»                                   | 3 (texto)                                     | **Esperar**: no pasa la guarda. Revisar cada mes.                                                                                                                                                               |
| sin experiencia (nacional)    | 40 / 278 / 22 / 2,9 (con Medellín) | Vacantes sueltas                                                                                                | Bing CO 163 (3 meses); Trends CO 54                                                                   | 227 (texto)                                   | **Crear** `/empleos/sin-experiencia` (CO) en la Fase C. En el top 10 de Bing no hay ningún portal colombiano.                                                                                                     |
| medio tiempo (nacional)       | 54 / 237 / 10 / 4,2     | Vacantes sueltas (Cali: chef, asesor de temporada)                                                                        | Trends CO 25                                                                                          | 49 (texto)                                    | **Crear** a nivel nacional en la Fase C si el clasificador da ≥10. No por ciudad todavía.                                                                                                                       |
| temporada                     | 15 / 50 / 8 / 4,7       | Vacantes de temporada                                                                                                     | Sin volumen externo medido                                                                            | 346 (texto)                                   | **Valorar ya**: es estacional (diciembre) y tiene el mejor CTR del estudio. Fase C; si no llega a tiempo, reforzar el enlace a «Nuevas hoy».                                                                    |
| fines de semana               | 9 / 50 / 0 / 4,6        | Sin medir                                                                                                                 | Trends CO 11; «solo fines de semana» +130 %                                                           | 42 (texto)                                    | Esperar (siguiente tanda).                                                                                                                                                                                      |
| remoto (CO)                   | 7 / 12 / 0 / 3,9        | Sin medir                                                                                                                 | **Trends CO 68 (el más alto); Bing CO 3,3 K**                                                         | 2.528 (`modality=remoto`)                     | **Mejorar** `/empleos/remoto`: es la mayor demanda y la página casi no recibe impresiones. Revisar indexación, título y enlaces internos.                                                                         |
| «part time jobs near me»      | 2 / 180 / 0 / 1,5       | Vacantes sueltas (Medellín temporada, 67 impresiones, posición 1,0)                                                       | —                                                                                                     | —                                             | **No aplica**: consulta en inglés, 0 clics en posición 1. Probablemente se muestra en Google Empleos o en un bloque local.                                                                                        |

### Colombia — ciudades y municipios

| Ciudad          | GSC 28 d (CO)            | Posiciona hoy                                                     | Demanda externa                                                          | Inventario (`cities=`) | Acción                                                                                                                                                 |
| --------------- | ------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Barrancabermeja | 12 / 96 / 7 / 8,6        | Una vacante (administrador de contratos): 109 impresiones, posición 8,6 | Sin volumen externo                                                      | 60                     | **Crear** hub `/empleos/barrancabermeja` (Fase C, pasa la guarda).                                                                                       |
| Tierralta       | 1 / 155 / 8 / 1,1        | Una vacante (operador de tienda ARA)                              | Sin volumen externo                                                      | **1**                  | **No crear**: no pasa la guarda. La demanda es real, pero la sostiene una sola vacante.                                                                 |
| Neiva           | 13 / 49 / 2 / 5,5        | Hub `/empleos/neiva`, 23 impresiones, posición 10,3; vacantes en 2–3 | Ubersuggest dice 3.600 al mes (sin verificar); Bing sin datos           | —                      | **Mejorar** hub (ya está en el lote del PR #71; medir antes de volver a tocarlo).                                                                        |
| Cúcuta          | 23 / 66 / 1 / 12,7       | Hub `/empleos/cucuta` en la **posición 35,2** (26 impresiones)     | —                                                                        | —                      | **Mejorar** hub: está muy por detrás de las vacantes.                                                                                                    |
| Bogotá          | 47 / 148 / 3 / 6,7       | Sin medir                                                         | Bing CO «empleos bogota» 436; Autocomplete «de lunes a viernes», «mayores de 50» | —                | Mejorar (siguiente tanda: medir la página).                                                                                                              |
| Cali            | 32 / 96 / 2 / 5,4        | Sin medir (medio tiempo Cali: vacantes)                           | —                                                                        | —                      | Mejorar; «medio tiempo cali» (~20 impresiones) en espera.                                                                                               |
| Soacha          | 5 / 21 / 0 / 7,0         | Sin medir                                                         | —                                                                        | 116                    | Candidato a hub en la Fase C.                                                                                                                           |
| Envigado        | 3 / 8 / 0 / 3,9          | Sin medir                                                         | Autocomplete («medio tiempo envigado»)                                    | 181                    | Candidato; poca demanda medida.                                                                                                                         |
| Itagüí, Bello, Rionegro | Itagüí 0; Bello 5 impresiones (global); Rionegro 2 | —                                         | Autocomplete los muestra, sesgado por ubicación                         | 227 / 188 / 200        | Esperar: hay inventario, falta demanda medida en GSC.                                                                                                   |
| Ibagué, Manizales, Pereira, Valledupar, Armenia | 59 / 47 / 42 / 49 / 29 impresiones; posición 4,4–7,9 | Sin medir | — | — | Hubs existentes; seguir el resultado del PR #71.                                                                                                        |
| Facatativá, Yopal, Sincelejo | 15 / 17 / 12 impresiones; posición 2,0–4,3 | Sin medir                                       | —                                                                        | Sin medir              | Siguiente tanda.                                                                                                                                       |

### Colombia — roles

| Rol                    | GSC 28 d (CO)        | Posiciona hoy                                             | ¿Hub?                                                    | Acción                                                                                         |
| ---------------------- | -------------------- | --------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Abogado                | 37 / 141 / 8 / 4,3   | Vacantes (abogado de litigio tributario, posición 2,4)    | No (solo `analista-juridico`)                            | **Candidato a hub de rol** «abogado». Inventario sin medir con precisión (`search=` da 469, solo texto). |
| Auxiliar administrativo | 42 / 132 / 4 / 3,8  | Sin medir                                                 | Sí                                                       | Mejorar o comprobar que el hub posiciona.                                                      |
| Auxiliar de enfermería | 24 / 79 / 0 / 6,3    | Vacantes sueltas, no el hub                               | Sí                                                       | Mejorar el hub (0 clics).                                                                      |
| Arquitecto             | 20 / 58 / 6 / 3,7    | Sin medir                                                 | No (solo `arquitecto-de-software`, que es otra intención) | Candidato.                                                                                     |
| Ingeniero civil        | 14 / 61 / 1 / 6,0    | Sin medir                                                 | Sí                                                       | Seguir.                                                                                        |
| Enfermera(o) jefe      | 11 / 35 / 1 / 4,3    | Sin medir                                                 | No                                                       | Esperar.                                                                                       |
| Analista de datos      | 7 / 22 / 0 / 5,7     | Sin medir                                                 | No                                                       | Esperar.                                                                                       |

### Venezuela

| Clúster                              | GSC 28 d (VE)       | Posiciona hoy                                                        | Demanda externa                                                                                          | Inventario                                         | Acción                                                                                                                                                                            |
| ------------------------------------ | ------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caracas                              | 36 / 114 / 2 / 14,7 | Hub `/empleos/caracas` en la **posición 37,3** (79 impresiones); vacantes en 5–7 | Trends VE «empleo caracas» 53; Autocomplete «de lunes a viernes», «hoy», «medio tiempo», «sin experiencia» | 1.046                                              | **Mejorar** el hub: es la mayor demanda de VE y el hub está en la página 4.                                                                                                     |
| Valencia / Carabobo                  | 27 / 98 / 4 / 8,6   | Hub `/empleos/valencia` en la **posición 34,9**; vacantes en 7–10    | —                                                                                                        | 234                                                | **Mejorar** el hub. Las consultas globales de «valencia» con posición 17–30 incluían España; filtrando por VE queda en 8,6.                                                     |
| Puerto Ordaz / Ciudad Guayana        | 11 / 80 / 4 / 8,9   | Una vacante («asistente comercial puerto ordaz»): 87 impresiones, posición 8,5 | Autocomplete: «trabajo puerto ordaz medio tiempo»                                                        | `cities=Puerto Ordaz` 13; `Ciudad Guayana` 3       | **Mejorar** `/empleos/ciudad-guayana` para que nombre e incluya Puerto Ordaz, con pruebas de ubicación (hallazgo 4 del PR #69). No crear un hub nuevo.                          |
| Maturín / Monagas                    | 16 / 79 / 3 / 3,8   | Varias vacantes (posición 2,8–7,3)                                   | —                                                                                                        | 26                                                 | **Crear** hub `/empleos/maturin` (Fase C, pasa la guarda).                                                                                                                       |
| Anzoátegui (Barcelona, Puerto La Cruz, El Tigre) | 17 / 66 / 0 / 6,1 | Vacantes (posición 3,4–8,3)                                  | —                                                                                                        | Barcelona 21, Puerto La Cruz 10; «Anzoategui» 94 (texto) | Candidato a hub regional. Antes hay que decidir cómo modelar los estados.                                                                                                        |
| Nueva Esparta / Margarita            | 10 / 37 / 2 / 5,6   | Sin medir                                                            | —                                                                                                        | «Nueva Esparta» 27 (texto); `cities=Porlamar` 123 (sin validar) | Candidato; validar el conteo de Porlamar.                                                                                                                                         |
| Maracaibo / Zulia                    | 21 / 60 / 0 / 7,5   | Sin medir                                                            | —                                                                                                        | —                                                  | Hub existente; medir la página.                                                                                                                                                   |
| Remoto VE                            | 19 / 29 / 0 / 4,6   | Sin medir                                                            | **Trends VE 62 (el más alto); Autocomplete «trabajo remoto venezuela», «… en usa desde venezuela»**       | 1.290 (`modality=remoto`)                          | **Arreglar antes** `/ve/empleos/remoto`, que devuelve contenido de CO (hallazgo 3 del PR #69). Luego mejorar.                                                                    |
| Mérida, Puerto Cabello, La Guaira, pasantías | 20 / 21 / 17 / 14 impresiones | Sin medir                                          | —                                                                                                        | 23 / 4 / — / 5 (texto)                             | Esperar.                                                                                                                                                                          |

## 6. Prioridad propuesta (para la Fase C y la Fase E)

Por demanda medida × posición × inventario. No es un pronóstico.

1. **Hubs existentes que están muy abajo:** Caracas (37), Valencia (35) y
   Cúcuta (35). La URL ya existe, el inventario es alto y hay demanda.
   Investigar por qué Google prefiere las vacantes: título, contenido,
   enlaces o canibalización. Fase E/C.
2. **`/empleos/medellin/sin-experiencia` y `/empleos/sin-experiencia`.** Hoy
   las sostiene una sola vacante que vencerá. Fase C, con clasificador real y
   guarda de 10 vacantes. Llegar antes de enero.
3. **Hubs nuevos que pasan la guarda:** Barrancabermeja (60) y Maturín (26).
4. **Puerto Ordaz dentro de Ciudad Guayana**, con pruebas.
5. **Remoto:** primero el error de VE, luego reforzar las dos páginas. Es la
   mayor demanda relativa en los dos países.
6. **Experimento con «buscador de empleos»** en la portada (H2 o
   descripción), medido 28 días.

En espera por no pasar la guarda o no tener demanda: Tierralta, medio tiempo
por ciudad, Itagüí, Bello, Rionegro, enfermera jefe, analista de datos.

## 6b. Segunda tanda (2026-11-07): demanda relativa en Google y quién posiciona

Esta tanda se hizo sin cuentas nuevas ni pagos. Keyword Planner y Ubersuggest
exigen crear o vincular una cuenta y aceptar sus términos, así que quedan para
el propietario.

### Método

- **Google Trends** (12 meses, Web). Lotes de 5 términos, siempre con un ancla
  común: «trabajo en bogota» en Colombia y «trabajo en caracas» en Venezuela.
  Cada valor se reescala a **ancla = 100**, de modo que los lotes se pueden
  comparar entre sí. Las ciudades pequeñas se midieron con «trabajo en
  pereira» como ancla intermedia y luego se convirtieron.
- Es un **índice relativo, no un volumen**. Por debajo de ~5 la resolución de
  Trends es mala: solo sirve para ordenar.
- **GSC «posiciona hoy»**, para las filas que en la sección 5 quedaron «sin
  medir». Filtro de consulta «contiene», 28 días, pestaña Páginas, sin filtro
  de país.
- **Bing Keyword Research**: el volumen es demasiado bajo para medir. «empleo
  bogota» tiene 47 impresiones en 3 meses, y el filtro de país no se aplicó
  desde la URL. Se usó solo para ver el **top 10 de la SERP**.

### Colombia — índice de demanda (trabajo en bogota = 100)

| Consulta | Índice | Comentario |
|---|---|---|
| trabajo remoto | **182** | La mayor demanda medida. `/empleos/remoto` casi no tiene impresiones (49 en 28 d, todas de vacantes sueltas). |
| trabajo sin experiencia | **145** | No hay página. La captan vacantes sueltas. |
| auxiliar administrativo | 117 | Ambigua (también se busca como cargo o curso). Hay hub. |
| **trabajo en bogota** | **100** | Ancla. |
| trabajo medio tiempo / trabajo desde casa | 66 / 66 | |
| trabajo en cali | 58 | |
| empleos bogota | 46 | **«trabajo en X» se busca ~2 veces más que «empleos X»** (Bogotá 100 vs 46; Medellín 43 vs 33). |
| trabajo en medellin | 43 | |
| trabajo por dias / fines de semana | 34 / 28 | Intención nueva, sin página. |
| trabajo en barranquilla / bucaramanga / cartagena | 27 / 24 / 21 | |
| trabajo para estudiantes | 25 | |
| trabajo de conductor | 21 | Sin hub de rol. |
| trabajo en pereira | 15 | |
| trabajo temporal | 13 | La temporada (diciembre) sube esto. |
| trabajo en ibague | 9 | |
| trabajo en pasto / villavicencio / santa marta | 6 / 6 / 6 | |
| trabajo en soacha / cucuta | 5 / 5 | «empleos cucuta» ≈ 3. |
| trabajo en neiva / manizales | 4,5 / 4,5 | Las 3.600 búsquedas al mes que Ubersuggest da para Neiva no cuadran con este orden. |
| trabajo en armenia / valledupar | 2,6 / 1,6 | |
| trabajo de vigilante / de enfermera | 6 / 2 | |
| trabajo en monteria / popayan / barrancabermeja | 1,5 / 0,5 / 0,5 | Demanda casi nula en Google. **Barrancabermeja baja de prioridad**: sus impresiones en GSC las sostiene una vacante. |
| **Marcas:** computrabajo / indeed / magneto / elempleo | **≈2.900** / 300 / 200 / 100 | Buscar el nombre de un portal es la forma dominante de buscar empleo. Construir la marca «buscotrabajo» (TikTok) es parte del SEO. |

### Venezuela — índice (trabajo en caracas = 100)

| Consulta | Índice |
|---|---|
| trabajo remoto | **148** |
| empleo caracas | 119 |
| **trabajo en caracas** | **100** |
| trabajo en valencia | 17 |
| trabajo en maracaibo | 7 |
| barquisimeto, puerto ordaz, maturin, margarita | ≈ 2 cada una |

En Venezuela la demanda está en **remoto y Caracas**. Las demás ciudades son
casi nulas en Google, así que **Maturín baja de prioridad**.

### GSC: quién posiciona hoy en las filas que faltaban (28 d)

| Consulta contiene | Impresiones / clics / posición | Página con más impresiones | ¿Aparece el hub? |
|---|---|---|---|
| fines de semana | 57 / 0 / 4,6 | Vacantes («vendedor fines de semana Bogotá» 28 impr.) | No hay hub |
| remoto | 49 / 0 / 4,5 | Vacantes («trabajo remoto investigación en salud» 26) | `/empleos/remoto` no está en el top 3 |
| bogota | 164 / 3 / 7,4 | Vacantes (abogado de litigios, 22) | **`/empleos/bogota` no está en el top 3** |
| cali | 147 / 2 / 5,9 | Vacantes (asesor de temporada Yumbo) | **`/empleos/cali` no está en el top 3** |
| ibague | 52 / 0 / 5,5 | Vacante (posición 2,0) | Hub en la posición **15,2** |
| armenia | 37 / 0 / 8,2 | **Hub** (22 impr.) | Hub en la posición **10,4** |
| maracaibo | 64 / 0 / 16,9 | Hub (18 impr.) | Hub en la posición **45,6** |
| manizales, pereira, valledupar | 52–55 / 0–2 / 5–7 | Vacantes | No en el top 2 |
| soacha, envigado, bello, rionegro, itagui | 1–29 / 0 / 2–7 | Vacantes | No hay hub |
| facatativa, yopal, sincelejo | 14–21 / 0 / 2–4 | Vacantes | No hay hub |
| arquitecto | 83 / 6 / 4,2 | Vacante «arquitecto Bucaramanga» (6 clics) | No hay hub de rol |
| ingeniero civil | 75 / 1 / 5,9 | Vacantes | El hub no está en el top 3 |
| enfermer* | 195 / 1 / 5,3 | Vacantes | El hub de auxiliar de enfermería no está en el top 3 |
| auxiliar administrativ* | 91 / 1 / 3,9 | Vacantes | El hub no está en el top 3 |
| analista de datos | 35 / 0 / 5,7 | Vacantes | No hay hub |
| nueva esparta | 37 / 2 / 5,6 | Vacante (Porlamar) | No hay hub |
| merida | 20 / 0 / 7,1 | Vacante | No hay hub |

Una URL de vacante aparece en GSC con el parámetro `utm_campaign` (enlace de
Google Empleos). Hay que comprobar que su canonical apunte a la URL limpia.

### SERP de «empleo bogota» (Bing, top 10)

Aparecen elempleo.com (2 URL), co.computrabajo.com y bogotatrabaja.gov.co, que
es la agencia distrital. Compiten páginas de ciudad de portales grandes y la
bolsa pública, no vacantes sueltas.

### Conclusiones de la segunda tanda

1. **El problema principal no es que falten páginas, sino que los hubs no
   posicionan.** En todas las ciudades medidas, Google prefiere nuestras
   vacantes sueltas, que están en las posiciones 2–7, al hub. El hub está en
   10–46 o ni aparece. Mejorar los hubs existentes (contenido propio,
   enlaces internos desde las vacantes, título) va antes que crear hubs
   nuevos.
2. **Las páginas de intención nacionales pesan más que cualquier ciudad**:
   «remoto» (182) y «sin experiencia» (145) superan a «trabajo en bogota»
   (100). Por eso van primero en la Fase C: arreglar y potenciar
   `/empleos/remoto` y crear `/empleos/sin-experiencia`.
3. **Títulos de hub en la forma «Trabajo en {ciudad}»**: se busca el doble que
   «empleos {ciudad}». Es un experimento barato, medido 28 días en 3–5 hubs.
4. **Hay que reordenar las ciudades por demanda real**:
   - prioridad: Bogotá, Cali, Medellín, Barranquilla, Bucaramanga, Cartagena
     y Pereira;
   - después: Ibagué, Pasto, Villavicencio, Santa Marta, Soacha y Cúcuta;
   - **bajan**: Barrancabermeja, Montería, Popayán y, en Venezuela, Maturín.
5. **Intenciones nuevas que merecen página**, si el clasificador real llega
   a ≥10 vacantes: «por días», «fines de semana», «para estudiantes» y
   «temporal» (diciembre).
6. **Marca:** «computrabajo» tiene ~29 veces la demanda de «trabajo en
   bogota». La gente busca portales por su nombre, así que la marca
   «buscotrabajo» (TikTok, prensa, enlaces) es una palanca SEO de primer
   nivel.

## 7. Límites de este estudio

- La interfaz de GSC llegó a su tope de 1.000 filas en Colombia: falta la
  cola y las consultas anonimizadas. La solución gratuita es la API o Looker
  Studio (sección 3).
- «Posiciona hoy» se midió sin filtro de país y solo en los clústeres
  marcados. Las filas «sin medir» se completan en la siguiente tanda.
- Los conteos con `search=` son coincidencias de texto y sobrestiman. No
  sirven como guarda de la Fase C, que debe usar el clasificador real.
- Bing es una fracción pequeña del mercado. Trends no da volumen.
  Autocomplete solo prueba que la consulta existe.
- La segunda tanda (6b) usa índices relativos de Trends, no volúmenes. No hay
  volumen absoluto de Google sin Keyword Planner.
- No se abrieron Keyword Planner ni Ubersuggest: crear una cuenta y aceptar
  términos le corresponde al propietario. Las cifras de Ubersuggest citadas
  vienen del video y no están verificadas.
- No se cambió código ni datos, y no se pagó nada.
