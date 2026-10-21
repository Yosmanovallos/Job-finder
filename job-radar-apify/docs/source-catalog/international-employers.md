# Empleadores internacionales con vacantes en Colombia — investigación 2026-10-20

Solo lectura + web + canario `scripts/direct-canary.ts`. Sin BD, sin tocar el repo. Cifras del 2026-10-20.

## Método y desviaciones (leer primero)

- Canario corrido con `--detail-budget 100` (no 3): con 3 solo lee 3 vacantes y reporta "diferidas N", que no es un conteo. Con 100 todos los tableros de (A) quedaron con `diferidas 0`, así que "vigentes" es exacto (regla del conector: <= 30 días). Pausas >= 3 s entre canarios. Ningún canario recibió 429.
- 429 (no reintentado): `accenture.wd103` y `salesforce.wd12` respondieron 429 a mi sondeo de descubrimiento (script propio de lectura, POST de búsqueda de Workday). Quedan [NV], sin canario.
- Descubrimiento: `robots.txt` del tenant Workday (lista sus sites) + POST de búsqueda `/wday/cxs/...` (misma llamada del conector); APIs públicas de GH/Lever/Ashby/SR; huella de ATS en la página de carreras de cada empresa (enlaces a hosts de ATS). La búsqueda web con `site:` no aplica el operador: se descartó como fuente.
- Propiedad del tablero: (1) la página de carreras de la propia empresa enlaza al tablero, o (2) el detalle del ATS trae `hiringOrganization.name` de la filial colombiana. Se indica cuál.
- Texto descargado: ninguna página/respuesta traía instrucciones dirigidas al agente; todo tratado como dato.

## HALLAZGO: bug del conector Workday (bloquea >= 8 empresas)

`colombiaFacet()` en `src/direct/ats/workday.ts` busca `facetParameter` con la regex `locationcountry$` (insensible a mayúsculas). Muchos tenants usan `Location_Country`, `location_Country` o `Country`, que NO casan. En tableros > 200 vacantes el canario devuelve `error: tablero de N vacantes sin faceta de país`, aunque la faceta existe y trae a Colombia. Observado hoy (conteo de la faceta = vacantes con país Colombia, antes del filtro de 30 días; NO verificado por canario y suele sobrestimar: TransUnion faceta 21 -> canario 8 vigentes):

| Empresa | ats_ref | param faceta | Colombia (faceta) | Evidencia de propiedad |
|---|---|---|---|---|
| Abbott | `abbott/wd5/abbottcareers` | Location_Country | 13 | abbott.com/en-us/careers enlaza `abbott.wd5.myworkdayjobs.com/abbottcareers` |
| Medtronic | `medtronic/wd1/MedtronicCareers` | locationCountry | 20 | solo tenant homónimo; además el canario falló con "forma inesperada en la página 1" (otro problema, sin diagnosticar) |
| Diageo | `diageo/wd3/Diageo_Careers` | Location_Country | 7 | diageo.com/en/careers enlaza `diageo.wd3.../diageo_careers` |
| Baxter | `baxter/wd1/baxter` | Country | 6 | jobs.baxter.com enlaza `baxter.wd1.../baxter` |
| Pfizer | `pfizer/wd1/PfizerCareers` | Location_Country | 3 | solo tenant homónimo (pfizer.com dio 403) |
| GSK | `gsk/wd5/GSKCareers` | Location_Country | 2 | solo tenant homónimo |
| Autodesk | `autodesk/wd1/Ext` | locationCountry | 3 | solo tenant homónimo (sin canario) |
| Santander | `santander/wd3/SantanderCareers` | locationCountry | 1 | solo tenant homónimo |

Arreglo sugerido (decisión del dueño; no toqué el repo): aceptar también facetParameter que termine en `_country` o sea exactamente `country`. Suma bruta de facetas = 55; el vigente real será menor. Tableros sin faceta de país (no arreglables así): Mastercard (1.122 vacantes; búsqueda "Colombia" da 43, sin verificar), Cisco-Workday, Baker Hughes, Roche-Workday, Intel, AstraZeneca, HPE, Fiserv-Workday, PwC, Maersk, NVIDIA.

## (A) Tableros VERIFICADOS con conector, listos para el seed

