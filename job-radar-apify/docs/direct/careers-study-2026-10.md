# Estudio: ¿cuántas empresas de BuscoTrabajo tienen su propia página de empleo?

**Fecha:** 2026-10-28. **Pedido del dueño:** tomar todas las empresas que hay en BuscoTrabajo, revisar una por una si tienen página de empleo con ofertas en su propia plataforma y dar un número real.

## Respuesta corta

- BuscoTrabajo tiene **8.640 empresas** con vacantes vigentes en bolsas (27.953 vacantes). Ya están excluidas 45 agencias de empleo conocidas (3.616 vacantes), así que el universo es de **8.595 empresas y 24.337 vacantes**.
- **Hoy leemos el portal oficial de 111 de ellas** (1,3 %).
- **Solo las empresas grandes se revisaron una por una.** Son las 135 claves con 20 o más vacantes, que corresponden a 131 empresas distintas porque 4 están duplicadas. De ellas:
  - **52 (40 %) tienen página oficial con listado de vacantes**: 11 ya cubiertas y 41 que todavía no leemos.
  - Estas 52 suman el 43 % de las vacantes del grupo.
  - Las demás publican solo en bolsas (36), son agencias o nombres anónimos (23), no se pudieron determinar (17) o no tienen listado propio (3).
- **El resto de empresas se estimó con una muestra al azar.**
  - Entre las empresas con 2 a 19 vacantes habría unas **870** con portal propio (95 %: 400 a 1.340).
  - En la muestra de empresas con 1 vacante, ninguna de 20 tenía portal. Con esa muestra solo se puede decir que serían como mucho unas 800.
- **Total aproximado: unas 900 empresas (≈ 11 %) con página propia con listado**, casi todas medianas o grandes. Es una estimación de orden de magnitud, no un conteo.

En pocas palabras, la gran mayoría de las empresas del directorio no tiene un portal de empleo que se pueda leer. Lo que sí tiene portal es un grupo de unos cientos de empresas medianas y grandes, y la mayoría todavía no las leemos.

## Método

