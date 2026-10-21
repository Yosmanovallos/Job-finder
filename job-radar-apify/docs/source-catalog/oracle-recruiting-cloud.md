# Oracle Recruiting Cloud (Oracle HCM Candidate Experience) — investigación 2026-10-20

Leyenda: [DOC] documentado oficialmente · [OBS] observado hoy, no garantizado · [NV] no verificado.
Solo lectura. UA `BuscoTrabajoBot/1.0 (+https://buscotrabajo.co)`, >= 3 s entre llamadas. Fixtures: `fixtures-oracle/`.

## Veredicto: TÉCNICAMENTE VIABLE, DECISIÓN DEL DUEÑO (no es un "sí" incondicional)

- Es el JSON que usan los propios sitios de carreras (sin auth, sin cookies) [OBS]. Ningún tenant pidió credenciales.
- [DOC] Oracle marca otros recursos de la misma familia (`recruitingCEReferrals`, `recruitingCEApplyFlows`; docs 24B, p. ej. `docs.oracle.com/en/cloud/saas/human-resources/24b/farws/api-recruiting-ce-job-referrals.html`) con "the service endpoints in this resource category are only for Oracle internal use" (texto citado por el buscador; no leído directamente porque el sitio de docs es JS). La página de `recruitingCEJobRequisitions` no se pudo leer: [NV] si lleva la misma nota. Oracle no publica un contrato para terceros sobre este recurso.
- Términos: `oracle.com/careers/terms-conditions/` respondió 403 a nuestro UA -> [NV]. Términos de cada empleador (JPMorgan, Hilton, Nokia) [NV].
- Misma situación que Globant: sin contrato documentado para consumo externo. Recomendación: construirlo solo si el dueño lo aprueba sabiendo que el endpoint no es contractual; con tope bajo (>= 3 s, 1 listado/6 h por tenant, abortar ante 403/429).
- Volumen real hoy: 69 vacantes con Colombia, **21 vigentes <= 30 días** en 4 tenants. Es poco; el volumen no justifica por sí solo el conector.

## robots.txt (RFC 9309: 404 = sin restricciones)
| Host | /robots.txt |
|---|---|
| jpmc.fa.oraclecloud.com | 403 página "W4S-402 Blocked by WAF4SaaS" a nuestro UA, pero la API respondió 200 al mismo UA [OBS]. Estado ambiguo: no tomarlo como permiso explícito |
| eeho.fa.us2 (Oracle), fa-evmr-saasfaprod1.fa.ocs (Nokia), efet.fa.us2 (Hilton), ibqbjb.fa.ocs (Honeywell), enterpriseplatform.dell.com | 404 -> sin restricciones |
| jobs.hilton.com (front Radancy, no el host Oracle) | `Allow: *`, `Disallow: /api/*`; no aplica a `efet.fa.us2...` |
| careers.oracle.com, jobs.nokia.com, careers.honeywell.com | vanity domains: 302 al host Oracle `/hcmUI/CandidateExperience/...`; no sirven la API |

## Endpoints [OBS salvo indicación]
Base: `https://{host}/hcmRestApi/resources/latest/` (la respuesta enlaza a `11.13.18.05`).
1. Listado: `recruitingCEJobRequisitions?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber={CX_n},locationId={id},limit={N},offset={N},sortBy=POSTING_DATES_DESC`
   - `expand=requisitionList` es obligatorio: sin él la respuesta trae solo el sobre (sin `requisitionList`), verificado.
   - Los parámetros del finder van separados por `,` dentro de `findReqs;`. `facetsList=LOCATIONS` añade facetas.
   - `items[0]` es UN objeto de búsqueda (no un array de vacantes): `TotalJobsCount`, `Limit`, `Offset`, `requisitionList[]`, `locationsFacet[]`.