"Vigentes CO" = `vigentes` del canario (<= 30 días, `--detail-budget 100`).

| slug sugerido | displayName | websiteDomain | atsType | atsRef | Vigentes CO | Tablero CO (total / >30d) | Evidencia de propiedad |
|---|---|---|---|---|---|---|---|
| scotiabank | Scotiabank | scotiabank.com | successfactors | `jobs.scotiabank.com` | 89 | 89 / 0 | Sitio RMK `jobs.scotiabank.com` es el dominio de carreras de la empresa; la página pública con `locationsearch=Colombia` muestra 89 resultados (coincide). Todas en Bogotá (hub de servicios globales; varias bilingües). |
| mercadolibre | Mercado Libre | mercadolibre.com | eightfold | `mercadolibre.eightfold.ai@mercadolibre.com` | 50 | 58 / 8 | `careers-meli.mercadolibre.com/es` (sitio oficial) incrusta `mercadolibre.eightfold.ai` |
| kyndryl | Kyndryl | kyndryl.com | workday | `kyndryl/wd5/KyndrylProfessionalCareers` | 45 | 49 / 0 | kyndryl.com/careers enlaza `kyndryl.wd5.../kyndrylprofessionalcareers`; hiringOrganization "Kyndryl Colombia SAS" |
| bbva | BBVA | bbva.com | workday | `bbva/wd3/BBVA` | 22 | 22 / 0 | bbva.com/es/empleo y /en/careers enlazan `bbva.wd3.../bbva`; hiringOrganization "BBVA COLOMBIA" |
| visa | Visa | visa.com | workday | `visa/wd5/Visa` | 20 | 28 / 8 | corporate.visa.com/en/jobs redirige a `visa.wd5.myworkdayjobs.com/Visa`; hiringOrganization "Visa Colombia S.A." |
| concentrix | Concentrix | concentrix.com | workday | `cnx/wd1/external_global` | 14 | 16 leídas (14 CO, 2 fuera) | jobs.concentrix.com lista vacantes de `cnx.wd1.../external_global`; hiringOrganization "Concentrix CVG Customer Management Colombia S.A.S." |
| transunion | TransUnion | transunion.com | workday | `transunion/wd5/TransUnion` | 8 | 21 / 13 | transunion.com/careers dio 403 (no leído); hiringOrganization "TransUnion LLC", URLs `/job/Bogota/...` |
| experian | Experian | experian.com | smartrecruiters | `Experian` | 7 | 10 / 3 | experian.com/careers enlaza `join.smartrecruiters.com`; `jobs.experian.com` redirige a `/jobs`; la API SR trae `company.identifier/name = Experian` |
| citi | Citi | citi.com | eightfold | `citi.eightfold.ai@citi.com` | 7 | 11 / 4 | jobs.citi.com enlaza `citi.eightfold.ai/careers` |
| foundever | Foundever | foundever.com | successfactors | `jobs.foundever.com` | 4 | 4 / 0 | `jobs.foundever.com` es su sitio de carreras; la página pública "Colombia-Locations" muestra 4 de 4 (coincide). Incluye 1 "Remote, Any Location, CO". |
| taskus | TaskUs | taskus.com | workday | `taskus/wd1/Careers` | 3 | 23 / 20 | taskus.com/careers no enlaza a Workday (anclas internas); hiringOrganization "TaskUs Colombia SAS" |
| motorola-solutions | Motorola Solutions | motorolasolutions.com | workday | `motorolasolutions/wd5/Careers` | 2 | 2 / 0 | hiringOrganization "Motorola Solutions Colombia Limitada" |
| roche | Roche | roche.com | phenom | `careers.roche.com/global/en` | 2 | 3 / 1 | roche.com/careers redirige a careers.roche.com/global/en |
| cisco | Cisco | cisco.com | phenom | `careers.cisco.com/global/en` | 2 | 2 / 0 | jobs.cisco.com redirige a careers.cisco.com/global/en (su Workday `cisco/wd5/Cisco_Careers` no sirve: sin faceta) |
| turing | Turing | turing.com | greenhouse | `turing` | 2 | 3 / 1 | Tablero `turing`; la descripción de la vacante nombra a Turing; careers.turing.com existe pero es JS y no se vio el enlace. Propiedad: media. Roles de su marketplace de talento IA. |
| fiserv | Fiserv | fiserv.com | phenom | `careers.fiserv.com/us/en` | 1 | 2 / 1 | fiserv.com/careers redirige a careers.fiserv.com/us/en |
| merck | Merck and Co. (MSD) | merck.com | phenom | `jobs.merck.com/us/en` | 1 | 1 / 0 | jobs.merck.com es el sitio de carreras de Merck |
| ericsson | Ericsson | ericsson.com | eightfold | `jobs.ericsson.com@ericsson.com` | 1 | 1 / 0 | jobs.ericsson.com/careers es Eightfold (huella `eightfold.ai` en la página) |

