# SAP SuccessFactors Recruiting Marketing (RMK / Career Site Builder): sitemap + microdatos + listado /search/

Investigación `source-researcher` del 2026-10-20 para `docs/adr/0006-direct-employers.md`
§3-4, §7 (D5). Leyenda: **[DOC]** documentado oficialmente; **[OBS]** observado
el 2026-10-20, no garantizado; **[NV]** no verificado con fuente oficial.
UA usado: `BuscoTrabajoBot/1.0 (+https://buscotrabajo.co)`, ~40 requests en total,
espaciadas 2-3 s, sin seguir redirects a `/errorpage`, sin reintentos.
Fixtures reales recortados: `fixtures-successfactors/` (misma carpeta).

## 0. Veredicto

Viable para Bancolombia y tableros hermanos RMK con **método híbrido de bajo costo**:
el listado HTML `/{sitio}/search/?q=&sortColumn=referencedate&sortDirection=desc&startrow=N`
(25 filas/página, permitido por robots) trae por fila título, id de requisición,
ubicación `"COL, CO"`, departamento y fecha, y trae el total ("de 43") para probar
completitud. El `sitemap.xml` sirve de contraste (conjunto de IDs idéntico en
Bancolombia: 43 = 43). La página de vacante solo hace falta para descripción /
`validThrough`. **No hay RSS utilizable**: `/services/` está prohibido por robots.txt.
**No hay JSON-LD**: solo microdatos `itemprop`, y su forma cambia por tenant.
Riesgo principal: la "fecha" es la *reference date* de RMK, que SAP refresca
periódicamente (§3.4), no la fecha original de publicación.

## 1. Cumplimiento

### 1.1 robots.txt literal [OBS, 2026-10-20]

`https://empleo.grupobancolombia.com/robots.txt` (200, 252 bytes, `Apache`; sin línea `Sitemap:`):

```
User-agent: *
Disallow: /applybutton/
Disallow: /talentcommunity/
Disallow: /mobile/talentcommunity/
Disallow: /emailsubscribe/
Disallow: /email/image/
Disallow: /services/
Disallow: /preapply/
Disallow: /error
Disallow: /unsubscribe/
Disallow: /reset/
```

Las mismas 10 reglas en `trabajaconnosotros.sura.com`, `jobs.avianca.com`,
`jobs.scotiabank.com`, `careers.ey.com` [OBS]. SAP indica que el robots.txt de RMK se
genera a nivel de sistema por centro de datos y **no es personalizable por sitio**
(SAP KBA 2820583, "Is it possible to Prevent Indexing of the Career Site in Recruiting -
Recruiting Marketing"; cuerpo tras login SAP for Me: solo vi título y síntoma; el resto
viene de un resumen de buscador) [NV].

Evaluación contra las URLs que importan (RFC 9309, prefijo más largo):

| URL | Resultado |
|---|---|
| `/sitemap.xml` | permitido (sin regla) |
| `/{sitio}/job/.../{id}/` y `/job/.../{id}/` | permitido |
| `/{sitio}/search/?q=...&startrow=N` | permitido |
| `/services/rss/job/?locale=...` (RSS) | **PROHIBIDO** (`Disallow: /services/`); no se pidió |
| `/talentcommunity/apply/{id}/` (botón Aplicar) | **PROHIBIDO**; no se pide, solo es el destino del humano |
| `/errorpage/?errortype=...` (destino del 302 de vacantes inexistentes) | **PROHIBIDO** (`/error` es prefijo): no seguir el redirect |

`career8.successfactors.com/robots.txt` y `career10...`: `Disallow: /` y `Disallow: /*company`
(solo `Allow: /login`) [OBS]. El portal clásico `careerN.successfactors.com/career?company=X`
queda **prohibido a bots**: fuera de alcance.

### 1.2 Términos

- Sitio de Bancolombia: el único enlace legal en las páginas de vacante es "Política de
  protección de datos" (`/bancolombia/content/politica-de-proteccion-de-datos/`); la leí
  (50 KB) sin hallar cláusula sobre scraping/bots. No localicé "Términos de uso" del
  portal [NV]. Cada sitio es del cliente: revisar el suyo antes de habilitarlo.
- Términos de SAP: la plataforma es del cliente y SAP solo la opera; no encontré término
  público de SAP que gobierne el rastreo de sitios de carrera de clientes [NV]. La base de
  conocimiento SAP (KBA) exige cuenta; no se usó.
