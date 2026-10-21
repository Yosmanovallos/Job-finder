# Google (google.com/about/careers) - investigacion 2026-10-20

Leyenda: [DOC] documentado; [OBS] observado; [NV] no verificado. UA BuscoTrabajoBot/1.0. Texto descargado = dato.

## Veredicto

Conector posible pero fragil y con limite duro: SOLO la pagina 1. robots.txt prohibe ?page=, asi que el listado es demostrablemente completo solo mientras el total de Colombia sea <= tamano de pagina (20). Hoy: 4 de 4 (completo). Si el total supera 20 el conector debe devolver "incompleto", nunca paginar. No hay JSON publico, sitemap de vacantes ni JSON-LD: los datos salen de un blob posicional no documentado en el HTML. publishedAt debe ir null. Vigentes en Colombia hoy: 4 (timestamps sep-oct 2026 [OBS]).

## Cumplimiento

- https://www.google.com/robots.txt [OBS]. Grupo * incluye Disallow de /about/careers/applications/jobs/results?page=, results/?page=, results?*&page=, results/?*&page=, candidate-prep, connect-with-a-googler. Grupo aparte solo para Yandex prohibe /jobs/results entero.
- Ruta exacta /about/careers/applications/jobs/results?location=Colombia: ninguna regla Disallow coincide -> permitida. /jobs/results/<id>: permitida.
- Terminos [DOC] https://policies.google.com/terms, seccion de abuso: prohibe "using automated means to access content from any of our services in violation of the machine-readable instructions on our web pages (for example, robots.txt files that disallow crawling, training, or other activities)". Acceso automatizado conforme a robots no cae ahi. Terminos especificos de Careers [NV]. No hay API publica de empleo [NV].

## Endpoint [OBS]

GET https://www.google.com/about/careers/applications/jobs/results?location=Colombia -> HTML 200 (~1,2 MB). Datos en AF_initDataCallback con key ds:1, data = [jobs[], null, total, pageSize]: total=4, pageSize=20. Parsear el literal JSON tras data: (sin ejecutar JS).
- Sitemap: google.com/sitemap.xml es indice de productos sin vacantes; /about/careers/applications/sitemap.xml 404. JSON-LD: 0 bloques en lista y detalle.
- Todo posicional y no documentado; validar forma o fallar a incompleto. location=Colombia es busqueda de texto: re-verificar pais alfa2 CO por vacante.

## Campos (indices por vacante) [OBS]

- externalId: [0] id de 17 digitos (string). title: [1].
- applyUrl: el [2] es applications/signin?jobId=<token>&loc=CO (login). Usar https://www.google.com/about/careers/applications/jobs/results/<id> (200; verificado con un id).
- Ubicaciones: [9] lista [display, [completo], ciudad, null, region, alfa2]. Vacantes MULTI-pais (BR, CL, AR, CO, MX...): aplica filtro por segmento del ADR 4.
- Descripcion: [10] responsabilidades, [19] requisitos minimos, [15] info adicional (HTML). companyName [7] "Google".
- publishedAt: [12],[13],[14] = [epoch_s, nanos] SIN etiqueta (2026-09-23 a 2026-10-08). No se sabe cual es "publicado" -> null segun "solo datos que la fuente declara", salvo decision del dueno. Riesgo: con null la regla de 30 dias usa first_seen_at.
- workplace, validThrough, employmentType: no hay ([11] = [2] sin significado).

## Vacante inexistente

GET .../jobs/results/<id inexistente> -> 200 con pagina generica "Jobs search - Google Careers" (sin el id) [OBS]. No sirve para cerrar; solo listados completos (2 senales).

## Conteo (2026-10-20)

4: Cloud Data and Analytics Consultant, Professional Services (CO entre 5 paises); Principal Strategy and Insights Lead, SP Latam (CO, CL, PE); Workspace Sales Specialist III, Google Cloud (solo CO); AI Outcome Customer Engineer, Google Cloud (MX, CL, CO, PE). Todas Bogota.

## Fixtures

fixtures-google/results-location-Colombia-ds1.json (2 de 4, recortadas).