**Total de vigentes en Colombia que sumarían los tableros de (A): 280** (89+50+45+22+20+14+8+7+7+4+3+2+2+2+2+1+1+1), 18 empresas. Con el arreglo de faceta se sumarían hasta ~55 brutas más (sin verificar).

Revisados y NO incluidos en (A):
- NTT Data (`phenom careers.nttdata.com/global/en`): canario OK pero 3 en Colombia, todas > 30 días -> 0 vigentes (volver a medir).
- Andela (`ashby andela`, enlazado desde andela.com): 16 vacantes, 0 en Colombia.
- Colgate (`successfactors jobs.colgate.com`): sitio válido, 0 en Colombia hoy.
- Teleperformance (`workday teleperformance/wd1/teleperformance`): 6 vacantes totales, 0 Colombia; su portal principal es propio (tp.com), ATS no identificado.
- Globant (`career.globant.com`, SuccessFactors RMK): el canario falla con "robots.txt no permite /search/". Sin rodeo. Es el mayor empleador tech internacional en Colombia (>6.000 empleados, Forbes 2024): requiere permiso del sitio o una vía documentada.
- Accenture (`accenture/wd103/AccentureCareers`, enlazado desde accenture.com/co-es/careers) y Salesforce (`salesforce/wd12/External_Career_Site`): conector compatible pero 429 en mi sondeo -> [NV]. Reintentar otro día con el canario.
- Mastercard (`mastercard/wd1/CorporateCareers`): sin faceta de país.
- GH/Lever/Ashby con tablero real y 0 vacantes con Colombia nombrada (JSON público): Thoughtworks (42), DiDi (9), Stripe, GitLab, Okta, Datadog, MongoDB, Cloudflare, Elastic, Airbnb, Coinbase, Dropbox, Lyft, Pinterest, Spotify (Lever), Palantir (Lever), Notion, OpenAI, Ramp, Plaid (Ashby).

## (B) Empresas en ATS SIN conector (para decidir qué conector construir)

"kw" = `TotalJobsCount` de la API REST pública de Oracle Recruiting con `keyword=Colombia` (búsqueda por texto, aproximada; no documentada oficialmente: observado, no garantizado).