- Las respuestas llevan `Set-Cookie: JSESSIONID` (Secure, HttpOnly); no hace falta devolverla
  ni autenticar [OBS]. Datos públicos de la vacante, sin PII de candidatos. El HTML es dato no
  confiable (descripción libre del cliente, con HTML inline y emoji); no se hallaron
  instrucciones dirigidas a modelos.

## 2. Estructura del sitemap [OBS]

`GET https://empleo.grupobancolombia.com/sitemap.xml`: 200, `text/xml;charset=UTF-8`,
34.921 bytes, `Cache-Control: no-cache`, **`urlset` plano (sin índice ni hijos)**, con
`xml-stylesheet` (ignorar). Cada entrada: `<loc>`, `<lastmod>`, `<changefreq>daily`,
`<priority>0.9`.

- **Un solo host sirve varias marcas**: 144 URLs = 43 `/bancolombia/job/` + 81 `/bam/job/`
  (Guatemala, `GT`) + 20 `/bancoagricola/job/` (El Salvador, `SV`). Las 43 de
  `/bancolombia/` terminan en `-COL`, todas Colombia. Hoy contar `-COL` = 43 (el ADR midió
  44 sobre 147: varía con el tiempo).
- **`lastmod` es inútil**: las 144 entradas valen `2026-10-17` (fecha de generación). Igual
  en Avianca (35 URLs) y EY (8.944).
- URL: `/{sitio}/job/{Ubicacion-Titulo-slug}/{reqId}/`; `reqId` numérico de 10 dígitos
  (p.ej. `1440939300`) = identificador estable. Tableros de un solo sitio: `/job/{slug}/{id}/`.
- Frecuencia: SAP afirma que los sitemaps de CSB se actualizan cada semana (resumen de
  buscador de KBA 2887940) [NV]. Observado: el conjunto de IDs del sitemap de Bancolombia
  **coincide exactamente** con el del listado `/search/` (43 = 43) tres días después de su
  `lastmod` [OBS]; sin garantía.
- **Cómo saber que está completo**: el sitemap no trae contador. Propuesta: 200 + `urlset`
  bien formado + **cruce con el total "de N" del listado `/search/`** del mismo sitio
  (`N == filas leídas == URLs del sitemap con ese prefijo`). Si difieren: listado `error`
  (no cerrar nada). Un `urlset` **vacío con 200 existe**: Sura devolvió
  `<urlset ...></urlset>` (270 bytes) y su `/search/` no muestra filas [OBS] (cero vacantes
  hoy); la guardia `suspect` del ADR §3 cubre una caída a 0.
- Tamaño: Bancolombia 35 KB, Avianca 7 KB, EY 2 MB. **Scotiabank
  `jobs.scotiabank.com/sitemap.xml` no es sitemap**: devuelve un feed RSS tipo Google Base
  de >18 MB (descarga cortada a 30 s); excede el tope de 15 MB del ADR §9: no apto [OBS].

## 3. Página de vacante

### 3.1 Formato: microdatos, no JSON-LD [OBS]

`application/ld+json` = 0 en todas las páginas probadas (Bancolombia x4, Avianca x2). Hay un
bloque `schema.org/JobPosting` con `itemprop`, casi todo en `<meta>`:

```html
<div class="jobDisplayShell" itemscope itemtype="http://schema.org/JobPosting">
 <span itemprop="jobLocation" itemscope itemtype="http://schema.org/Place">
  <span itemprop="address" itemscope itemtype="http://schema.org/PostalAddress">
   <meta itemprop="addressLocality" content="Etipani">   <!-- NO es ciudad -->
   <meta itemprop="addressRegion" content="COL">
   <meta itemprop="addressCountry" content="CO"></span></span>
 <meta itemprop="datePosted" content="Fri Oct 16 00:00:00 UTC 2026">
 <meta itemprop="validThrough" content="Thu Oct 22 05:00:00 UTC 2026">
 <meta itemprop="hiringOrganization" content="Una empresa del Grupo Bancolombia">
 ... <h1 id="job-title" itemprop="title">...</h1> ... <span itemprop="description">HTML libre</span>
```