1. **Lista completa:** un export de solo lectura de `employer_discovery` (modo `directory-export` del tick, [corrida 40790351929](https://github.com/Yosmanovallos/Job-finder/actions/runs/40790351929)). Una fila por empresa, con sus vacantes vigentes en bolsas, la decisión del descubrimiento y sus tableros habilitados.
2. **Concentración:** las ofertas están muy repartidas entre empresas.

   | Tamaño (vacantes en bolsas) | Empresas | Vacantes | % de vacantes |
   |---|---:|---:|---:|
   | 20 o más | 135 | 5.870 | 24 % |
   | 5 a 19 | 880 | 7.406 | 30 % |
   | 2 a 4 | 2.228 | 5.709 | 23 % |
   | 1 | 5.352 | 5.352 | 22 % |

3. **Las 135 grandes, una por una.** Cada empresa se buscó en la web y quedó en una sola categoría, con su evidencia. Para las 41 con página oficial que aún no leemos, la tabla dice cómo se verificó:
   - **13 se confirmaron en el sitio**: se abrió la página y se vieron las vacantes, o se leyó por API.
   - **1 tiene sitio propio, pero su listado no es visible** porque es una app de JavaScript.
   - **27 se basan en resultados de búsqueda o en prensa.** En esos casos el listado del sitio carga con JavaScript o no se abrió.
4. **El resto, por muestra.** Se sacaron 20 empresas al azar de cada estrato (5–19, 2–4 y 1 vacante), con semilla fija `20261028`, y se clasificaron con el mismo método.
   - El intervalo del 95 % junta la varianza de los estratos de 5–19 y de 2–4, con corrección por población finita.
   - El estrato de una vacante se informa aparte porque en él no se encontró ningún caso.
5. Nada se escribió en la base de datos y no se habilitó ningún tablero. No se corrieron canarios contra los ATS: esos requieren aprobación aparte.

**Categorías usadas:**

- **a.** ATS o portal corporativo con listado (Workday, Phenom, SuccessFactors, Greenhouse, Jobvite, Gupy, Radancy y otros).
- **b.** Sitio propio con listado de vacantes.
- **p.** Portal propio alojado en una bolsa colombiana: página de empresa en Magneto, Pandapé de Computrabajo o sitio empresarial de elempleo. Cuenta solo cuando hay evidencia de que la empresa lo usa como su canal oficial.
- **c.** "Trabaja con nosotros" que solo recibe la hoja de vida, sin listado.
- **d.** Solo publica avisos sueltos en bolsas (Computrabajo, elempleo, Magneto, Indeed, LinkedIn).
- **e.** Sin sitio de empleo.
- **f.** No determinable: la empresa no se identificó o el portal está bloqueado.
- **x.** Agencia, temporal, outsourcing de personal, la propia bolsa, o nombre anónimo (iniciales o nombre de persona).

## Resultados

### Las empresas grandes (131 distintas, revisadas una por una)

| Categoría | Empresas | Vacantes en bolsas |
|---|---:|---:|
| Ya cubiertas (tablero habilitado) | 11 | 574 |
| a · ATS o portal corporativo | 16 | 590 |
| b · Sitio propio con listado | 12 | 872 |
| p · Portal en una bolsa (Magneto, Pandapé, elempleo) | 13 | 490 |
| **Con página oficial con listado** | **52 (40 %)** | **2.526 (43 %)** |
| c · Solo formulario | 2 | 58 |
| d · Solo avisos en bolsas | 36 | 1.389 |
| e · Sin sitio de empleo | 1 | 290 |
| f · No determinable | 17 | 870 |
| x · Agencia, staffing o anónimo | 23 | 737 |

### El resto (muestra de 60)

| Estrato | Muestra con página oficial | Estimación para el estrato |
|---|---:|---:|
| 5–19 vacantes (880) | 7 de 20 | ~310 |
| 2–4 vacantes (2.228) | 5 de 20 | ~560 |
| **5–19 y 2–4 juntos** | 12 de 40 | **~870 (95 %: 400–1.340)** |
| 1 vacante (5.352) | 0 de 20 | 0 observadas; como mucho ~800 |

Así se repartió el resto de la muestra:

- **5–19:** 6 solo bolsas, 4 agencias o anónimos, 3 no identificadas.
- **2–4:** 6 solo bolsas, 4 agencias o anónimos, 3 no identificadas, 2 sin sitio.
- **1 vacante:** 9 no identificadas, 5 nombres de persona o iniciales, 3 sin sitio, 3 solo bolsas.

En la muestra, la mayoría de los casos a y b también se clasificó con resultados de búsqueda y no abriendo el listado.

## Hallazgos

1. **El descubrimiento automático pierde empresas grandes que sí tienen portal.**
   - Mastercard (Phenom), Cargill (Radancy), Kuehne+Nagel, NTT DATA (SuccessFactors), Thermo Fisher, Marsh (Phenom), Iron Mountain, Gallagher, Wood y Worley aparecen en los resultados de búsqueda con vacantes en Colombia dentro de su propio dominio.
   - Aun así, el descubrimiento las marcó `not_found`, en varios casos teniendo su dominio.
   - En Marsh se confirmaron 3 vacantes en Bogotá dentro del sitio. Las demás se confirmaron por búsqueda.
2. **Muchas corporativas colombianas usan Magneto como su portal de empleo.** Estas páginas de empresa se verificaron con sus cupos:

   | Empresa | Cupos en Magneto |
   |---|---:|
   | Homecenter | 1.073 |
   | Zentria | 760 |
   | Keralty | 756 |
   | Manufacturas Eliot | 490 |
   | Banco de Occidente | 372 |
   | Crystal/GCO | 326 |
   | Coomeva | 298 |
   | Intelcia | 242 |
   | Aris Mining | 193 |
   | Postobón | 124 |
   | Seguros Bolívar | 101 |

   - Keralty quedó en d porque no hay evidencia de que Magneto sea su canal oficial.
   - El conector de Magneto existe, pero lee como máximo 20 vacantes por empresa. Por decisión del 2026-10-20, además, solo se usa si el sitio propio de la empresa enlaza a Magneto, y ese enlace no se verificó en este estudio.
   - Las empresas grandes de Magneto quedan fuera hasta que haya una forma completa de leerlas.
3. **Hay otras plataformas sin conector que aparecen varias veces:**
   - la red de DirectEmployers (dominios `.jobs` y `dejobs.org`): Iron Mountain, Kuehne+Nagel, Thermo Fisher, Otis y Stanley Black & Decker;
   - Pandapé de Computrabajo (Solvo Global);
   - Gupy (Stefanini), Jobvite (Lean Solutions) y Radancy (Cargill);
   - sitios empresariales de elempleo (Banco W, Sacyr).
4. **Más de un cuarto de las grandes solo publica en bolsas.** Ejemplos: Inter Rapidísimo, Prosegur, SYNLAB, AXA Colpatria, Bold, Securitas y Nueva EPS. Para ellas no existe un portal oficial que leer, y la bolsa es la fuente.
5. **El directorio tiene ruido que infla el denominador:**
   - En las grandes hay 17 agencias, temporales o empresas de staffing que no están en la lista de agencias, como Redes Humanas, Tiempos, Human Servicess, Soluciones Inmediatas, Job Duck, Emapta y Pavago.
   - Hay 6 nombres reducidos a iniciales y 4 empresas duplicadas bajo dos claves: Solvo Global, Coomeva, D1 y BBVA. En la cola también aparece Américas BPS.
   - En la cola, cerca de un cuarto de la muestra son agencias, nombres de persona o iniciales.
   - FullStack Labs tuvo un tablero Lever con vacantes en Colombia que hoy ya no responde.

## Qué podemos hacer (opciones para decidir)

1. **Canarios para grandes con un ATS que ya tiene conector.**
   - Candidatas: NTT DATA (SuccessFactors), Thermo Fisher y Stanley Black & Decker (Workday), y Marsh y Mastercard (Phenom).
   - Antes hay que confirmar el tenant y la URL exactos de cada una con un canario, que requiere aprobación.
   - Encora (Greenhouse) y Blend360 (SmartRecruiters) ya están en el inventario de I2, y el sondeo programado se encarga de ellas.
2. **Resolver Magneto para empresas grandes.** Es la palanca más grande en corporativas colombianas.
   - Hoy el conector lee 20 vacantes por empresa y no se puede paginar sin violar robots.txt.
   - Hay que investigar si Magneto ofrece un feed o un acuerdo. Cambiar la regla del 2026-10-20 es decisión del dueño.
3. **Conectores nuevos, por orden de frecuencia:** red DirectEmployers, Pandapé, Radancy, Gupy y Jobvite.
   - Cada uno es una fase con su catálogo de fuente, fixtures y canario, siguiendo el skill `build-source-adapter`.
4. **Limpiar el directorio:** sumar las agencias halladas a `data/direct-discovery-agencies.json`, filtrar los nombres con iniciales o de persona, y unir las claves duplicadas.
   - El porcentaje de cobertura queda honesto y el descubrimiento deja de gastar sondeos en ellas.
5. **Revisar una por una las 880 empresas de 5–19 vacantes.** Es el estrato con más empresas estimadas con portal (~310) y con la incertidumbre más alta.
6. **No perseguir la cola de una vacante.** Según la muestra, casi ninguna tiene portal, así que esas vacantes seguirán llegando por las bolsas.

## Revisión una por una de las 880 empresas con 5 a 19 vacantes (completa)

Pedido del dueño del 2026-10-28. La revisión va en orden de mayor a menor número de vacantes. Los resultados quedan línea por línea en las notas de la sesión; aquí están sumados.

- **Antes de buscar en la web se separaron 195 empresas:**
  - 30 ya cubiertas.
  - 19 ya revisadas en la muestra.
  - 105 nombres anónimos (iniciales o persona), clasificados por el nombre.
  - 41 agencias o temporales que lo dicen en el nombre.
- **Revisadas una por una: las 685 que quedaban** (197 con 10 a 19 vacantes y 488 con 5 a 9). Resultado: **157 tienen página oficial con listado (23 %)**. Sumadas las 30 ya cubiertas, son al menos 187 de las 880.

  | Resultado | 10 a 19 vacantes | 5 a 9 | Total |
  |---|---:|---:|---:|
  | **Página oficial con listado** | **55 (28 %)** | **102 (21 %)** | **157 (23 %)** |
  | ATS o portal corporativo | 35 | 66 | 101 |
  | Sitio propio | 12 | 16 | 28 |
  | Portal en una bolsa | 8 | 20 | 28 |
  | Solo bolsas | 87 | 122 | 209 |
  | No determinables | 37 | 211 | 248 |
  | Agencias o staffing | 17 | 52 | 69 |
  | Solo formulario | 1 | 1 | 2 |

- **Cuarta tanda (163 empresas, 2026-10-29).** También todo por búsqueda o prensa (Primavera, por el nombre). Salen 30 páginas oficiales más: 17 portales corporativos, 4 sitios propios y 9 portales en una bolsa (sobre todo Magneto; TCL, por ejemplo, según prensa). Entre las ATS aparecen iCIMS (StoneX, Crawford, Liberty Latin America), Avature (Siemens Energy), Teamtailor (Enertis Applus), SmartRecruiters (SGS, `americasgbs`), Gupy (Decathlon) y Greenhouse (Axon, Exadel).
- **Criterio desigual con los portales conocidos:** en esta tanda, multinacionales con portal global conocido que no apareció en los resultados (Rockwell, PMI, TikTok, GM, Canonical, dentsu, Unisys, Würth, XM) quedaron como "no determinable". En tandas anteriores algunas así se contaron como ATS. Por eso el 21 % de las de 5 a 9 es un piso, no un valor exacto.
- **Tercera tanda (159 empresas, 2026-10-28/29).** Tiene el mismo nivel de verificación que la segunda: todo por búsqueda o prensa. De sus 22 portales corporativos, unos 14 salieron con su URL en los resultados, entre ellos BNP Paribas (56 a 82 ofertas en Bogotá), TMF Group (Avature), BD, Henkel, HubSpot, VML, Capgemini y Minor Hotels. Los demás son portales conocidos, citados por prensa o vistos solo en réplicas.
- **Ruido en el directorio:** Hy-Vee (EE. UU.) y Otomoto (Polonia) no tienen presencia en Colombia; lo de Hy-Vee probablemente viene de una confusión con Columbia (EE. UU.). Conviene revisar de dónde salen esas vacantes.
- **Grupo Aval tiene un portal común (Talento Aval)** que agrupa vacantes de AV Villas, Porvenir, Banco de Bogotá, Occidente y Popular.
- **La verificación es más débil en la segunda tanda (152 empresas, 2026-10-28).**
  - Casi todas se clasificaron solo por búsqueda o prensa; ninguna se abrió en su sitio.
  - De sus 25 portales corporativos, 12 aparecieron con su URL en los resultados (por ejemplo Boston Scientific, Amgen, WTW, Intellias, Ingram Micro, Dev.Pro). Los otros 13 son portales globales conocidos, citados por prensa o vistos solo en réplicas como DirectEmployers.
  - Los 7 "portal en una bolsa" son páginas de Magneto o Pandapé. Salvo Gavinco (subdominio propio en Pandapé), no se confirmó que el sitio de la empresa enlace a ellas, que es la condición para usar el conector de Magneto.
  - Entre las de 5 a 9 sube la parte "no determinable" (65 de 166): son nombres ambiguos o empresas pequeñas sin rastro en la web.
- **Candidatas para conectores que ya existen** (no se probó nada):
  - Greenhouse: Kaseya (vacantes en Medellín), Pharmbills (tablero UE, vacante en Bogotá), Cloudbeds (tablero de terceros), Axon (`axontrainingargentina`) y Exadel. VML tiene IDs de vacante con forma de Greenhouse, sin confirmar.
  - SuccessFactors: Mota-Engil Colombia y Edgewell Personal Care (Bogotá).
  - Workday: Air Liquide (citado) y Autodesk (requisiciones 26WD…), sin ver el portal.
  - SmartRecruiters: SGS (`americasgbs`); el conector está deshabilitado por defecto (ADR 0002).
  - Teamtailor: Enertis Applus.
  - Ashby: el tablero `nubank` ya está en el inventario I2 como `ambiguous` y espera aprobación humana.
  - Frisby ya tiene conector propio (`scripts/canary-frisby.ts`), pero su clave del directorio no figura como cubierta; conviene revisar el alias.
- **Plataformas sin conector que vuelven a salir:** Gupy (Stefanini), Jobvite (GIGA IT), Radancy (Amgen, BD), DirectEmployers (Convatec, GE HealthCare, WSP, Zimmer Biomet), Avature (TMF Group, Siemens Energy), JazzHR (Massive Bio, MAS Global) e iCIMS (StoneX, Crawford, Liberty Latin America).
- **La proporción queda por debajo de la muestra:** 23 % frente a 35 % estimado para el estrato (7 de 20 en la muestra). Entre las de 5 a 9 crece mucho la parte "no determinable" (211 de 488): son nombres ambiguos o empresas pequeñas sin rastro en la web. Algunas podrían tener página sin que la búsqueda la mostrara.

## Canarios propuestos (esperan aprobación del dueño)

Son empresas del estudio que usan una plataforma con conector existente. Cada canario es `npx tsx scripts/direct-canary.ts <tipo> <ref>`: lee el tablero en vivo y no escribe nada. Si la ref está mal, el conector responde con error y no pasa nada más. Todas las refs pasan el patrón del conector (comprobado sin red). Ninguno se ha corrido.

**Lote A: ref vista en una URL de los resultados**

| Empresa | Vacantes en bolsas | Tipo | Ref |
|---|---:|---|---|
| Marsh | 52 (+5 de Marsh Risk) | phenom | `careers.marsh.com/global/en`; si falla, `careers.marshmclennan.com/global/en` |
| Mastercard | 43 | phenom | `careers.mastercard.com/us/en` |
| NTT DATA | 32 | successfactors | `careers-inc.nttdata.com` |
| Thermo Fisher | 21 | phenom | `jobs.thermofisher.com/global/en` |
| Alignerr | 16 | greenhouse | `alignerr` |
| BCD Travel | 11 | successfactors | `jobs.bcdtravel.com` |
| Kaseya | 8 | greenhouse | `kaseya` |
| Mota-Engil | 8 | successfactors | `careers.mota-engil.com` (SuccessFactors deducido por la forma de la URL) |
| Air Liquide | 6 | workday | `airliquidehr/wd3/AirLiquideExternalCareer` |
| Cloudbeds | 6 | greenhouse | `cloudbedsthirdpartyboard` |
| Edgewell | 6 | successfactors | `careers.edgewell.com` (SuccessFactors deducido por la forma de la URL) |
| Exadel | 5 | greenhouse | `exadelinc` |

**Lote B: ref deducida o citada por un tercero (más probable que falle)**

| Empresa | Vacantes en bolsas | Tipo | Ref |
|---|---:|---|---|
| Stanley Black & Decker | (grandes) | workday | `sbdinc/wd1/<sitio>`: falta el nombre del sitio |
| Autodesk | 5 | workday | `autodesk/wd1/Ext` (de memoria, sin fuente) |
| Enertis Applus | 5 | teamtailor | `applusgroup` (región sin confirmar) |
| Axon Training (Argentina) | 5 | greenhouse | `axon`: identidad sin confirmar; ese tablero puede ser Axon Enterprise, otra empresa |

**Quedan fuera:**

- Pharmbills: su tablero está en Greenhouse UE y el conector solo lee `boards-api.greenhouse.io`.
- VML, Aon, IQVIA y Essity: la plataforma no se confirmó. IQVIA parece Radancy, no Workday.
- Encora, Power Digital Marketing, AECOM, Kraken y Nu: ya están en el inventario I2, y las cubre el sondeo programado o la revisión humana pendiente.
- AMERICAS GBS: posible alias de SGS, por confirmar. SGS ya está en el seed con SmartRecruiters `SGS` habilitado.

## Datos

- Export completo: corrida [40790351929](https://github.com/Yosmanovallos/Job-finder/actions/runs/40790351929) (`scripts/direct-directory-export.ts`, solo lectura).
- La clasificación de cada empresa grande está en la tabla de abajo. La muestra de la cola se resume arriba. Sus filas individuales incluyen nombres de personas y no se publican.

## Las 135 claves grandes, una por una

#### Ya cubiertas: 11 empresas, 574 vacantes

| Empresa | Vacantes en bolsas | Dónde publica / evidencia |
|---|---:|---|
| Concentrix | 97 | tablero oficial ya habilitado en BuscoTrabajo |
| MetLife Colombia | 77 | tablero oficial ya habilitado en BuscoTrabajo |
| TP | 57 | tablero oficial ya habilitado en BuscoTrabajo |
| Softtek | 54 | tablero oficial ya habilitado en BuscoTrabajo |
| Altipal S.A.S | 51 | tablero oficial ya habilitado en BuscoTrabajo |
| BBVA en Colombia | 46 | tablero oficial ya habilitado en BuscoTrabajo |
| Bancolombia | 43 | tablero oficial ya habilitado en BuscoTrabajo |
| DHL Supply Chain | 36 | tablero oficial ya habilitado en BuscoTrabajo |
| Rappi | 33 | tablero oficial ya habilitado en BuscoTrabajo |
| Quala | 30 | tablero oficial ya habilitado en BuscoTrabajo |
| BBVA | 27 | misma empresa que la clave `bbvaen` (contada una vez); tablero oficial ya habilitado en BuscoTrabajo |
| Johnson & Johnson | 23 | tablero oficial ya habilitado en BuscoTrabajo |

#### a · ATS o portal corporativo con listado: 16 empresas, 590 vacantes

| Empresa | Vacantes en bolsas | Dónde publica / evidencia | Cómo se verificó |
|---|---:|---|---|
| Stefanini LATAM | 54 | Gupy (sin conector); vacantes LATAM en Gupy ([fuente](https://stefanini.com/es/carreras)) | búsqueda o prensa: no se abrió el listado en el sitio |
| Marsh | 52 | Phenom (careers.marshmclennan.com); página Bogotá con vacantes ([fuente](https://careers.marshmclennan.com/global/en/colombia-bogota-careers)) | sitio: 3 vacantes en Bogotá vistas en careers.marsh.com |
| Cargill | 51 | Radancy/TalentBrew (careers.cargill.com, sin conector); muchas vacantes CO (Cali, Bucaramanga, Arjona...); discovery marcó not_found pese a dominio cargill.com ([fuente](https://careers.cargill.com/en/job/cali/ejecutivo-a-tecnico-a-comercial-cerdos/23251/82403877968)) | búsqueda o prensa: no se abrió el listado en el sitio |
| Gallagher | 48 | jobs.ajg.com (sin conector); listado con filtro Colombia (Bogotá GCoE) ([fuente](https://jobs.ajg.com/jobs/country/Colombia)) | búsqueda o prensa: no se abrió el listado en el sitio |
| Wood | 46 | careers.woodgroup.com (sin conector confirmado); ~1.500 empleados en Bogotá; vacantes CO vistas en agregadores ([fuente](https://careers.woodgroup.com/life-at-wood/wood-triples-headcount-in-colombia-strengthening-global-engineering-centre)) | búsqueda o prensa: no se abrió el listado en el sitio |
| Mastercard | 43 | Phenom (careers.mastercard.com); página Bogotá con listado; discovery not_found pese a dominio mastercard.com ([fuente](https://careers.mastercard.com/us/en/bogota-colombia)) | búsqueda o prensa: no se abrió el listado en el sitio |
| Lean Solutions Group | 39 | Jobvite (jobs.jobvite.com/leantechio, sin conector); Medellín; contratos en Colombia vía temporal ([fuente](https://jobs.jobvite.com/leantechio/job/oOAqAfw8/apply)) | búsqueda o prensa: no se abrió el listado en el sitio |
| Essity | 35 | essity.com/careers (SuccessFactors probable, sin confirmar); vacantes CO (Bogotá, Yumbo, Rionegro, Guachené) ([fuente](https://www.essity.com/careers/jobs/JOB_POSTING-3-101707)) | búsqueda o prensa: no se abrió el listado en el sitio |
| Worley | 35 | Worley careers + SelectMinds (sin conector); oficina Bogotá con vacantes ([fuente](https://worleyparsons.referrals.selectminds.com/jobs/process-engineer-level-ii-12152)) | búsqueda o prensa: no se abrió el listado en el sitio |
| Encora Inc. | 32 | Greenhouse (greenhouse:encora, en el inventario ATS; el dry-run de I2 lo habilitaría); lo encontrará el sondeo del inventario en las próximas corridas | API: leído por el sondeo del inventario I2 (Greenhouse) |
| Inchcape Américas | 32 | inchcape.com careers (ATS sin confirmar); 2.300 empleados en Colombia; vacantes Bogotá y remotas ([fuente](https://inchcape.com/en/our-global-markets/americas/colombia)) | búsqueda o prensa: no se abrió el listado en el sitio |
| NTT DATA Europe & Latam | 32 | SuccessFactors (careers-inc.nttdata.com); Career Site Builder con vacantes Bogotá; conector SuccessFactors existe ([fuente](https://careers-inc.nttdata.com/job/BOGOTA-D_C_-Desktop-Support-Associate-Field-Tech-DC/1270326400)) | búsqueda o prensa: no se abrió el listado en el sitio |
| Iron Mountain | 26 | ironmountain.jobs (red .jobs/DirectEmployers, sin conector); varias vacantes Bogotá en su portal ([fuente](https://ironmountain.jobs/bogotá-col/digitador/0C3480115269438B8D4C11D3923B6877/job)) | búsqueda o prensa: no se abrió el listado en el sitio |
| Kuehne+Nagel | 24 | careers K+N (+ red DirectEmployers dejobs.org), sin conector; vacantes Bogotá/Funza/Tenjo; discovery not_found pese a dominio ([fuente](https://dejobs.org/production/jobs-in/kuehnenagel/careers)) | búsqueda o prensa: no se abrió el listado en el sitio |
| Thermo Fisher Scientific | 21 | jobs.thermofisher.com (Workday/Phenom); muchas vacantes Bogotá ([fuente](https://thermofisher.dejobs.org/bogotá-col/sales-representative-colombia-life-science/6BCA2B2D30C94A769166C9DB11E4B306/job)) | búsqueda o prensa: no se abrió el listado en el sitio |
| CI&T | 20 | ciandt careers (ATS sin confirmar); muchas vacantes 'Colombia' remotas ([fuente](https://co.indeed.com/cmp/Ci&T/jobs)) | búsqueda o prensa: no se abrió el listado en el sitio |

#### b · Sitio propio con listado: 12 empresas, 872 vacantes

| Empresa | Vacantes en bolsas | Dónde publica / evidencia | Cómo se verificó |
|---|---:|---|---|
| BairesDev | 313 | own (talent.bairesdev.com); portal propio remoto LATAM; listado en app JS sin datos en HTML ([fuente](https://talent.bairesdev.com/)) | sitio sin listado visible (app JavaScript) |
| EPAM Systems | 144 | own (careers.epam.com / anywhere.epam.com); listado propio con filtro Colombia; remotos para Colombia ([fuente](https://anywhere.epam.com/en/remote-colombia-it-jobs)) | búsqueda o prensa: no se abrió el listado en el sitio |
| Accenture Colombia | 74 | own (accenture.com/co-es/careers); portal propio con buscador; también elempleo/Computrabajo ([fuente](https://www.accenture.com/co-es/careers)) | búsqueda o prensa: no se abrió el listado en el sitio |
| AgileEngine | 67 | own (join.agileengine.com); listado propio con página Colombia, 140+ vacantes ([fuente](https://join.agileengine.com/colombia)) | sitio: 4 vacantes Colombia vistas en join.agileengine.com/colombia |
| Auxis | 46 | own (auxis.com/careers); 500+ empleos Bogotá/Barranquilla/Medellín ([fuente](https://www.auxis.com/careers)) | búsqueda o prensa: no se abrió el listado en el sitio |
| Inetum | 45 | inetum.com career; página de carrera Colombia; listados vigentes vistos solo en agregadores/elempleo ([fuente](https://inetum.com/en/node/2151)) | búsqueda o prensa: no se abrió el listado en el sitio |
| Applaudo | 31 | own (sin confirmar); vacantes Bogotá/Medellín vistas en agregadores ([fuente](https://builtin.com/company/applaudo/jobs)) | búsqueda o prensa: no se abrió el listado en el sitio |
| Keyrus | 30 | own (jobs.keyrus.co); portal propio de vacantes citado en prensa; no verificado hoy ([fuente](https://jobs.keyrus.co)) | búsqueda o prensa: no se abrió el listado en el sitio |
| Tiendas D1 | 29 | own (d1.com.co trabaja con nosotros); D1 dice gestionar vacantes solo por su portal; también aparece en Magneto ([fuente](https://d1.com.co)) | búsqueda o prensa: no se abrió el listado en el sitio |
| D1 S.A.S | 25 | misma empresa que la clave `tiendasd1` (contada una vez); own (d1.com.co); duplicado de tiendasd1 con otra clave ([fuente](https://d1.com.co)) | búsqueda o prensa: no se abrió el listado en el sitio |
| Mibanco | 24 | own (mibanco.com.co trabaja con nosotros); listado de vacantes en su sitio según prensa; también Computrabajo ([fuente](https://www.elcolombiano.com/empleos/contenidos/mi-banco-convocatoria-de-empleo-colombia-2025-MM28246758)) | búsqueda o prensa: no se abrió el listado en el sitio |
| Amaris Consulting  / Part of Mantu | 22 | own (careers.amaris.com / careers.mantu.com); oficinas Medellín/Bogotá; vacantes en su portal ([fuente](https://careers.amaris.com/jobs/37803)) | búsqueda o prensa: no se abrió el listado en el sitio |
| COLSUBSIDIO | 22 | own (colsubsidio.com trabaja con nosotros, 'Buscar ofertas'); listado propio según prensa; URL exacta no verificada ([fuente](https://www.portafolio.co/economia/empleo/colsubsidio-abre-697-vacantes-en-bogota-para-fortalecer-sus-servicios-farmaceuticos-501561)) | búsqueda o prensa: no se abrió el listado en el sitio |

#### p · Portal propio alojado en una bolsa (Magneto, Pandapé, elempleo): 13 empresas, 490 vacantes

| Empresa | Vacantes en bolsas | Dónde publica / evidencia | Cómo se verificó |
|---|---:|---|---|
| Solvo Global | 68 | Pandapé de Computrabajo (solvoglobal.pandape.computrabajo.com); ATS Pandapé de Computrabajo con subdominio propio + careers.solvoglobal.com ([fuente](https://solvoglobal.pandape.computrabajo.com/Detail/9886353)) | búsqueda o prensa: no se abrió el listado en el sitio |
| POSTOBON S.A. | 55 | Magneto ('Haz parte del talento Postobón' redirige a Magneto); ~2.000 vacantes activas (2025) vía Magneto; discovery not_found pese a dominio ([fuente](https://www.elcolombiano.com/empleos/contenidos/postobon-abrio-vacantes-en-colombia-2025-GF27118248)) | sitio: página Magneto con 124 cupos |
| Homecenter | 43 | Magneto (portal de Homecenter); usa Magneto como portal de empleo ([fuente](https://www.elcolombiano.com/empleos/contenidos/ofertas-de-empleo-en-homecenter-en-magneto-DI26959648)) | sitio: página Magneto de Homecenter con 1.073 cupos |
| Banco W | 35 | elempleo sitio empresarial; 'Únete a nuestro equipo' alojado en elempleo ([fuente](https://www.elempleo.com/sitios-empresariales/colombia/banco-w/index.asp)) | búsqueda o prensa: no se abrió el listado en el sitio |
| GCO | 34 | Magneto (Crystal/GCO); Crystal/GCO postula vía Magneto ([fuente](https://www.elcolombiano.com/empleos/contenidos/200-ofertas-de-empleo-en-crystal-magneto-JO26937284)) | sitio: página Magneto de Crystal S.A.S. con 326 cupos |
| Solvo Global Careers | 34 | misma empresa que la clave `solvoglobal` (contada una vez); Pandapé de Computrabajo (solvoglobal.pandape.computrabajo.com); duplicado de Solvo Global con otra clave ([fuente](https://solvoglobal.pandape.computrabajo.com/Detail/9886353)) | búsqueda o prensa: no se abrió el listado en el sitio |
| Manufacturas Eliot | 33 | Magneto (manufacturas-eliot-pash); página de empresa en Magneto, vacantes recientes (oct 2026) ([fuente](https://www.magneto365.com/co/empresas/manufacturas-eliot-pash/empleos/auxiliar-produccion-textil-1041728)) | sitio: página Magneto con 490 cupos |
| Grupo Coomeva | 28 | Magneto; postulaciones por Magneto; también Computrabajo ([fuente](https://www.pulzo.com/empleo/empleo-coomeva-empresa-abre-vacantes-experiencia-sueldos-3800000-PP4363994)) | sitio: página Magneto de Coomeva con 298 cupos |
| COOMEVA | 27 | misma empresa que la clave `grupocoomeva` (contada una vez); Magneto; duplicado de grupocoomeva con otra clave | sitio: página Magneto de Coomeva con 298 cupos |
| INTELCIA | 27 | Magneto; BPO; postulación 100% por Magneto ([fuente](https://www.elcolombiano.com/empleos/contenidos/ntelcia-ofertas-empleo-call-center-bpo-bogota-como-postularse-JO28628427)) | sitio: página Magneto con 242 cupos |
| SACYR | 23 | elempleo sitio empresarial (sacyr); sitio empresarial en elempleo + portal global sacyrpeople ([fuente](https://www.elempleo.com/co/sitio-empresarial/sacyr/iniciar-sesion)) | búsqueda o prensa: no se abrió el listado en el sitio |
| Aris Mining Colombia | 22 | Magneto (aris-mining, 304 cupos); Magneto + contratistas + LinkedIn ([fuente](https://www.magneto365.com/co/empresas/aris-mining/empleos)) | sitio: página Magneto con 193 cupos |
| Seguros Bolívar | 21 | Magneto (seguros-bolivar-y-servicios-bolivar); página de empresa en Magneto con vacantes 2026 ([fuente](https://www.magneto365.com/co/empresas/seguros-bolivar-y-servicios-bolivar/empleos)) | sitio: página Magneto con 101 cupos |
| Banco de Occidente | 20 | Magneto (banco-de-occidente); Magneto es su canal oficial; también elempleo ([fuente](https://www.magneto365.com/co/empresas/banco-de-occidente/empleos/asesor-comercial-avenida-santander-1036726)) | sitio: página Magneto con 372 cupos |
| Zentria | 20 | Magneto; vacantes 2026 en Magneto ([fuente](https://www.magneto365.com/co/empleos/especialista-comercial-de-linea-institucional-medellin-1035979)) | sitio: página Magneto con 760 cupos |

#### c · Solo formulario o correo: 2 empresas, 58 vacantes

| Empresa | Vacantes en bolsas | Dónde publica / evidencia |
|---|---:|---|
| KONECTA | 30 | 'trabaja con nosotros' = registro de HV; vacantes en Computrabajo ([fuente](https://www.grupokonecta.com)) |
| Audifarma S.A | 28 | sección trabaja con nosotros + correo vacantes@; avisos en Computrabajo ([fuente](https://audifarma.com.co)) |

#### d · Solo avisos en bolsas: 36 empresas, 1389 vacantes

| Empresa | Vacantes en bolsas | Dónde publica / evidencia |
|---|---:|---|
| Salesland | 112 | Magneto (empresa); outsourcing comercial; publica en Magneto/elempleo/Computrabajo; sin página propia hallada ([fuente](https://www.magneto365.com/co/empresas/salesland/empleos)) |
| Health & Life IPS | 103 | solo Computrabajo; sin página oficial hallada |
| Keralty | 87 | Magneto (empresa, 756 cupos); página Magneto con 756 cupos (verificada), sin evidencia de que sea su canal oficial; también elempleo ([fuente](https://www.magneto365.com/co/trabajos/empleo-en-keralty)) |
| Inter Rapidísimo | 71 | publica en elempleo y Computrabajo; sin listado propio hallado ([fuente](https://www.elempleo.com/co/ofertas-trabajo/supervisor-de-nomina-bogota-1886770414)) |
| AXA COLPATRIA | 62 | elempleo/Magneto; publica en elempleo; no se halló portal propio ([fuente](https://www.elempleo.com/co/ofertas-trabajo/asistente-oficina-seguros-cali-1886783751)) |
| SYNLAB Colombia | 55 | solo Computrabajo; sin portal propio hallado |
| Bold | 54 | página de empresa en Computrabajo; no se halló portal propio ([fuente](https://co.computrabajo.com/bold-co/empleos)) |
| WSP en Colombia | 51 | elempleo; WSP Colombia publica en elempleo; portal global WSP no verificado ([fuente](https://www.elempleo.com/co/ofertas-trabajo/civil-structural-drafting-technician-1886674956)) |
| Jiro S.A. | 50 | solo Computrabajo (ofertas ocultas); sin portal propio |
| Prosegur Colombia | 45 | publica en Computrabajo ([fuente](https://co.computrabajo.com/prosegur/empleos-en-bogota-dc-sin-experiencia)) |
| Interaseo S.A.S. E.S.P. | 40 | solo Computrabajo; sin portal propio hallado |
| JM Web Tech | 38 | solo LinkedIn/agregadores; sin portal propio ([fuente](https://www.devjobsscanner.com/company/jm-web-tech/)) |
| Lili Pink & Yoi | 37 | bolsas (Computrabajo/Jooble); sin portal propio hallado ([fuente](https://www.elcolombiano.com/empleos/contenidos/empleo-lili-pink-yoi-vacantes-en-colombia-bogota-DI28204887)) |
| Crezcamos S.A. | 34 | solo Computrabajo; sin portal propio hallado |
| axity | 33 | elempleo/Indeed + correo; sin portal con listado ([fuente](https://www.elempleo.com/co/ofertas-empleo/axity)) |
| Profamilia Colombia | 33 | Computrabajo/elempleo; sin portal propio hallado |
| Heatron | 31 | BPO en Bogotá; solo LinkedIn/agregadores ([fuente](https://www.devjobsscanner.com/company/heatron/)) |
| Hitss Colombia | 31 | Magneto (claro-colombia) + claro.com.co/institucional/empleos-claro; la página Magneto citada es de Claro Colombia (12 cupos) y no menciona a Global Hitss ([fuente](https://www.magneto365.com/co/empresas/claro-colombia/empleos)) |
| Clínica Medical | 30 | sin portal; clínica en crisis (cerró 4 sedes en 2026) ([fuente](https://www.minuto60.com/bogota/clinica-medical-suspende-servicios-cuatro-sedes-bogota/9004)) |
| Colgas | 28 | Magneto/Computrabajo; página de empresa en Magneto + Computrabajo; sin portal propio ([fuente](https://www.magneto365.com/co/empresas/colgas/empleos)) |
| BANCO MUNDO MUJER | 26 | solo Computrabajo; sin portal propio hallado |
| Coca-Cola FEMSA | 26 | bolsas y prensa; portal oficial no hallado en la búsqueda |
| Banco de las Microfinanzas - Bancamia S.A. | 25 | Computrabajo (antes Magneto); sin portal propio hallado |
| Fundación delamujer | 25 | elempleo; sin portal propio ([fuente](https://www.elempleo.com/co/ofertas-empleo/fundacion-delamujer)) |
| Grupo emi S.A.S | 25 | Computrabajo; sin portal propio hallado |
| ALO CREDIT COLOMBIA SAS | 24 | Computrabajo/Jooble/Torre; sin portal propio |
| Américas BPS | 22 | BPO; Computrabajo; sin portal propio hallado |
| Comfandi | 22 | Computrabajo/elempleo; además agencia de empleo con vacantes de terceros |
| HMV Ingenieros | 22 | Computrabajo/LinkedIn; sin portal propio hallado |
| NUEVA EPS S.A | 22 | elempleo/Computrabajo |
| Periferia IT Group | 22 | agregadores/LinkedIn; sin portal propio hallado ([fuente](https://www.devjobsscanner.com/company/periferia-it-group/)) |
| Skechers Colombia SAS | 22 | Computrabajo/Indeed/Jooble |
| PERCEPTIO S.A.S. | 21 | agregadores; sin portal propio hallado |
| MEDICINA Y TERAPIAS DOMICILIARIAS S.A.S. | 20 | solo Computrabajo ([fuente](https://co.computrabajo.com/mtd/empleos?prov=4)) |
| Securitas Colombia | 20 | solo Computrabajo |
| Suncol Energy | 20 | elempleo/agregadores ([fuente](https://www.elempleo.com/co/ofertas-empleo/suncolombia)) |

#### e · Sin sitio de empleo: 1 empresas, 290 vacantes

| Empresa | Vacantes en bolsas | Dónde publica / evidencia |
|---|---:|---|
| Bayport | 290 | Bayport ahora Apertu; sitio sin 'trabaja con nosotros'; vacantes solo en bolsas (Indeed/Computrabajo) ([fuente](https://apertu.com.co/)) |

#### f · No determinable: 17 empresas, 870 vacantes

| Empresa | Vacantes en bolsas | Dónde publica / evidencia |
|---|---:|---|
| Colección Talento | 271 | no se identificó la empresa en la web (posible marca de reclutamiento) |
| NEXA BPO | 99 | Workeando (403 desde el runner, documentado); portal existe pero bloquea lectura automatizada |
| Blacksmith Agency | 70 | agencia web de EE.UU.; no se halló portal de empleo para Colombia |
| FullStack | 57 | Lever (jobs.lever.co/fullstacklabs, API hoy 'Document not found'); tuvo Lever con vacantes Colombia; la API de Lever hoy responde "Document not found"; ATS actual no hallado ([fuente](https://www.fullstack.com/talent/remote-tech-jobs-for-colombians)) |
| Deloitte | 55 | portal oficial Colombia no hallado en la búsqueda; publica en elempleo/Indeed ([fuente](https://co.indeed.com/cmp/Deloitte)) |
| Mpower Sourcing | 38 | no se identificó la empresa |
| Banco Santander Colombia | 33 | no se halló portal de empleo de Santander Colombia en la búsqueda |
| Gamma Recruitment | 30 | no se identificó; por el nombre, reclutadora |
| Productividad Empresarial SAS | 30 | solo Computrabajo (ofertas ocultas); actividad no identificada |
| Enel Colombia | 28 | convocatorias de prácticas vía plataforma externa; portal de vacantes no confirmado ([fuente](https://bogota.gov.co/mi-ciudad/habitat/convocatoria-practicas-profesionales-en-enel-colombia-en-bogota-2026)) |
| Crossing Hurdles | 27 | no se identificó; por el nombre, reclutadora |
| ITS Solutions | 25 | no se identificó la empresa |
| Meico S.A | 24 | no se halló página de empleo (meico.com.co) |
| Bizu | 22 | no se identificó la empresa |
| VirtuPartner | 21 | no se identificó la empresa |
| Clínica de Occidente | 20 | sin página de empleo hallada (clinicadeoccidente.com / LinkedIn) |
| Minden Marketing GmbH | 20 | no se identificó la empresa |

#### x · Agencia, staffing o nombre anónimo: 23 empresas, 737 vacantes

| Empresa | Vacantes en bolsas | Dónde publica / evidencia |
|---|---:|---|
| Grupo Soluciones Horizonte | 71 | Magneto (empresa gsh); outsourcing/temporal (GSH); Magneto 1.855 cupos ([fuente](https://www.magneto365.com/co/empresas/gsh/empleos)) |
| BruntWork | 48 | own (apply.bruntworkcareers.co); staffing remoto (provee personal a clientes) ([fuente](https://apply.bruntworkcareers.co/jobs/44877859666/apply)) |
| Colsubsidio Empleo | 44 | agencia de empleo de Colsubsidio (vacantes de empresas usuarias) |
| Emapta Global | 43 | careers.emapta.com; outsourcing/staffing remoto (personal para clientes) ([fuente](https://emapta.com/location-colombia/)) |
| CINTE Colombia | 42 | own (grupocinte.com) + elempleo; outsourcing/staffing TI (administra fuerza laboral de clientes) ([fuente](https://grupocinte.com/?p=19962)) |
| Redes Humanas | 42 | empresa de servicios temporales ([fuente](https://directorio-empresas.einforma.co/informacion-empresa/redes-humanas-sa)) |
| Tiempos SAS | 40 | empresa de servicios temporales (Medellín) ([fuente](https://clutch.co/profile/tiempos-sas)) |
| Job Duck | 38 | virtual staffing (ubica personal remoto con clientes de EE.UU.) ([fuente](https://jobduck.com/what-is-job-duck/)) |
| Medicall Talento Humano | 35 | gestión de talento humano en salud para terceros (p.ej. Salud Total); solo Computrabajo ([fuente](https://empresite.eleconomistaamerica.co/MEDICALL-TALENTO-HUMANO-SAS.html)) |
| (nombre reducido a iniciales) | 34 | nombre reducido a inicial ('J.'): anónimo, no verificable |
| pavago | 30 | staffing remoto |
| Human Servicess S.A.S | 26 | empresa de servicios temporales ([fuente](https://empresite.eleconomistaamerica.co/HUMAN-SERVICESS-SAS.html)) |
| (nombre reducido a iniciales) | 26 | inicial ('M.'): anónimo |
| Soluciones Inmediatas | 25 | empresa de servicios temporales ([fuente](https://www.herohunt.ai/recruitment-agencies/soluciones-inmediatas-s-a)) |
| Staffing | 25 | nombre genérico 'Staffing' no identificable |
| Recursivos Serviayuda SAS | 23 | selección y suministro de personal (temporal) |
| ENLACE EMPRESARIAL DE SERVICIOS S.A | 22 | agencia de colocación/temporal (Bucaramanga) ([fuente](https://emis.cn/php/company-profile/CO/Enlace_Empresarial_de_Servicios_SA_en_2611597.html)) |
| (nombre reducido a iniciales) | 22 | iniciales ('M. C.'): anónimo |
| (nombre reducido a iniciales) | 21 | inicial ('A.'): anónimo |
| (nombre reducido a iniciales) | 20 | inicial ('C.'): anónimo |
| (nombre reducido a iniciales) | 20 | inicial ('L.'): anónimo |
| SALES MARKETING OUTSOURCING HOLDING SAS | 20 | outsourcing de fuerza de ventas; solo Computrabajo |
| SAMESU IPS Medicina Laboral SAS | 20 | publica cargos ajenos a una IPS (operarios, ventas, almacenista) en muchas ciudades; parece reclutamiento para terceros; solo Computrabajo |