| ATS | Empresa | Portal / host | Vacantes Colombia | Nota |
|---|---|---|---|---|
| Oracle Recruiting Cloud | JPMorgan Chase | jpmc.fa.oraclecloud.com (CX_1001) | ~46 (kw) | mayor volumen sin conector |
| Oracle Recruiting Cloud | Oracle | eeho.fa.us2.oraclecloud.com (careers.oracle.com) | ~4 (kw; siteNumber CX_45001 sin confirmar) | |
| Oracle Recruiting Cloud | Nokia | jobs.nokia.com (CX_1) | 2 (kw) | |
| Oracle Recruiting Cloud | Hilton | jobs.hilton.com (efet.fa.us2, CX_1) | 1 (kw) | |
| Oracle Recruiting Cloud | Marriott | careers.marriott.com (ejwl.fa.us2, mi_cs_1) | 0 (kw; site sin confirmar) | |
| Oracle Recruiting Cloud | Dell, Honeywell | enterpriseplatform.dell.com; ibqbjb.fa.ocs.oraclecloud.com | [NV] | |
| Plataforma propia | Amazon | amazon.jobs | 18 (`search.json?country=COL`; robots lo permite) | JSON público propio; conector ad hoc barato |
| iCIMS | PepsiCo | pepjobs-pepsico.icims.com (pepsicojobs.com) | [NV] | página JS, sin conteo visible |
| iCIMS / Taleo | Schneider Electric | careers.se.com | [NV] | |
| CSOD (Cornerstone) | Meta | metacareers.com | [NV] | |
| SuccessFactors clásico (no RMK) | Cargill, Halliburton, BAT, Compass | career2/4/5.successfactors.* (`career_company=...`) | [NV] | Radancy/TalentBrew es solo el front de Cargill, Halliburton, BAT, L'Oréal, Unilever (back Workday), McKesson |
| SuccessFactors RMK, bloqueado por robots | Globant | career.globant.com | [NV] | ver arriba |
| Workday sin faceta (conector no lo lee) | Mastercard (43 por búsqueda), Baker Hughes (10 por búsqueda), HPE (47, ruidoso), Cisco/Roche-Workday, Intel, AstraZeneca | ver bug | [NV] | |
| Sitio propio, ATS no identificado | Teleperformance (tp.com), Capgemini, Deloitte, KPMG, EPAM, IBM, Google, Uber, Siemens | | [NV] | JS sin conteo visible |
| Agregador de terceros (no ATS) | Konecta | grupokonectacolombia.pandape.computrabajo.com | "1,013 Jobs" según resultado de buscador, NO verificado | Computrabajo/Pandape: fuera de la política "portal propio" |
| 403 al leer | SAP (jobs.sap.com), Nestlé, J&J, Kimberly-Clark | | [NV] | no se buscó otro camino |

No apareció en esta pasada ningún tablero de Avature, Jobvite, Workable, BambooHR, Recruitee, Personio, Pinpoint ni Breezy de una multinacional grande con presencia en Colombia (PepsiCo tiene un `sandboxpepsi.avature.net` de comunidad de talento, no tablero). Prioridad por volumen visible: 1) arreglo de faceta Workday (~55 brutas + Accenture/Salesforce/Mastercard sin medir), 2) Oracle Recruiting Cloud (JPMorgan ~46), 3) Amazon propio (18).

## (C) Remoto "LATAM / Americas / mundial" SIN nombrar Colombia (hoy NO entra)

Lectura del listado completo SIN filtro de país (solo posible donde el tablero es legible entero). Clasificación por texto de ubicación. "Remoto genérico" = contiene remote/anywhere/global sin nombrar Colombia (incluye "USA - Remote", que NO es mundial).

| Tablero | Leídas | Colombia nombrada | LATAM/Americas explícito sin Colombia | Remoto genérico sin Colombia | Notas |
|---|---|---|---|---|---|
| Turing (Greenhouse) | 32 | 3 | 0 | 5 | Muestras: "India - Remote", "Global - Remote" (solo esta última es mundial) |
| Andela (Ashby) | 16 | 0 | 0 | 0 | |
| Kyndryl (Workday) | 864 | 49 | 0 | 0 | 210 filas con ubicación opaca "N Locations" |
| Visa (Workday) | 847 | 28 | 0 | 15 | Muestras: "BR - Remote - Brazil", "US - Remote - Illinois": remoto por país |
| TransUnion (Workday) | 242 | 21 | 0 | 12 | 62 opacas |
| BBVA (Workday) | 679 | 18 | 0 | 0 | |
| TaskUs (Workday) | 424 | 23 | 0 | 13 | Muestras: "USA - Remote", "Philippines - Remote": por país |

Conclusión: en los tableros medibles hay 0 vacantes LATAM/Americas sin Colombia; casi todo el "remoto" está atado a otro país; el remoto realmente mundial es marginal (~1 en Turing). Las filas "N Locations" hacen de estos conteos una cota inferior. NO medible con el conector actual: Mercado Libre, Citi, Ericsson (Eightfold), Scotiabank y Foundever (SuccessFactors), Concentrix, Experian, Roche/Cisco/Fiserv/Merck: el conector pide el sitio ya filtrado por Colombia y no ve el resto; reportar 0 allí sería falso.

Nota: "Colombia nombrada" en Kyndryl/Visa/BBVA/TransUnion/TaskUs es el conteo por texto de ubicación del listado (incluye vacantes > 30 días); no coincide con "vigentes" de (A).