| Campo `RawAtsPosting` | ¿Está? | Detalle |
|---|---|---|
| `externalId` | sí, fuera del microdato | último segmento numérico de la URL; también `jobID : 1440939300` en `j2w.Apply.init`. **No hay `identifier`** en microdatos |
| `title` | sí | `itemprop="title"`; `<title>` añade "Detalles del puesto / empresa" |
| `applyUrl` | usar el `canonical` de la vacante | el botón real `/talentcommunity/apply/{id}/?locale=es_ES` está prohibido a bots |
| `countryCodes` | **sí, forma depende del tenant** | Bancolombia: `addressCountry="CO"` (alfa-2; nunca "COL"/"Colombia" ahí) y `addressRegion="COL"` (alfa-3). Bam: `GT`/`GTM`. **Avianca: sin `addressCountry`**, solo `streetAddress="Pasto, CO"` / `"BOG, CO"` (último token alfa-2) |
| `locationTexts` | parcial | visible `Ubicación: COL, CO`; Avianca `jobGeoLocation` = `Pasto, CO`; EY (listado) `Bogotá D.C., Bogotá D.C., CO, 110111` |
| `structuredCity` | **no fiable** | Bancolombia `addressLocality="Etipani"` (token de agrupación). Ciudad solo en H1/descripción y a veces en el slug (`...-Cali-COL`). `null`, salvo tenants cuyo listado da `Ciudad, CO` (Avianca, EY) |
| `workplace` | no | `null` |
| `descriptionText` | sí | `itemprop="description"`, HTML libre; convertir a texto |
| `department` | solo en listado | `jobDepartment` ("Comercial", "Tecnología") |
| `employmentType` | **no** | sin `employmentType` en microdatos |
| `publishedAt` | sí (`datePosted`), con matices §3.4 | **no ISO**: `Fri Oct 16 00:00:00 UTC 2026` (formato `Date.toString` de Java, siempre `UTC`) |
| `validThrough` | a veces | Bancolombia `Thu Oct 22 05:00:00 UTC 2026` (6 días tras `datePosted`); la req antigua 1346872500 **no** lo trae. Avianca sí |
| `companyName` | sí, genérico | `hiringOrganization` es `content` plano (no objeto): "Una empresa del Grupo Bancolombia" (no es marca ni razón social); Avianca "Aerovias Del Continente Americano S.A.". El nombre debe venir de `employers`, no del ATS |

### 3.2 Dos plantillas [OBS]

Bancolombia: plantilla clásica (`<h1 id="job-title" itemprop="title">`). Avianca: nueva
(`data-careersite-propertyid="title"`, `streetAddress`). Parser tolerante: extraer todos los
`itemprop`/`content` dentro de `jobDisplayShell`; país con esta precedencia:
`addressCountry` (alfa-2) -> último token alfa-2 de `streetAddress`/`jobGeoLocation` -> no
Colombia. Nunca fijar "Colombia" por defecto.

### 3.3 Alternativas más baratas que pedir cada página

| Opción | Estado |
|---|---|
| RSS `/services/rss/job/?locale=` | **Prohibido por robots** (`Disallow: /services/`). No se pidió. Descartado |
| `careerN.successfactors.com/career?company=X` | `Disallow: /`. Descartado. Las APIs OData de SuccessFactors requieren credenciales del cliente [NV, sin fuente oficial leída] |
| **Listado `/search/?q=&sortColumn=referencedate&sortDirection=desc&startrow=N`** | **Permitido, recomendado.** 25 filas/página. Bancolombia: "Resultados 1-25 de 43" y `startrow=25` da "26-43 de 43". Fila: título, `href` con reqId, `jobDepartment`, `jobLocation` = `COL, CO`, `jobDate` = `16 oct 2026`. Avianca: 25+10 de 35, ubicaciones `BOG, CO`, `Toronto, CA`... EY con `&locationsearch=Colombia`: 70 resultados (= 70 slugs con ciudad colombiana en su sitemap), **sin columna de fecha** (config de ese tenant) |

Fidelidad de la fecha del listado [OBS]: Bancolombia coincide con `datePosted` (16 oct = 16 oct;
8 oct = 8 oct). **Avianca difiere**: listado 30 sept vs microdato `Oct 02`; listado 28 sept vs
`Sep 30 02:01 UTC` (2 días, causa desconocida). El listado está localizado (`24 sept 2026`,
con `sept`): exige tabla de meses ES y es frágil; si hace falta fecha fiable, tomar el
microdato de la página.

### 3.4 Qué significa `datePosted` (riesgo para la regla de 30 días)

