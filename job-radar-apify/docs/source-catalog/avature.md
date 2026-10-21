# Avature — investigación 2026-10-20

Leyenda: [DOC] oficial · [OBS] observado hoy, no garantizado · [NV] no verificado. Fixtures: `fixtures-avature/`.
UA `BuscoTrabajoBot/1.0 (+https://buscotrabajo.co)`.

## Veredicto: NO por ahora (criterio de volumen, no técnico)
- Técnicamente hay una vía ligera permitida (RSS por búsqueda, ver abajo), pero las empresas grandes con Colombia que encontré en Avature suman **4 vacantes** (Siemens). Deloitte US (`apply.deloitte.com`, Avature) devolvió 0 con "Colombia". No hay documentación oficial de Avature sobre estos feeds: todo es [OBS].
- Revisar si aparece un tenant Avature con volumen. Tenants no identificables gratis (Common Crawl CDX con 504); la búsqueda web no encontró otros. PepsiCo tiene un `sandboxpepsi.avature.net` de comunidad de talento, no tablero (catálogo previo).

## Plataforma [OBS]
- Cada tenant es un "portal" con rutas `/{locale}/{portal}/SearchJobs`, `/JobDetail/{slug?}/{id}`. Siemens: `https://jobs.siemens.com/en_US/externaljobs/...`; Deloitte US: `https://apply.deloitte.com/en_US/careers/...`.
- Sin API JSON pública. Opciones ligeras, por orden:
  1. **RSS por búsqueda** (el HTML lo anuncia con `<link rel="alternate" type="application/rss+xml">`): `.../SearchJobs/{palabra}/feed/?folderRecordsPerPage=50&`. Devuelve `<item>` con `title`, `link` (JobDetail/{slug}/{id}), `guid`, `pubDate` (fecha, 00:00 UTC), `description` (a veces el país, a veces vacío). **Sin ciudad ni descripción**.
  2. Listado HTML `SearchJobs/{palabra}?jobRecordsPerPage=N&jobOffset=M` (artículos con título, ciudad/estado/país y Job ID) y detalle HTML (`Posted since`, `Location(s)`, `Work mode`, `Company`, `Job type`).
- `SearchJobs/Colombia` es **búsqueda por palabra clave**, no filtro de país: devolvió una vacante de Ciudad de México cuyo título dice "México, Colombia & Argentina". Filtrar por la ubicación de cada artículo/detalle. Existe un filtro de país por campo (`select name="42386[]"`, opciones cargadas por AJAX): no explorado.
- Sin sitemap de vacantes: el `sitemap.xml` de Siemens trae 1 URL JobDetail; el de Deloitte llegó vacío (20 bytes). Fecha de la vacante: `pubDate` del RSS, o "Posted since" en el detalle (el detalle pesa ~1,2 MB, sin JSON-LD).
- Paginación: `jobRecordsPerPage` / `jobOffset` (6 por defecto en Siemens); el RSS acepta `folderRecordsPerPage`. Total visible en `jobListTotalRecords` ("999+" en Deloitte: tope).
- Rate limit / error: no documentados; ningún 429 visto (~15 llamadas). Vacante inexistente: [NV] no probado.

## robots.txt [OBS]
- `jobs.siemens.com`: `Allow: /externaljobs`, `Allow: /*/externaljobs`, `Disallow: /externaljobs/*qtvc=` (y equivalente en otras rutas). Sitemaps: `jobs.siemens.com/externaljobs/sitemap_index.xml`. Permite `SearchJobs`, `JobDetail` y `/feed/`.
- `apply.deloitte.com`: `Allow: /careers`, `Allow: /*/careers`, `Disallow: /careers/*qtvc=`; mismo patrón.
- **El conector nunca debe enviar el parámetro `qtvc=`** (token de sesión/seguimiento) aunque aparezca en enlaces.
- Siemens Healthineers (`jobs.siemens-healthineers.com`, mismo robots de Siemens lo lista): robots respondió 302/200 tras redirección; no se midió Colombia.
- Términos de uso de Siemens/Deloitte/Avature: [NV].

## Empresas / canarios
| Empresa | Portal | Colombia (RSS keyword "Colombia") | Detalle |
|---|---|---|---|
| Siemens | jobs.siemens.com/en_US/externaljobs | 4 ítems: 524387 (30-sep-2026, Ciudad de México, título cita Colombia), 525340 (20-oct, Bogotá), 525851 (20-oct, Bogotá), 526034 (19-oct, Bogotá) | 3 con ubicación Colombia (Bogotá), 3 vigentes; el cuarto es México. Detalle 525851: Company "Siemens S.A.S.", Work mode Hybrid, Posted since 20-Oct-2026 |
| Deloitte US | apply.deloitte.com/en_US/careers | 0 | Portal de Deloitte US; el portal de Deloitte Colombia no se identificó [NV] |
Otros mencionados por el pedido (Unilever, Bayer): Unilever usa Workday/Radancy (canario 0 en el site probado), Bayer ya está en Eightfold (seed). No usan Avature según lo visto.

## Diseño (solo si algún día vale la pena)
`atsType: "avature"`, `ats_ref = {host}/{locale}/{portal}` ; lista por RSS con las palabras "Colombia" y las ciudades principales (Bogotá, Medellín...) unidas y desduplicadas; para cada id nuevo leer el detalle (ciudad/país exactos, `Posted since`) bajo `detailBudget`. Filtro Colombia por el campo `Location(s)` del detalle. Cierre por 2 listados completos. Coste: 1 + N peticiones y ~1,2 MB por detalle.

## Fixtures (`fixtures-avature/`)
- `siemens-search-feed-colombia.xml`: RSS completo de 4 ítems.
- `siemens-searchjobs-colombia-articles.html`: los 4 artículos del listado HTML.
- `siemens-jobdetail-excerpt.html`: bloque de campos del detalle 525851 (sin tokens de sesión).
Texto descargado tratado como dato; ninguna respuesta traía instrucciones dirigidas al agente.
