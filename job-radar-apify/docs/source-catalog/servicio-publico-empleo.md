# Servicio Público de Empleo (SPE) de Colombia: denominador y fuente

Investigación `source-researcher` del 2026-10-20 para
`docs/adr/0006-direct-employers.md` §7 / §7.1. Pregunta: ¿sirve el SPE
(Unidad Administrativa Especial del Servicio Público de Empleo, UAESPE) como
(a) denominador de cobertura y (b) fuente de vacantes? Leyenda: **[DOC]**
documentado oficialmente; **[OBS]** observado, no garantizado; **[NV]** no
verificado.

## 0. Conclusión

**(B) Solo denominador, y solo de volumen (puestos de trabajo), no de empresas.**
No usable como fuente de vacantes. No hay dataset del SPE en datos.gov.co.

- Fuente de vacantes: **NO.** Los Términos y Condiciones prohíben "reproducción,
  copia o uso no autorizado de los contenidos" (incluye "bases de datos"); el
  buscador no tiene API pública documentada ni licencia de reutilización.
- Denominador: **DataEmpleo** (agregados oficiales mensuales del SPE). Cifra
  exacta en §6.

## 1. Obligación legal

### 1.1 Ley 1636 de 2013, art. 31 (modificado por art. 12 Ley 2225 de 2022) [DOC]

> "ARTÍCULO 31. DEL CARÁCTER OBLIGATORIO DEL REGISTRO DE VACANTES EN EL SERVICIO
> PÚBLICO DE EMPLEO. Todos los empleadores están obligados a reportar sus
> vacantes al Servicio Público de Empleo de acuerdo a la reglamentación que
> para la materia expida el Gobierno. [...] PARÁGRAFO. El Gobierno nacional
> reglamentará las sanciones para los empleadores que no reporten sus vacantes
> al Servicio Público de Empleo."

### 1.2 Decreto 1072 de 2015, art. 2.2.6.1.2.12 "Del Registro de Vacantes" (origen: Decreto 2852 de 2013, art. 13) [DOC]

- Aplica a "los empleadores particulares y los no sometidos al régimen del
  servicio civil": registran vacantes en el SPE "a través de cualquier prestador
  autorizado, dentro de los diez (10) días hábiles siguientes a la existencia de
  las mismas".
- Vigencia: la fija el empleador; "ninguna vacante podrá tenerse como activa
  por un término superior a seis (6) meses".
- Par. 2: desde el 1-jul-2014 todos los empleadores registran vacantes; el
  Ministerio del Trabajo "establecerá los mecanismos para hacer seguimiento y
  promover el registro".
- **Par. 3 (excepciones):** "Se exceptúan de la obligación de registro de
  vacantes, aquellas que tengan reserva o restricciones de orden legal o
  reglamentario. Adicionalmente, de conformidad con la solicitud expresa que
  haga el empleador, podrán exceptuarse de la publicación aquellas vacantes
  relacionadas con cargos estratégicos, proyectos especiales, posiciones
  directivas en mercados e industrias especializadas y las demás vacantes que
  por su naturaleza no deban ser públicas".
- **Par. 4:** el Gobierno "reglamentará el reporte de vacantes y su relación con
  el Servicio Público de Empleo para las entidades de la Administración
  Pública" (el sector público queda fuera de la regla general; DAFP, Concepto
  015281 de 2020).
- Art. 2.2.6.1.2.13: la información de la vacante sobre educación, experiencia y
  salario "deberá estar disponible para quien desee consultarla" en el sistema.
- Reglamentación del reporte: Resolución 2605 de 2014 (mod. Res. 2047 de 2021)
  [según reseña, texto no leído]; en julio de 2025 el MinTrabajo publicó un
  proyecto para modificarla; **[NV]** si se expidió.
- Ley 2466 de 2025 (reforma laboral): **[OBS]** el texto consolidado de Ley 1636
  en Senado y el Decreto 1072 en Función Pública (consultados 2026-10-20) no
  mencionan la Ley 2466; las notas de vigencia del art. 31 solo registran la
  Ley 2225 de 2022. No se leyó el texto de la Ley 2466 (**[NV]** que no toque el
  tema).

### 1.3 Sanciones [DOC / NV]

