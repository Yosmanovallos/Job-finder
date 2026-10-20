# Gupy ({x}.gupy.io) - investigacion para conector D5

Investigacion `source-researcher` del 2026-10-20 para `docs/adr/0006-direct-employers.md` §5/§7 (D5).
Leyenda: **[DOC]** documentado oficialmente; **[OBS]** observado, no garantizado; **[NV]** no verificado.
UA usado: `BuscoTrabajoBot/1.0 (+https://buscotrabajo.co)`. Fixtures reales en `fixtures-gupy/`.

## Veredicto

**DIFERIDO - pendiente de decision del dueno sobre los terminos de uso.** Tecnicamente hay una via viable
(HTML SSR del tablero del tenant + una peticion por vacante para la fecha) y robots.txt la permite, pero:
(a) no existe API ni feed documentado para terceros (todo es [OBS], interno de Next.js), y
(b) los terminos de uso de Gupy prohiben textualmente "agregar, copiar ou duplicar" contenido de la
plataforma (§1.2). Aceptar ese riesgo, o pedir permiso a Gupy/empresa, es decision del dueno, no del conector.

## 1. Cumplimiento

### 1.1 robots.txt (literal)
- Tenant `https://topaz.gupy.io/robots.txt` [OBS] (identico en `boticario.gupy.io`; solo cambia el Sitemap):
  ```
  User-agent: *
  Allow: /
  Disallow: /companies
  Disallow: /candidates

  Sitemap: https://job-boards.api.gupy.io/production/job-board-content?jobBoardName=google&subdomain=topaz
  ```
  **Trampa de formato:** se sirve como `text/html` (pagina Next.js) con las reglas dentro de `<pre>`; un parser
  RFC 9309 sobre el cuerpo crudo NO ve `User-agent: *`. Hay que extraer el texto de `<pre>` y des-escapar
  entidades (`&amp;`) antes de parsear.
- `/` (listado) y `/jobs/{id}` (detalle) estan **permitidos**. `/candidates/*` y `/companies*` prohibidos.
- `portal.gupy.io/robots.txt` [OBS]: `User-agent: *` / `Disallow:` (todo permitido).
- `portal.api.gupy.io/robots.txt` y `employability-portal.gupy.io/robots.txt`: 404 (RFC 9309 §2.3.1.3: todo
  permitido; pero esos hosts no sirvieron una API de vacantes utilizable, ver §2).
- `www.gupy.io/robots.txt`: `*` bloquea solo rutas HubSpot/preview/login; nombra GPTBot, ClaudeBot, etc. con
  `Allow: /`. No nombra BuscoTrabajoBot.

### 1.2 Terminos de uso (riesgo alto)
Fuente: https://www.gupy.io/termos-de-uso-recrutamento-e-selecao-candidatos (terminos para candidatos, sin
numeracion; encabezado "Diretrizes Gerais do Usuario", lista de conductas prohibidas). Cita literal [DOC]:

> "agregar, copiar ou duplicar partes do Gupy Recrutamento e Seleção, incluindo oportunidades de trabalho expiradas;"

> "adaptar ou disponibilizar o link para qualquer Conteúdo da Gupy ou informações disponíveis no Site" (... "salvo se permitido por este Termo")

> "acessar dados de terceiros, servidores ou contas que não é autorizado a acessar;"