2. Detalle: `recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id="{Id}",siteNumber={CX_n}` (comillas dobles URL-codificadas `%22`).
3. URL pública de la vacante: `https://{host}/hcmUI/CandidateExperience/en/sites/{siteNumber}/job/{Id}` -> 200 con `CX_45001` (Oracle), `CX_1001` (JPMC), `CX_1` (Hilton). El prefijo `/es/` dio 302 hacia `/en/` (Oracle, JPMC) o a otro site (Hilton `CX_1` -> `CX_1009`): usar `en` y no seguir redirecciones. Un nombre de site (p. ej. `jobsearch` de Oracle) también funciona.
- Auth: ninguna [OBS]. `Content-Type: application/vnd.oracle.adf.resourcecollection+json`, `Cache-Control: no-store`. Sin cabeceras de rate limit. Ningún 429 en unas 80 llamadas.

## Paginación
- `limit` acepta >= 200 (probado 200 y 500 en Hilton: 42 filas de 42) [OBS]. Recomendado 50.
- `offset` clásico; parar al llegar a `TotalJobsCount` o con página corta. `hasMore`/`count` del sobre NO sirven (siempre `false`/`1`).
- Sitio inexistente (`siteNumber=CX_NOPE`): HTTP 200 con sobre (no 404) -> validar `TotalJobsCount` y forma.

## Filtrar Colombia (lo más delicado)
- `keyword=Colombia` NO es filtro de país. JPMC dio **46** (casi todo "Latin America" de otros países) frente a **10** reales; Hilton dio 1 frente a 42. Las cifras "kw" de la tabla (B) de `docs/source-catalog/international-employers.md` deben reemplazarse por las de abajo.
- `location=Colombia` y `locationId={id}` dieron el mismo total en los 4 tenants con Colombia (10, 19, 2, 42). Pero `location=Bogota` en Hilton devolvió 4.476 (todo el sitio): el texto se ignora si no resuelve -> **no confiar en `location=`**; usar `locationId`.
- El id de Colombia es **propio de cada tenant** (JPMC 300000000289195, Oracle 300000000106782, Nokia 300000000471577, Hilton 300000000228621) y la faceta sin filtro lista solo ~10-40 ubicaciones. Descubrimiento (una vez): `finder=findReqs;siteNumber=..,keyword=Colombia,facetsList=LOCATIONS,limit=1` y leer `items[0].locationsFacet[]` con `Name == "Colombia"`. Guardar el id en `ats_ref`. Fixture `jpmc-facet-discovery.json`.
- **El filtro por ubicación incluye ubicaciones secundarias**: Oracle devolvió 19 filas: 15 con `PrimaryLocationCountry=CO` y 4 con primaria CL/CR/MX y Colombia solo en `secondaryLocations[].CountryCode == "CO"` (fixture `oracle-list-secondary-location.json`). Regla ADR §4: `countryCodes` = país primario + todos los secundarios; decide el filtro por segmento. En esas 4 el `PrimaryLocation` no es colombiano: no inventar ciudad.
- Siempre filtrar del lado cliente; el total del servidor no es "total Colombia".

## Campos -> RawAtsPosting
| Campo Oracle | Dónde | RawAtsPosting |
|---|---|---|
| `Id` (string) | lista/detalle | externalId |
| `Title` | lista | title |
| URL construida | — | applyUrl |
| `PrimaryLocation` ("Bogota, Colombia"), `secondaryLocations[].Name` | lista | locationTexts |
| `PrimaryLocationCountry` ("CO"), `secondaryLocations[].CountryCode` | lista | countryCodes |
| ciudad: sin campo suelto (va dentro de `PrimaryLocation`) | | structuredCity: null |
| `WorkplaceType`/`WorkplaceTypeCode` (en JPMC/Oracle llega vacío/null; Hilton trae "On-site"/"Remote") | lista | workplace solo si no vacío |
| `ExternalDescriptionStr` (HTML), `ExternalResponsibilitiesStr`, `ExternalQualificationsStr` | solo detalle (la lista trae `ShortDescriptionStr`) | descriptionText; en lista `partial: true` |
| `JobFamily`/`Category`, `JobFunction` | lista/detalle | department |
| `JobSchedule` ("Full time"), `ContractType` | detalle | employmentType |
| `PostedDate` ("2026-10-15", solo fecha) en lista; `ExternalPostedStartDate` (con hora, UTC) en detalle | | publishedAt |
| `ExternalPostedEndDate` (detalle; null en lo visto) | | validThrough |
| `LegalEmployer`/`BusinessUnit` (detalle; `LegalEmployer` null en lo visto) | | companyName: no fiable |
Faltan respecto al schema: salario/moneda, `hiringOrganization` formal, ciudad estructurada. `NumberOfOpenings` null.
- El detalle trae `ExternalContactName/Email` y `HiringManager` (null en lo visto): no persistir (PII); los fixtures los redactan.