El par. del art. 31 delega al Gobierno reglamentar sanciones a empleadores. Las
multas de los arts. 38-39 Ley 1636 (26,31 a 131.565 UVT; Decreto 1072 arts.
2.2.6.1.2.19 y .43) están redactadas para **prestadores** (gestión y colocación).
**[NV]** no se encontró un régimen sancionatorio efectivo para empleadores que no
reportan. Inferencia [OBS]: el cumplimiento es probablemente bajo.

### 1.4 Sesgos del denominador

1. No cubre sector público (par. 4) ni vacantes reservadas/exceptuadas.
2. Obligación sin sanción a empleadores conocida: subregistro probable, sobre
   todo en multinacionales/empresas con ATS propio que no replican al SPE.
3. Mucho volumen viene de prestadores de baja/mediana calificación (cajas de
   compensación, SENA/APE, alcaldías) [NV: composición por prestador no medida];
   sesgo hacia Bogotá/Medellín/Cali (60,1-60,6 % de las ofertas en jul/ago 2026,
   [OBS]).
4. Vigencia hasta 6 meses y posible duplicación de una plaza entre prestadores
   [NV: no medido]; "ofertas" no son empresas (ver §6).

## 2. Datos abiertos (datos.gov.co, Socrata)

### 2.1 Búsqueda en el catálogo [OBS]

Consultas a `https://api.us.socrata.com/api/catalog/v1?domains=www.datos.gov.co&q=...`
con: servicio público de empleo, vacantes, unidad del servicio público de
empleo, oferentes, bolsa única de empleo, colocaciones, intermediación laboral,
agencia pública de empleo, prestadores. **Resultado: la UAESPE no aparece como
publicadora en datos.gov.co; no hay dataset nacional de vacantes registradas
del SPE.** (Búsqueda por texto; no se descarta un dataset con nombre no
relacionado, **[NV]**.) Hallazgos relacionados, ninguno sirve como denominador
de vacantes:

| id | nombre | dueño | datos actualizados | notas |
|---|---|---|---|---|
| `8pqf-rmzr` | Total Nacional inscritos en la agencia pública de empleo SENA | SENA | 2020-10-14 | 566 filas, agregado por ocupación, **inscritos** (oferentes) 2019-2020; licencia CC BY-SA 4.0 |
| `tgvn-r2n9` | AGENCIA DE EMPLEO - COLOCACION | Instituto Municipal de Empleo (Bucaramanga) | 2023-05-30 | colocaciones municipales por registro (sexo, edad, ocupación, sector); sin NIT |
| `j89n-iqzx` | OFERENTES REMITIDOS A EMPLEADORES-PEREIRA | Alcaldía de Pereira | 2025-07-29 | oferentes, local |
| `r29n-7bcm` | Sanciones por intermediación laboral indebida | MinTrabajo | 2026-07-17 | no es de vacantes |
| `76r6-akrw` | Plan Anual de Vacantes | Alcaldía de Zetaquira | 2025-09-15 | planta pública, no mercado |

GET real `https://www.datos.gov.co/resource/8pqf-rmzr.json?$limit=5` [OBS]:
HTTP 200, JSON con columnas `id, nombre_de_la_ocupaci_n, nivel,
n_mero_de_inscritos_2019, n_mero_de_inscritos_2020, participacion_2019,
participacion_2020, variacion_2020_vs_2019, contribuci_n_a_la_variaci`;
`$select=count(*)` devuelve 566. Sin empresas ni vacantes. No sirve.

`tgvn-r2n9` con `$limit=3` devuelve campos de personas colocadas (mes, sexo,
edad, ciudad, proceso, sector); se omiten los valores por ser personales.

### 2.2 DANE / GEIH [OBS]

datos.gov.co aloja GEIH (`nzxb-qax7` 2026, `rpws-7zjb` 2025, etc.): encuesta a
hogares que mide ocupados/desocupados, **no vacantes ni empresas**. No se
encontró en DANE una operación de vacantes. **[NV]** que no exista una
experimental.

## 3. Estadísticas oficiales del SPE: DataEmpleo

- Portal: `https://dataempleo.serviciodeempleo.gov.co/dataempleo/#/home`.
  Anunciado en
  `https://www.serviciodeempleo.gov.co/blog/2024/05/27/dataempleo-la-innovadora-herramienta-del-spe-para-monitorear-el-empleo-en-colombia/`.