- Resúmenes de buscador de KBA de SAP (cuerpos tras login; no verificados) [NV]: la fecha
  mostrada en RMK es la *reference date*, no la de publicación en RCM; se fija al importar el
  job a RMK y **se refresca cada ~28 días / mensualmente** (KBA 2253054, KBA 2233530). Lo que
  sí vi en el preview de 2253054: "On the RMK Career site, the date displayed does not match
  the RCM Start date, on the same Job Requisition."
- Observado, coherente con eso: la req **1346872500** (id ~2025, "Semillero Talento
  Diverso") muestra `datePosted = Sat Oct 17 2026` y sin `validThrough` [OBS].
- Implicación: es la "fecha declarada por el ATS" (ADR §2), pero puede **renovarse**, y una
  vacante abierta meses reaparecería "nueva" cada ~28 días. Para no resucitar filas (lección
  §9.2 de SEO-PLAN), `published_at` debe fijarse en la primera lectura y no actualizarse; la
  vigencia ya la acota `COALESCE(published_at, first_seen_at)` + 30 días. No inventar fecha.

## 4. Vacante cerrada / inexistente [OBS]

`GET /bancolombia/job/Etipani-Inexistente-COL/1000000001/` -> **302**
`Location: /errorpage/?errortype=Exception`, cuerpo vacío. Sin segmento de sitio
(`/job/...`) -> mismo 302 (servido por `nginx` en ese caso). El destino `/errorpage` está
prohibido por robots: **no seguir el redirect**. No tenía un id real ya cerrado, así que no
sé si una vacante cerrada de verdad da lo mismo [NV]. Coherente con ADR §3: cierre **solo por
ausencia en 2 listados completos** (como Ashby/SmartRecruiters), no por "link muerto".

## 5. Tableros SuccessFactors con Colombia (canarios) [OBS, 2026-10-20]

Fingerprint: robots.txt de 10 reglas idénticas + `/sitemap.xml` `urlset` con
`view/xsl/sitemapssl.xsl` + referencias a `jobs2web`/`rmkcdn.successfactors.com`. Búsqueda
por nombre (Holcim, Nutresa, Ecopetrol, Éxito, Davivienda, Bavaria, ISA, Celsia, Argos): sin
evidencia de portal RMK propio (prensa: Nutresa y Ecopetrol usan Magneto, Davivienda Taleo;
hosts adivinados no resuelven por DNS; `jobs.siemens.com` ya declara Avature). Los candidatos
salen de los hosts de `piloto-nacional-co` (solo nombres de host; sus datos no se usaron),
verificados en vivo, más Sura:

| Tablero | URL base | Vacantes totales | Colombia |
|---|---|---|---|
| Bancolombia | `https://empleo.grupobancolombia.com/bancolombia/` | 43 (host: 144 con GT 81 y SV 20) | **43** (todas `COL, CO`) |
| Avianca | `https://jobs.avianca.com/` | 35 | **21** (15 + 6 en los 2 listados) |
| EY (global) | `https://careers.ey.com/ey/` | 8.944 en sitemap | **70** (`locationsearch=Colombia`, 3 págs); sin fecha en listado |
| Sura | `https://trabajaconnosotros.sura.com/` | **0** (sitemap vacío, `/search/` sin filas) | 0 hoy |
| Scotiabank | `https://jobs.scotiabank.com/` | no medido | sitemap = RSS >18 MB: no apto |

Notas: (a) Avianca: el prefijo del slug (`BOG-`, `Pasto-`, `EZE-`) no sirve para filtrar; el
país está en `streetAddress`/listado. (b) EY y Avianca publican vacantes globales: filtro
estricto `CO`. (c) Sura es útil como canario de "sitemap vacío con 200".

## 6. Requests por tablero y tick

| Estrategia | Bancolombia (43 CO) | Avianca (35, 21 CO) | EY (8.944, 70 CO) |
|---|---|---|---|
| A. Solo listado `/search/` (recomendada) | 2 | 2 | 3 (`locationsearch=Colombia`) |
| B. A + sitemap de contraste | 3 | 3 | 1 (2 MB) + 3 |
| C. Sitemap + 1 página por vacante | 1 + 43 (filtrando `/bancolombia/`; 1 + 144 sin filtrar) | 1 + 35 | 1 + 8.944: inviable; vía listado 3 + 70 |
| D. A + páginas solo de vacantes **nuevas** (cache por `reqId`) | 2 + nuevas del tick (típ. 0-10) | igual | 3 + nuevas |

Con concurrencia 3 y 1 s de espera, A/B/D caben holgados (ADR §7.1: máx. 50 tableros/tick). C
sirve solo como backfill de tableros con hasta ~50 vacantes de Colombia. Sin `Crawl-delay`.

## 7. Diseño recomendado del conector `successfactors` (D5)

1. `atsRef` = base incl. marca (`https://empleo.grupobancolombia.com/bancolombia`).
2. Listar `{base}/search/?q=&sortColumn=referencedate&sortDirection=desc&startrow=0,25,...`;
   `complete` solo si todas las páginas 200, "Resultados a-b de N" parseable, filas == N y sin
   IDs duplicados. Sitemap opcional como segunda señal.
3. País: columna Ubicación (`..., CO`); si falta, página (`addressCountry` o sufijo de
   `streetAddress`). Sin campo -> no entra (ADR §4).
4. Fecha: microdato `datePosted` (formato `EEE MMM dd HH:mm:ss UTC yyyy`); alternativa listado
   con meses ES (`ene feb mar abr may jun jul ago sept oct nov dic`); `published_at` inmutable.
5. Cierre: 2 listados completos ausentes; la guardia `suspect` cubre sitemap/listado vacío.
6. `applyUrl` = canonical de la vacante; nunca `/talentcommunity/apply/`.
7. Parser tolerante a plantilla clásica/nueva; descripción a texto; cuerpo máx. 2 MB
   (observado ~96 KB).

## 8. Fixtures (`fixtures-successfactors/`)

`bancolombia-sitemap.trimmed.xml` (10 de 144), `sura-sitemap.empty.xml`,
`bancolombia-job-1440939300.trimmed.html`, `bancolombia-job-1438237700.trimmed.html`,
`bancolombia-job-1346872500-old-id.trimmed.html`, `bam-job-1438439000-GT.trimmed.html`,
`avianca-job-1432740833.trimmed.html`, `bancolombia-search-page{1,2}.trimmed.html`,
`avianca-search-page2.trimmed.html`, `ey-search-colombia.trimmed.html`,
`robots.bancolombia.txt`. Recortados a microdatos + título + canonical + descripción
truncada a 300 caracteres; sin cookies ni tokens CSRF. No hay fixture de RSS: está
prohibido por robots y no se pidió.

## 9. Fuentes

- Observación directa 2026-10-20 de los hosts de §5.
- SAP KBA (solo preview público; cuerpo tras login): 2253054, 2233530
  (<https://userapps.support.sap.com/sap/support/knowledge/en/2233530>), 2820583
  (<https://userapps.support.sap.com/sap/support/knowledge/en/2820583>), 2887940, 2869340.
- No hallé documentación pública de SAP sobre el marcado `JobPosting` de RMK/CSB: todo lo de
  §3 es [OBS].

## 10. Conector implementado y canario (2026-10-20)

`src/direct/ats/successfactors.ts` (`ats_type = successfactors`, `ats_ref` =
host + segmento de sitio opcional). Lee robots.txt en cada lectura, pagina
`/search/` hasta el total declarado (más de 400 → búsqueda `locationsearch=Colombia`),
pide la página de la vacante solo para ids nuevos y posiblemente colombianos
(presupuesto 25 por tablero y lectura; el resto espera la siguiente), nunca sigue
redirects. `published_at` se fija en la primera lectura (§3.4). Cierre solo por
2 listados completos ausentes (sin `postingUrl`).

Canario en vivo (`scripts/direct-canary.ts`, presupuesto de detalle 5, sin BD):

| tablero | resultado | requests | tiempo |
|---|---|---:|---:|
| `empleo.grupobancolombia.com/bancolombia` | completo · 43 · 5 leídas con detalle, 38 diferidas | 8 | 3,8 s |
| `jobs.avianca.com` | completo · 35 · 14 fuera de Colombia, 5 CO con detalle, 16 diferidas | 8 | 4,3 s |
| `careers.ey.com/ey` | completo · 70 (búsqueda Colombia; el global declara 8.944) · 5 con detalle | 10 | 9,8 s |
| `trabajaconnosotros.sura.com` | completo · 0 | 2 | 1,1 s |

Limitación conocida: la ubicación de Bancolombia es `COL, CO` y la de Avianca usa
códigos de aeropuerto (`BOG, CO`): la ciudad queda `null` (no se deduce del título).
