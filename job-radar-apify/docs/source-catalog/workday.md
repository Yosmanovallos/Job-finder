# Workday career sites: endpoint público CXS (`/wday/cxs/...`)

Investigación `source-researcher` del 2026-10-20 para `docs/adr/0006-direct-employers.md` (D5).
Leyenda: **[DOC]** documentado oficialmente; **[OBS]** observado, no garantizado;
**[NV]** no verificado. UA usado en todas las pruebas: `BuscoTrabajoBot/1.0 (+https://buscotrabajo.co)`,
~70 requests en total, espaciadas 1.5-3 s, un solo hilo, sin cookies, sin login. Fixtures sanitizados en
`fixtures-workday/` (mismo directorio que este informe).

## 0. Veredicto

**Conector viable con condiciones; NO es una API documentada.**

- El endpoint CXS **no tiene documentación oficial** [NV]: la doc de Workday solo describe cómo el
  empleador configura sus career sites
  (https://doc.workday.com/admin-guide/en-us/workday-feature-descriptions/workday-paradox/reference--candidate-experience-capabilities.html);
  no hay contrato ni versionado. Es la API JSON que consume el propio front público. Todo lo de abajo es
  **[OBS]**: requiere fixtures, canarios y tolerancia a cambios de forma.
- robots.txt por tablero **no prohíbe** `/wday/cxs/` (§1.1), pero **algunos tenants prohíben el site
  entero** (p. ej. `heinz`: `Disallow: /KraftHeinz_Careers/`). Política propia obligatoria (§1.2).
- Términos de Workday (§1.3) prohíben scraping **de workday.com**; los career sites son sitios del
  empleador y no están en la definición de "Sites". No pudimos leer términos propios de
  `*.myworkdayjobs.com` [NV]. Opt-out inmediato ante cualquier queja.
- Rate limit agresivo en algunos tenants: **Accenture respondió 429 en todos los intentos** (§7). No se
  evadió; Accenture queda sin verificar.

## 1. Cumplimiento

### 1.1 robots.txt observado (2026-10-20) [OBS]

Cada tenant sirve su robots.txt (`text/plain`, `Cache-Control: no-store`).

**accenture.wd103.myworkdayjobs.com/robots.txt** (literal):
```
Sitemap: https://accenture.wd103.myworkdayjobs.com/AccentureCareers/siteMap.xml
Sitemap: https://accenture.wd103.myworkdayjobs.com/AccentureLeadershipCareers/siteMap.xml
Sitemap: https://accenture.wd103.myworkdayjobs.com/AvanadeCareers/siteMap.xml
Sitemap: https://accenture.wd103.myworkdayjobs.com/AvanadeLeadershipCareers/siteMap.xml

User-agent: *
Allow: /AccentureCareers/
Allow: /AccentureLeadershipCareers/
Allow: /AvanadeCareers/
Allow: /AvanadeLeadershipCareers/
Disallow: /refreshFacet/
```

**rappi.wd12.myworkdayjobs.com/robots.txt** (literal; solo sitemap, sin grupo `User-agent`):
```
Sitemap: https://rappi.wd12.myworkdayjobs.com/Rappi_jobs/siteMap.xml
```

**rappi.wd3.myworkdayjobs.com/robots.txt**: HTTP **422** (`{"errorCode":"HTTP_422"...}`). Por RFC 9309 un
4xx = "unavailable" = todo permitido, pero el host wd3 ya no sirve el tenant (§6): irrelevante.

Otros (extracto, todos con `User-agent: *`):
- `galderma.wd3`: `Allow: /External/`, `Allow: /broadbean_external/`, `Disallow: /refreshFacet/`.
- `unilever.wd3`: Allow de 5 sites; **`Disallow: /EB/`, `Disallow: /Unilever_VIP_Careers/`**, `/refreshFacet/`.
- `sanofi.wd3`: `Allow: /SanofiCareers/`. `teleperformance.wd1`: `Allow: /allianceone/`, `/teleperformance/`.
- `mastercard.wd1`: Allow de 4 sites; **Disallow `/CUOReqSite/`, `/CampusApplyOnly/`, `/Public_Posting_Site/`**.
- `abinbev.wd1`: `Allow: /COL/` (sitemap en `wd1.myworkdaysite.com/recruiting/abinbev/COL/siteMap.xml`).
- `heinz.wd1`: `Allow: /KraftHeinz_Careers_France/`, **`Disallow: /KraftHeinz_Careers/`**, `_UR/`, `_BC/`.

**¿Está permitida la ruta exacta `/wday/cxs/{tenant}/{site}/jobs`?** Ningún robots.txt visto contiene un
`Disallow` que coincida con el prefijo `/wday/` (solo `/refreshFacet/` y rutas `/{Site}/`). Por RFC 9309
(sin regla = permitido) la ruta CXS está **permitida** para `*` en todos los tenants medidos. Nuestro UA no
aparece nombrado en ninguno.

### 1.2 Política propia propuesta (más estricta que el RFC)

El robots.txt de Workday expresa la voluntad del empleador **por site** (`Allow:/Site/`, `Disallow:/Site/`)
aunque la ruta CXS no empiece por `/Site/`. Para no leer un site que el empleador marcó como no rastreable:
1. Leer `https://{host}/robots.txt` por host (1 vez/día).
2. Si hay `Disallow: /{site}/` (o prefijo del site), **no habilitar** ese site (`opt_out`).
3. Si hay `Allow` explícitos y el site no está listado ni desautorizado, `needs_review` (no habilitar solo).
4. 4xx en robots = permitido (RFC); 5xx/timeout = no leer ese tick (RFC: todo prohibido).
5. Respetar `Crawl-delay` si aparece (no apareció en ninguno).

### 1.3 Términos de uso [DOC]

- "Workday Online Terms of Service", última actualización 08/13/2026 —
  https://www.workday.com/en-us/legal/site-terms.html . Sección 2 (Prohibited Conduct): "Use any data
  mining, robots or similar data gathering or extraction methods designed to scrape or extract data from
  our Sites" y "Bypass or ignore instructions contained in our robots.txt file". Definición de "Sites":
  (a) `www.workday.com` y páginas asociadas, (b) páginas que referencian los Terms, (c) la Community,
  (d) las Workday APIs.
- Interpretación (mía, no jurídica): los tableros `*.myworkdayjobs.com` son sitios del empleador (tenant),
  no `www.workday.com`; no se vio en ellos enlace a esos Terms ni términos propios [NV]. Aplica de todos
  modos: respetar robots.txt (§1.2), tráfico bajo, sin login, y retirar a cualquier empleador que pida
  exclusión. Para certeza jurídica, el dueño debe revisar el pie legal de cada career site antes de
  habilitarlo. Si se juzga que los Terms aplican, **no hay conector**.
- Cookies: el primer response trae `Set-Cookie` (`wd-browser-id`, `__cf_bm`, `_cfuvid`); todas las llamadas
  de este informe fueron sin cookies y funcionaron [OBS].

## 2. Listado: `POST /wday/cxs/{tenant}/{site}/jobs`

Host: `https://{tenant}.wd{N}.myworkdayjobs.com` (también `https://wd{N}.myworkdaysite.com`, ver §6).
Header `Content-Type: application/json`; sin auth, sin CSRF. Body:
```json
{"appliedFacets":{},"limit":20,"offset":0,"searchText":""}
```
Respuesta 200 `application/json` [OBS] (fixture `galderma-list-page0-unfiltered.json`):
```
{ "total": 341, "jobPostings": [ {title, externalPath, locationsText?, postedOn, timeType?, bulletFields[]} ],
  "facets": [ ... ], "userAuthenticated": false }
```
- `jobPostings[]`: `title`; `externalPath` (`/job/{Ubicación}/{slug}_{reqId}`, base del GET de detalle);
  `locationsText` (**puede faltar**: Rappi tiene 3 de 24 sin él; puede ser `"36 Locations"`);
  `postedOn` **relativo** (`Posted Today` [NV: no visto], `Posted Yesterday` [visto en Sanofi],
  `Posted N Days Ago`, `Posted 30+ Days Ago`); `timeType` (opcional); `bulletFields[]` = `[jobReqId]`
  en los tableros vistos. No hay descripción, país ni URL de postulación en el listado.
- **`total`**: [OBS] **solo es fiable en `offset=0`**. Sanofi offset 40 y offset 980 dan `total:0`;
  Rappi wd12 offset 20 da `total:24` (repite). Regla: leer `total` de la página 0, paginar hasta
  `offset >= total` o página vacía, y comparar filas leídas vs `total`. `facets` viene en todas las páginas.
- **`limit` máximo = 20** [OBS]: `limit:21` da HTTP 400. Con `limit:20 offset:980` devolvió 17 filas
  (Sanofi total 997). Valores menores de 20 sí funcionan (`limit:1` OK).
- Paginación: `offset` múltiplo de `limit`. Sanofi (997) = 50 páginas sin filtro; Mastercard (1122) = 57.
  Accenture (decenas de miles, NV) es inviable sin facetas.
- `searchText` es búsqueda libre, **no** filtra por ubicación (`searchText:"Colombia"` en Unilever devolvió
  una vacante de Ecuador): no usarlo para país.
- Errores [OBS] (fixture `error-429-and-422-and-400.json`): 422 = tenant/pod inexistente; 404 `S21
  not found: Job_Posting_Site_ID=...` = tenant existe, site no; 400 = `limit>20` o clave de faceta inválida;
  429 = throttling; 500 en la página HTML de `rappi.wd3`.

## 3. Facetas / filtrar Colombia

La respuesta trae `facets[]`; el país está en un grupo anidado:
```
facets[] = { facetParameter:"locationMainGroup", values:[
   { facetParameter:"locationCountry", descriptor:"Country",
     values:[{descriptor:"Colombia", id:"e8106cd6a3534f2dba6fdee2d41db89d", count:7}, ...] },
   { facetParameter:"locations", descriptor:"Location",
     values:[{descriptor:"COL-Bogotá", id:"35c273...", count:1}, ...] } ] }
```
Filtrar:
`{"appliedFacets":{"locationCountry":["e8106cd6a3534f2dba6fdee2d41db89d"]},"limit":20,"offset":0,"searchText":""}`.
Verificado: Sanofi da 8 vacantes (todas Bogotá), Galderma 7 (todas Bogotá); igual al contador de la faceta.

Cómo obtener el id por tenant: POST sin filtro, recorrer `facets` (aplanando `locationMainGroup`), tomar el
grupo cuyo `facetParameter` termine en `locationCountry` y el valor con `descriptor == "Colombia"`
(los descriptors podrían venir en otro idioma según el tenant [NV]).

Hallazgos críticos [OBS]:
1. **El id de Colombia fue el mismo en todos los tenants** (Galderma, Sanofi, y `country.id` del detalle
   de Rappi/AB InBev): `e8106cd6a3534f2dba6fdee2d41db89d`. Es una referencia global de Workday, pero **no
   se debe hardcodear**: leerlo de `facets` por tenant y verificar con `alpha2Code` del detalle.
2. **El nombre de la faceta NO es estable**: Galderma devuelve `alocationCountry`, `blocations`,
   `cjobFamilyGroup`... (prefijos). `appliedFacets` exige el nombre **exacto** devuelto
   (`locationCountry` en Galderma da HTTP 400; `alocationCountry` da 200). Descubrir siempre de la
   respuesta; buscar con `/locationcountry$/i`.
3. **Algunos tableros no tienen faceta de país**: Rappi y Mastercard solo traen `locations`.
   Rappi: faceta `locations` "COL-Bogotá" da 1 resultado, pero **otra vacante colombiana** (iOs Developer,
   `jobRequisitionLocation.country.alpha2Code = "CO"`, startDate 2023-11-09) no tiene `locationsText` ni
   aparece en la faceta. Una vacante sin ubicación en el listado **solo se resuelve con el detalle**
   (otra, "NOC", resultó ser Buenos Aires/AR).
4. Un tablero sin vacantes en Colombia no lista la opción (Unilever Experienced hoy: 39 países, sin
   Colombia; Kimberly-Clark `XXX_LAO`: total 0).
5. Multi-ubicación: `locationsText:"36 Locations"`; el país real solo está en el detalle.

Estrategia recomendada: (a) tablero pequeño (hasta ~200): listado completo sin faceta + detalle de las filas
que no sean `30+ Days Ago` para resolver país; (b) tablero grande: faceta de país si existe; si no existe
y total > ~200, `needs_review` (no se lee completo). La guardia `suspect` de ADR 0006 §3 debe aplicarse
al conteo de la faceta Colombia.

## 4. Detalle: `GET /wday/cxs/{tenant}/{site}/job/...`

La URL es `https://{host}/wday/cxs/{tenant}/{site}` + `externalPath` (que ya empieza con `/job/...`).
Ejemplo: `GET https://galderma.wd3.myworkdayjobs.com/wday/cxs/galderma/External/job/Bogot/Gerente-de-Demanda-Retail-para-Medicamentos-de-Prescripcin_JR021078`
devuelve 200 `application/json` (fixture `galderma-detail-colombia.json`):
```
{ jobPostingInfo:{ id, title, jobDescription(HTML), location, postedOn:"Posted 5 Days Ago",
    startDate:"2026-10-15", endDate:"2026-10-23", timeLeftToApply:"2 days left to apply",
    jobPostingEndDateAsText:"End Date: October 23, 2026", timeType:"Full time", jobReqId:"JR021078",
    jobPostingId, jobPostingSiteId:"External", country:{descriptor:"Colombia",id}, canApply:true,
    posted:true, jobRequisitionLocation:{descriptor:"Bogotá", country:{descriptor,id,alpha2Code:"CO"}},
    externalUrl:"https://galderma.wd3.myworkdayjobs.com/External/job/Bogot/...", questionnaireId },
  hiringOrganization:{name:"Galderma Colombia SA", url:""}, similarJobs:[], userAuthenticated:false }
```
Mapeo a `RawAtsPosting`:

| Campo canónico | Fuente Workday | Notas |
|---|---|---|
| externalId | `jobPostingInfo.jobPostingId` (`{slug}_{reqId}[-n]`, sin ciudad) | puede llevar sufijo `-1` (Sanofi `R2875234-1`); `jobReqId` solo no lo incluye. Estabilidad en el tiempo [NV] |
| title | `title` | |
| applyUrl | `externalUrl` | URL pública de la vacante; `canApply:true`. En tenants `myworkdaysite` apunta a `wd1.myworkdaysite.com/recruiting/...` |
| locationTexts | `location` (a veces vacío, Rappi) + `jobRequisitionLocation.descriptor` | |
| countryCodes | `jobRequisitionLocation.country.alpha2Code` | `jobPostingInfo.country` trae descriptor+id **sin** alpha2; el alpha2 solo está dentro de `jobRequisitionLocation.country` |
| structuredCity | **falta** | solo `descriptor` ("Bogotá", "COL-Bogotá", "COL - Office - Edificio Calle 127"): no es ciudad limpia |
| workplace | **falta** | sin `remoteType` en los tenants vistos [OBS]; no inventar |
| descriptionText | `jobDescription` (HTML con entidades) | convertir HTML a texto; dato no confiable |
| department | **falta** por fila | solo faceta `jobFamilyGroup` en el listado |
| employmentType | `timeType` ("Full time") | |
| publishedAt | `startDate` (YYYY-MM-DD) | ver §5 |
| validThrough | `endDate` (YYYY-MM-DD) | ver §5 |
| companyName | `hiringOrganization.name` | entidad legal ("Galderma Colombia SA", "CO19 BAVARIA & CIA S.C.A", "Rappi Technology Colombia"), no la marca; `url` vacío |

## 5. Fechas

- Listado: `postedOn` **relativo** y truncado (`30+` cubre todo lo de 30 días o más). No sirve como fecha,
  solo como filtro barato: **"30+ Days Ago" implica fuera de la regla de 30 días (ADR 0006 §2); no hace
  falta pedir detalle**.
- Detalle: `startDate` absoluta ISO `YYYY-MM-DD` (sin hora ni zona). Consistente con el relativo:
  Galderma `startDate 2026-10-15` con "Posted 5 Days Ago" (hoy 2026-10-20). Antigüedad real: Rappi Intern
  `2026-09-08` (42 días), AB InBev Junior Data Scientist `2023-09-26` (3 años, aún listado), Rappi iOs
  Developer `2023-11-09`. Es la fecha de inicio de publicación, no de actualización; hay vacantes viejas
  abiertas. Propuesta: `publishedAt = startDate` [OBS; si Workday cambia `startDate` al republicar es NV].
- `endDate` + `timeLeftToApply` ("2 days left to apply", "30+ days left to apply") +
  `jobPostingEndDateAsText` ("End Date: October 23, 2026"): presentes en Rappi y Galderma; **ausentes** en
  AB InBev. Puede ser un valor por defecto del tenant (Rappi Intern: 2026-11-30, 83 días tras el inicio).
  Usar como `validThrough` solo si existe; `null` si no.

## 6. Tableros reales verificados (2026-10-20)

| Empresa | URL pública | Ref `tenant/wdN/site` | total global | total con Colombia | Notas |
|---|---|---|---|---|---|
| Rappi | `https://rappi.wd12.myworkdayjobs.com/Rappi_jobs` | `rappi/wd12/Rappi_jobs` | **24** | faceta `locations` "COL-Bogotá": **1**; real >= 2 (otra sin ubicación en el listado) | **wd3 y wd12 no son el mismo tablero hoy**: `rappi.wd3` POST 422, robots 422, página `/es/Rappi_jobs` 500; solo wd12 sirve datos. Sin faceta de país. 3/24 filas sin `locationsText`; la mayoría son PER-Lima/BRA |
| Galderma | `https://galderma.wd3.myworkdayjobs.com/External` | `galderma/wd3/External` | **341** | **7** (faceta `alocationCountry`; todas Bogotá; 1 de 5 días y 6 "30+") | segundo site `broadbean_external` en robots (no probado) |
| Sanofi | `https://sanofi.wd3.myworkdayjobs.com/SanofiCareers` | `sanofi/wd3/SanofiCareers` | **997** | **8** (faceta `locationCountry`; 6 de 13 días o menos, 2 "30+") | `total` en offset>0 = 0 |
| AB InBev (Bavaria) | `https://wd1.myworkdaysite.com/recruiting/abinbev/COL` | `abinbev/wd1/COL` (host `myworkdaysite.com`; también responde `abinbev.wd1.myworkdayjobs.com`) | **2** (site `COL` es solo Colombia) | 2 | `hiringOrganization.name` "CO19 BAVARIA & CIA S.C.A"; startDate 2023 ("30+"); API en `wd1.myworkdaysite.com/wday/cxs/abinbev/COL/jobs` verificada |
| Unilever | `https://unilever.wd3.myworkdayjobs.com/Unilever_Experienced_Professionals` | `unilever/wd3/Unilever_Experienced_Professionals` | 234 | **0** (Colombia no está en la faceta) | canario negativo / control |
| Mastercard | `https://mastercard.wd1.myworkdayjobs.com/CorporateCareers` | `mastercard/wd1/CorporateCareers` | 1122 | sin faceta de país (solo `locations`, 163 valores) | caso "grande, sin faceta país" |
| Teleperformance | `teleperformance.wd1` sites `teleperformance` (6) y `allianceone` (18) | `teleperformance/wd1/...` | 6 / 18 | no medido | no parece ser su portal de Colombia |
| **Accenture** | `https://accenture.wd103.myworkdayjobs.com/AccentureCareers` | `accenture/wd103/AccentureCareers` (existe según robots) | **NO VERIFICADO** | **NO VERIFICADO** | POST con 429 en 6 de 6 intentos en ~12 min; no se evadió. Robots 200 y permite el site. Sites: AccentureCareers, AccentureLeadershipCareers, AvanadeCareers, AvanadeLeadershipCareers |
| Heinz | `heinz.wd1` | - | - | - | site `KraftHeinz_Careers` con `Disallow`: sin conector (§1.2) |
| Holcim, Smurfit Westrock, Sodexo, GFT, Nestlé, Colgate, Bayer, Cargill, Cemex | - | - | - | - | tenants adivinados (`{marca}.wd{1,3,5,12}`) sin robots 200 / POST 422: **tenant/pod no hallado** (o no usan Workday). No se insistió |

Cómo hallar pod y site sin adivinar: `GET https://{tenant}.wd{N}.myworkdayjobs.com/robots.txt`: 200 con líneas
`Sitemap: .../{Site}/siteMap.xml` y `Allow: /{Site}/`; 422 = pod equivocado o tenant inexistente. `POST
.../jobs` con site inexistente en el pod correcto: 404 `S21`.

## 7. Rate limits y cabeceras [OBS]

- Servidor `cloudflare`; `Cache-Control: no-store`; **sin** `Retry-After`, `X-RateLimit-*` ni `Link`;
  `x-wd-request-id`. El 429 llega como JSON `{"errorCode":"HTTP_429",...}`.
- Throttling por tenant: **Accenture 429 persistente** (6 de 6 intentos, hasta con 1 request/60 s).
  Rappi, Galderma, Sanofi, Unilever, AB InBev, Mastercard, Teleperformance: 0 errores con ~3-10 requests a 3 s.
- Presupuesto sugerido: concurrencia 1 por tenant, >= 2-3 s entre requests, backoff exponencial ante 429
  (5 min, tope 24 h); 3 x 429 seguidos = tablero `blocked/suspect` sin cerrar nada, reintento no antes de
  7 días (misma regla que `site-probe-ats-links.md` §1.2). Un 429 nunca es "listado completo".
- Tamaños: listado 20 filas ~8 KB + facets (hasta ~60 KB con 160 ubicaciones); detalle 3-10 KB (+ ~10 KB de
  `videoInfo` en AB InBev: ignorar).

## 8. Detalle de vacante inexistente [OBS]

`GET .../job/COL-Bogot/Nope_JR999999` da **HTTP 404** JSON `{"errorCode":"S21","httpStatus":404,"message":
"not found: Job_Posting_Anchor_ID=Nope_JR999999"}` (fixture `detail-not-found-404.json`). Sirve como señal
de "link muerto" (cierre inmediato como Greenhouse/Lever), a diferencia de Ashby. **No se probó una vacante
realmente cerrada** (no existe fixture de ese estado) ni un `externalPath` con ciudad equivocada pero reqId
correcto [NV]: confirmar con un canario cuando una vacante desaparezca del tablero y antes de activar el
cierre inmediato.

## 9. Faltantes frente al schema canónico y riesgos

- Faltan: `workplace`, `structuredCity` limpio, `department` por fila.
- Completitud (ADR 0006 §3): "completo" = todas las páginas 200 con `jobPostings` presente **y** filas
  leídas == `total` de offset 0. Con faceta, el total es el de la faceta, no el del tablero; el listado
  filtrado no prueba la ausencia de vacantes sin ubicación (Rappi). Cerrar solo con listado completo sin
  filtro, o aceptar que el subconjunto por faceta puede omitir vacantes.
- Dos familias de host por tenant (`myworkdayjobs.com` y `myworkdaysite.com/recruiting/{tenant}/{site}`);
  `tenant/wdN/site` no basta si el host es `myworkdaysite.com`: la ref debe indicar la familia.
- Entidad legal en `hiringOrganization.name`: no es la clave de empresa del directorio; no auto-habilitar
  por nombre (un tablero Workday con >= 1 vacante en Colombia + nombre coincidente va a `needs_review`).
- Seguridad: `title`, `jobDescription` (HTML) y `locationsText` son texto no confiable; ninguna respuesta
  leída contenía instrucciones dirigidas a un agente. Sin datos personales en las respuestas.

## 10. Fuentes

- Workday Online Terms of Service (actualizado 08/13/2026): https://www.workday.com/en-us/legal/site-terms.html
- Workday docs, candidate experience (administración; no documentan CXS):
  https://doc.workday.com/admin-guide/en-us/workday-feature-descriptions/workday-paradox/reference--candidate-experience-capabilities.html
- RFC 9309: https://www.rfc-editor.org/rfc/rfc9309.html
- Observación directa (2026-10-20) de `robots.txt` y `/wday/cxs/...` de rappi, accenture, galderma, sanofi,
  unilever, mastercard, teleperformance, abinbev, heinz (fixtures en `fixtures-workday/`).

## 11. Conector implementado y canario (2026-10-20)

`src/direct/ats/workday.ts` (`ats_type = workday`, `ats_ref = tenant/wdN/site`, host
`myworkdayjobs.com`). Política de robots de §1.2 (site prohibido o fuera de una lista
`Allow` explícita = no se lee). ≤ 200 vacantes: listado completo; más: faceta de país
del propio tenant (nombre descubierto en cada lectura); grande sin faceta = error
reportado. Detalle solo para ids nuevos que no digan "30+" (presupuesto 25), con 1 s
de pausa entre requests del mismo tablero; prefijo ISO-3 ajeno (`PER-Lima`) no gasta
detalle. Fechas: `startDate`/`endDate` del detalle. Cierre solo por listados.

Canario en vivo (`scripts/direct-canary.ts`, presupuesto 10, sin BD):

| tablero | resultado | vigentes CO | requests | tiempo |
|---|---|---:|---:|---:|
| `galderma/wd3/External` | completo vía faceta `alocationCountry` (7; 6 son "30+") | 1 | 4 | 4,9 s |
| `sanofi/wd3/SanofiCareers` | completo vía faceta (9) | 7 | 10 | 15,1 s |
| `rappi/wd12/Rappi_jobs` | completo (24; sus CO son "30+") | 0 | 3 | 2,3 s |
| `abinbev/wd1/COL` | completo (2, ambas de 2023) | 0 | 2 | 0,8 s |
| `accenture/wd103/AccentureCareers` | **sin verificar**: listado global OK, página filtrada "forma inesperada"; luego 429. No se insistió | — | 3 | 11,4 s |

Riesgo abierto (dueño): Workday Online Terms prohíben scraping de "Sites"
(workday.com, Community, APIs de Workday). Los career sites `*.myworkdayjobs.com` son
del empleador y su robots.txt permite la ruta; interpretación no jurídica (§1.3).