- [DOC] Contiene "características agregadas de las ofertas de empleo registradas
  mensualmente por la red de prestadores", buscadores registrados y colocaciones
  (SISE). Rezago de un mes, publicado el último día hábil de cada mes.
- SPA React sin API pública documentada. El front llama a un backend Express sin
  autenticación `https://dataempleo.serviciodeempleo.gov.co/dataempleobackend/v1/`
  con `GET /version`, `/slider`, `/graph?page=N`, `/file`, `/file/folders`
  (**[OBS], no documentado, no garantizado**; sin licencia/ToS específica de la
  API; aplican los T&C generales, §5). Se hicieron 7 GET en total.
- Anexos descargables (xlsx/pdf) listados en `/file`: "Anexo estadístico puestos
  de trabajo RED" y "... por Departamento" (mensual, hasta ago-2026),
  "Caracterización de Empresas registradas en SISE" (2022), "Anexo de empresas
  registradas SISE" (2023), "Estudio de suficiencia y cobertura del SPE 2025 con
  datos 2024". **No se descargaron ni se leyeron [NV].**
- Calidad [OBS]: errores de captura (nov-2025 con `graphValues` en miles, 160 vs 160.029 en el texto;
  oct-2025 con `datasetLabel` invertido; id 30 con título "Colocaciones (SISE)"
  pese a ser la misma serie RED, su texto confirma 144.874).
  Verificar manualmente la serie.

## 4. Buscador de empleo (buscadordeempleo.gov.co)

- SPA Vite/React sobre backend propio
  `https://www.buscadordeempleo.gov.co/backbue/v1` ([OBS], visto en el JS
  público; hay rutas `vacantes/export/csv/async`, `estadisticas/filtros`,
  `user/`). **API no pública ni documentada.** Solo se hizo
  `GET /backbue/v1/version` (200 JSON). No se consultó ningún endpoint de
  vacantes.
- Sin documentación de API, sin licencia de reutilización, sin términos
  específicos; remite a los T&C generales del SPE (§5). Login/CAPTCHA/anti-bot:
  **[OBS]** el JS público no contiene referencias a captcha/recaptcha/turnstile
  ni a cabeceras Authorization/Bearer; no se ejercitó la búsqueda, así que no
  consta el comportamiento real ante tráfico automatizado.
- robots.txt:
  - `https://www.buscadordeempleo.gov.co/robots.txt` y sin `www`: **HTTP 404**
    (Apache). Por RFC 9309 §2.3.1.3 equivale a "todo permitido", pero no
    sustituye a los T&C.
  - `https://dataempleo.serviciodeempleo.gov.co/robots.txt`: **301 en bucle**
    (redirige a una URL con `dataempleo` repetido); tratar como no disponible.
  - `https://www.serviciodeempleo.gov.co/robots.txt` (HTTP 200, Last-Modified
    2025-10-23), literal:

```
User-agent: *
Disallow: /wp-admin/
Disallow: /wp-content/ai1wm-backups/
```

## 5. Términos y condiciones [DOC]

`https://www.serviciodeempleo.gov.co/wp-content/uploads/2025/09/Documento-terminos-y-condiciones.pdf`
(enlazado desde el pie del sitio):

- 1.3 Prohibido: "Reproducción, copia o uso no autorizado de los contenidos
  publicados" e "Interferencia con la seguridad e integridad de los sistemas y
  datos".
- 1.4 "Todos los contenidos [...] (textos, imágenes, documentos, bases de datos,
  políticas, manuales, aplicativos [...]) se encuentran protegidos por las
  normas nacionales e internacionales de derechos de autor".
- 6 "Queda prohibida la reproducción, distribución o modificación de los
  contenidos sin autorización expresa" (cita Ley 23 de 1982, Decisión Andina
  351, Ley 1915 de 2018).
- 3.2 La entidad no responde por errores de información publicada por
  empleadores o prestadores.
- Datos personales de oferentes bajo Ley 1581 de 2012.

Interpretación: la extracción automatizada de vacantes del buscador requeriría
autorización expresa de la UAESPE. Citar agregados estadísticos con atribución es
de bajo riesgo; copiar el listado de vacantes no se propone.