## Vacante inexistente / cierre
- Detalle con id inexistente: **HTTP 200** con `items: []`, `count: 0` (no 404) [OBS; fixture `detail-not-found.json`]. No se probó con un id recién cerrado: no usarlo solo como prueba de cierre.
- Página pública de id inexistente: 302 -> `/hcmUI/CandidateExperience/errors/404` [OBS]; id vivo da 200 directo (3 tenants). Con el cliente sin redirecciones es una señal de "gone" utilizable como confirmación opcional.
- Cierre recomendado: 2 listados completos seguidos (ADR §3) + guardia `suspect`.

## Canarios (2026-10-20; "<=30 d" calculado por mí con PostedDate de la lista, no por el conector)
| Empresa | host / siteNumber | locationId CO | Total ubicación | CO primaria | <=30 d | Propiedad |
|---|---|---|---|---|---|---|
| JPMorgan Chase | jpmc.fa.oraclecloud.com / CX_1001 | 300000000289195 | 10 | 10 | 5 | careers.jpmorgan.com enlaza `jpmc.fa.oraclecloud.com/.../CX_1001/requisitions` |
| Oracle | eeho.fa.us2.oraclecloud.com / CX_45001 | 300000000106782 | 19 | 15 (+4 solo secundaria) | 5 | `careers.oracle.com` redirige a `.../sites/jobsearch`; su HTML contiene CX_45001 |
| Nokia | fa-evmr-saasfaprod1.fa.ocs.oraclecloud.com / CX_1 | 300000000471577 | 2 | 2 | 2 | `jobs.nokia.com` redirige a `/en/sites/CX_1` de ese host |
| Hilton | efet.fa.us2.oraclecloud.com / CX_1 (existe también CX_1009: 44) | 300000000228621 | 42 | 42 | 9 | `jobs.hilton.com` enlaza `efet.fa.us2.../sites/CX_1` |
| Dell | enterpriseplatform.dell.com / CX_1001 | — | 0 (sitio de 462) | 0 | 0 | `jobs.dell.com` redirige ahí |
| Honeywell | ibqbjb.fa.ocs.oraclecloud.com / CX_1 | — | 0 (sitio de 1.264) | 0 | 0 | `careers.honeywell.com` = vanity |
| Marriott | ejwl.fa.us2 / CX_1 | — | ese site solo tiene 5 vacantes: site equivocado, [NV] | | | |

Total: 69 con Colombia (65 primaria CO), 21 vigentes (aprox.).
Otros tenants con Colombia: sin forma gratuita de enumerarlos (Common Crawl CDX dio 504 para `*.oraclecloud.com/hcmUI/CandidateExperience/*`). UPS, Mondelez, ABB y HPE NO son Oracle (ver multinationals.md).

## Diseño recomendado (si el dueño aprueba)
- `atsType: "oracle"`; `ats_ref = {host}/{siteNumber}/{locationId}` (regex estricta: host terminado en `.oraclecloud.com`, `CX_\d+`, id numérico). `portalUrl = https://{host}/hcmUI/CandidateExperience/en/sites/{siteNumber}`.
- Lista: `locationId` + `expand=requisitionList.secondaryLocations`, `limit=50`, sort `POSTING_DATES_DESC`; normalmente 1 página.
- Detalle solo para ids no conocidos, bajo `detailBudget` (1 petición por vacante); la lista se marca `partial`.
- Guardias: `TotalJobsCount` ausente o forma inesperada -> `error`; 403/429 -> `error` sin reintento; caída >80 % del subconjunto Colombia -> `suspect`.
- `publishedAt` solo del campo del ATS. Riesgo: parámetros no documentados; la versión `latest` puede cambiar.