La unica reutilizacion permitida es "compartilhar nas redes sociais todo o conteúdo disponível dentro da
Plataforma". "A publicação de vagas e seu conteúdo são de responsabilidade da Empresa cliente". El documento no
menciona robots, crawlers ni scraping. "A Gupy apenas disponibiliza uma API pública e webhooks" (seccion
"Integração com outros sistemas"): esa API es la de integracion con token de empresa cliente
(https://developers.gupy.io), **no** un listado publico para terceros [NV: su detalle no se reviso; requiere token].
Interpretacion: un agregador que copia vacantes cae en la primera clausula. Hay que decidir (permiso explicito
de Gupy o de cada empresa, o aceptar el riesgo) antes de escribir un conector. No se resuelve tecnicamente.

## 2. Endpoints probados

| Intento | Resultado |
|---|---|
| `https://portal.api.gupy.io/api/v1/jobs?...`, `/api/job?...` | 404 nginx |
| `https://employability-portal.gupy.io/api/v1/jobs?...` (host que aparece en los chunks JS del portal) | 404 nginx |
| `https://portal.gupy.io/api/v1/jobs?...` | 200 pero HTML (SPA), no JSON |
| **`https://{x}.gupy.io/`** (HTML SSR, `__NEXT_DATA__`) | 200; `props.pageProps.jobs[]` con TODAS las vacantes del tablero |
| `https://{x}.gupy.io/jobs/{id}` (HTML SSR + JSON-LD) | 200; detalle con fecha, pais alpha-2, descripcion |
| Sitemap de robots -> 302 -> XML en S3 prefirmado | 200 `application/xml`, solo URLs (ver 2.3) |
| `https://portal.gupy.io/job-search/term=...` (SSR del portal) | 200; busqueda global paginada de 12 |

No se encontro API de listado publico documentada para terceros. Todo lo siguiente es [OBS], sin contrato.

### 2.1 Listado del tenant - fuente recomendada si se aprobara
`GET https://{x}.gupy.io/` -> HTML; JSON en `<script id="__NEXT_DATA__" type="application/json">`.
`Cache-Control: max-age=900` [OBS]. Forma (fixture `listing-topaz-ssr.json`):
```
props.pageProps.careerPage {id, companyId, name, publicationName, subdomain, visibility, ...}
props.pageProps.jobs[]  {id:int, title, type, department, workplace:{address:{country,stateShortName,state,city,district}, workplaceType}, quickApply}
```
- **Sin paginacion**: `jobs[]` trae todo el tablero (medido: Topaz 33, Stefanini 177, Decathlon 30, DEXCO 96;
  coincide con el texto "N vagas encontradas para 0 filtros aplicados" de la misma pagina). Un snippet de
  busqueda del mismo dia daba 184 para Stefanini y al medir eran 177: el tablero cambia en minutos.
- **Completitud**: HTTP 200 + `__NEXT_DATA__` parseable + `jobs` array + `careerPage.subdomain == {x}`. El
  conteo "N vagas" sale de los mismos datos, asi que NO es verificacion independiente. Contra el Sitemap (2.3)
  tampoco cuadra (Topaz: SSR 33 / sitemap 26 / interseccion 24): el SSR es la fuente mas completa.
- `type` [OBS]: `vacancy_type_effective`, `vacancy_type_associate`, `vacancy_type_temporary`,
  `vacancy_type_autonomous`, `vacancy_type_apprentice`, `vacancy_legal_entity`, **`vacancy_type_talent_pool`**.
  Los `talent_pool` son bancos de talento perpetuos con fechas viejas (Topaz 5004277 publicado 2023-06-16):
  **filtrar por `type`, no son vacantes**.
- `workplaceType` [OBS]: `on-site` (con guion), `hybrid`, `remote`.
- `country` es nombre localizado en portugues ("Colômbia", a veces "Colombia", "Uruguai", "Brasil"), **no
  alpha-2**; `state` es texto libre ("colombia", "Atlantico", "Bogotá, D.C., Colombia"); `city` trae espacios
  ("Cali ") y a veces el pais concatenado.
- Sin fecha, sin descripcion, sin URL de postulacion, sin nombre de empresa fiable en el listado.

### 2.2 Detalle `GET https://{x}.gupy.io/jobs/{id}` (fixtures `detail-*.json`, `jsonld-*.json`)
`__NEXT_DATA__.props.pageProps.job` [OBS]:
- `id` (int, estable), `code` ("42212-12599786" = companyId-jobId), `name`, `description`/`prerequisites`/
  `responsibilities` (HTML), `status` ("published"), `jobType`, `workplaceType`,
- **`publishedAt`** ISO 8601 UTC (`2026-10-15T13:21:14.845Z`): fecha de publicacion absoluta,
- `expiresAt` ("2026-11-25") y `registerEndDate` ("2026-11-30"): **pueden diferir** (visto 11-20 vs 12-18).
  El JSON-LD `validThrough` coincide con `expiresAt`. Usar `expiresAt` como `validThrough` [OBS],
- **`addressCountryShortName`** alpha-2 ("CO", "UY"), `addressCountry` (texto pt), `addressCity`,
  `addressState`, `addressLine`,
- `company.subdomain` puede diferir del host (Decathlon: host `trabajaconnosotrosdecathlonco`,
  `company.subdomain` = `decathloncolombia`): el `ats_ref` es el subdominio del **host**,
- `careerPage.name` es el titulo de la pagina ("Trabaja con nosotros Decathlon Colombia"; `publicationName`
  "topazlatam"): **no es nombre de empresa fiable** -> `companyName=null`, empresa en `needs_review`.
- JSON-LD `JobPosting` (JSON con entidades HTML escapadas): `datePosted` (solo fecha, "2026-10-15"),
  `validThrough`, `employmentType` (FULL_TIME), `hiringOrganization.name` (= titulo de la pagina),
  `jobLocation.address.addressCountry` = "Colômbia" (texto, no alpha-2). Preferir `__NEXT_DATA__`.
- URL de postulacion: `https://{x}.gupy.io/jobs/{id}?jobBoardSource=gupy_public_page` (`canonicalUrl`). El
  login esta en `/candidates/*` (Disallow; no se sigue).
- **Costo**: una peticion por vacante para fecha y alpha-2. Stefanini serian 177; filtrando el listado por
  `type` efectivo y pais Colombia (25 -> 22) bastan ~22 detalles + 1 listado. Minimo con este diseno.

### 2.3 Sitemap de robots (no autoritativo)
`job-boards.api.gupy.io/production/job-board-content?jobBoardName=google&subdomain={x}` -> 302 a un XML en
`gupy-job-boards-production.s3.amazonaws.com` con URL **prefirmada temporal** (no persistir ni registrar ese
URL). Es un `<urlset>` "google_for_jobs": solo `<loc>` (`/job/<base64 {"jobId":N,...}>`), `<lastmod>` malformado
(`2026-10-01T13:02T+00:001`), sin fecha de publicacion, pais ni titulo. Topaz: 26 URLs vs 33 en SSR (24 comunes,
2 solo en sitemap, 9 solo en SSR). **No sirve para listar ni para cerrar.** Fixture `sitemap-feed-topaz.xml`.

### 2.4 Portal global (descartado)
`https://portal.gupy.io/job-search/term=...` -> SSR con `initialJobList.data[]` (12 por pagina,
`pagination:{total,limit,offset}`), cada item con `publishedDate` ISO, `jobUrl`, `workplaceType`, `city`,
`state` (sin pais). Descartado: (1) el filtro `careerPageName[]=` usa `publicationName` ("topazlatam"), no el
nombre visible; (2) **`total` incompleto**: Stefanini da `total: 100` frente a 177 en el tenant; (3) el filtro
`state=Bogotá` devolvio 0; (4) sin pais. Solo indica que `publishedDate` existe en el indice de busqueda.

## 3. Mapeo a `RawAtsPosting` (si el dueno aprobara)
| Campo | Origen | Estado |
|---|---|---|
| externalId | `job.id` (int -> string) | OK [OBS] |
| title | `job.name` / listado `title` | OK |
| applyUrl | `https://{x}.gupy.io/jobs/{id}?jobBoardSource=gupy_public_page` | OK |
| locationTexts | `[city, state, country]` | texto sin normalizar |
| countryCodes | `addressCountryShortName` (detalle) | alpha-2, solo en detalle |
| structuredCity | `addressCity` | libre, a veces con pais |
| workplace | `workplaceType` (`on-site` -> onsite) | OK |
| descriptionText | `description`+`prerequisites`+`responsibilities` (HTML->texto) | solo en detalle |
| department | `department` (listado) | OK |
| employmentType | JSON-LD `employmentType`; `jobType` | parcial |
| publishedAt | `job.publishedAt` | solo en detalle |
| validThrough | `expiresAt` (detalle) | OK; distinto de `registerEndDate` |
| companyName | - | **falta** (`careerPage.name` es titulo de pagina) |

## 4. Vacante cerrada / inexistente
- `GET /jobs/99999999` (id inexistente) -> **307 `Location: /candidates/signin`** (Disallow en robots; no
  seguirla) [OBS]. `/jobs/{id de otro tenant}` -> 404; `/job/{base64}` de otro tenant -> 404 [OBS].
- No se probo una vacante realmente cerrada [NV]. El 307 a login no prueba cierre. **Cerrar solo por listados
  completos ausentes** (como Ashby/SmartRecruiters); `canConfirmClosure` = false.

## 5. Rate limits
No documentados [NV]. ~40 peticiones espaciadas >= 2 s sin 429. Recomendado 1 req/2 s por tenant y no releer el
listado antes de 15 min (`max-age=900`).

## 6. Canarios con vacantes en Colombia (conteos antes del filtro de 30 dias, 2026-10-20)
| Tenant (`ats_ref`) | Tablero | Colombia | Colombia con type = effective | Notas |
|---|---|---|---|---|
| `topaz` (Topaz LATAM) | 33 | 22 | 19 | 3 son banco de talento; Bogota |
| `stefaninilatam` (Stefanini Latam) | 177 | 25 | 22 | 7 paises; Bogota, Cali |
| `trabajaconnosotrosdecathlonco` (Decathlon Colombia) | 30 | 30 | 28 | solo Colombia; 2 de tipo `associate` |

Descartados: `dexco` (96, 0 CO), `lavoroagro` (11, 0 CO), `cobistopaz` y `boticario` (404 hoy).
La columna effective cuenta solo `vacancy_type_effective` literal; los demas tipos no talent_pool (associate,
temporary, etc.) hay que decidir si entran (Decathlon `associate` parece vacante normal).

## 7. Riesgos
- Todo [OBS]: la estructura Next.js puede cambiar sin aviso; schema tolerante y tablero `suspect` ante caida a 0.
- Texto de vacantes = dato no confiable; extraccion determinista, sin LLM.
- Cuerpo de la home 120-170 KB (dentro de topes).
- Registrar la decision del dueno sobre los terminos en un ADR si se procede.

## Fuentes
- https://www.gupy.io/termos-de-uso-recrutamento-e-selecao-candidatos
- https://developers.gupy.io (API de integracion con token; no revisada en detalle)
- robots reales: https://topaz.gupy.io/robots.txt, https://portal.gupy.io/robots.txt, https://www.gupy.io/robots.txt
- RFC 9309 - https://www.rfc-editor.org/rfc/rfc9309.html