## 6. Cifra exacta para el denominador

Unidad: **"Ofertas de empleo registradas (RED)"**, que el anexo del SPE llama
"puestos de trabajo RED": puestos/plazas ofertadas por la red de prestadores,
**no vacantes únicas ni empresas** [OBS por nombre del anexo; definición
completa en el Anexo metodológico, **[NV]**].

Fuente: `GET https://dataempleo.serviciodeempleo.gov.co/dataempleobackend/v1/graph?page=1`
(y `page=2`), serie "Ofertas de empleo registradas (RED)", `graphValues`
(índice 1 = año actual) cruzado con el total que da el campo `description` de
cada mes. Consulta 2026-10-20 [OBS]. Nota: datos.gov.co no tiene el dataset, así
que esta cifra viene del backend no documentado de DataEmpleo, no de Socrata:

| período | puestos RED |
|---|---|
| ago-2026 | **144.242** (ago-2025: 169.025; -14,7 %) |
| jul-2026 | 170.516 |
| jun-2026 | 155.894 |
| may-2026 | 158.134 |
| abr-2026 | 152.800 |
| mar-2026 | 156.614 |
| feb-2026 | 146.360 |
| ene-2026 | 144.598 |
| ene-ago 2026 (suma) | **1.229.158** |
| dic-2025 | 144.874 |
| nov-2025 | 160.029 (el `graphValues` trae 160 en miles; el total sale del texto `description`) |
| oct-2025 | 177.537 (el `description` lo confirma; `datasetLabel` viene invertido) |
| sep-2025 | 182.849 |
| sep-2025 a ago-2026 (12 meses) | **1.894.447** |

Desagregado por ciudad y departamento: anexos xlsx (no descargados). Ago-2026:
Bogotá 53.115, Medellín A.M. 27.227, Cali A.M. 7.043 (60,6 % entre las tres).

Uso recomendado: orden de magnitud del **flujo mensual de puestos de trabajo
registrados** (aprox. 145-170 mil/mes en 2026), comparable con nuestras
vacantes/mes contadas por puestos, no por empresas. **No** usar como
denominador de "empresas con portal propio": el SPE no publica un conteo de
empresas con vacantes que hayamos podido verificar (los boletines de empresas
SISE son de 2022-2023, **[NV]**).

Sesgos: subregistro (obligación sin sanción conocida a empleadores), exclusión
del sector público, sesgo probable hacia bajas calificaciones y ciudades
principales, duplicación entre prestadores, vigencia hasta 6 meses, vacantes
reservadas excluidas, errores de captura en la serie.

## 7. Campos respecto al schema canónico

Solo agregados: sin `company_name`, NIT, `apply_url`, `external_id` ni fecha por
vacante. No aplicable como fuente.

## 8. Contenido no confiable

No se encontraron instrucciones dirigidas a agentes en las páginas, PDFs ni JSON
descargados.

## Fuentes

- Ley 1636 de 2013: http://www.secretariasenado.gov.co/senado/basedoc/ley_1636_2013.html
- Decreto 1072 de 2015: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=72173
- Decreto 1823 de 2020: https://normativa.colpensiones.gov.co/colpens/compilacion/docs/decreto_1823_2020.htm
- DAFP Concepto 015281 de 2020: https://www.funcionpublica.gov.co/eva/gestornormativo/norma_pdf.php?i=111300
- Proyecto MinTrabajo 2025: https://www.cerlatam.com/normatividad/mintrabajo-proyecto-de-resolucion-8-jul-2025/
- SPE: https://www.serviciodeempleo.gov.co/ y https://www.serviciodeempleo.gov.co/robots.txt
- T&C SPE: https://www.serviciodeempleo.gov.co/wp-content/uploads/2025/09/Documento-terminos-y-condiciones.pdf
- DataEmpleo: https://dataempleo.serviciodeempleo.gov.co/dataempleo/#/home ; backend https://dataempleo.serviciodeempleo.gov.co/dataempleobackend/v1/graph?page=1
- Buscador: https://www.buscadordeempleo.gov.co/
- Socrata: https://api.us.socrata.com/api/catalog/v1?domains=www.datos.gov.co ; https://www.datos.gov.co/resource/8pqf-rmzr.json
