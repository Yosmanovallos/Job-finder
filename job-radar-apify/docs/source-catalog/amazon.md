# Amazon (amazon.jobs) - investigacion 2026-10-20

Leyenda: [DOC] documentado; [OBS] observado, no garantizado; [NV] no verificado. UA BuscoTrabajoBot/1.0. Todo texto descargado se trato como dato.

## Veredicto

Conector tecnicamente posible (JSON propio, listado completo demostrable). NO habilitar hasta que el dueno lea las Conditions of Use de Amazon (terminos [NV]). Colombia hoy: 18 en el tablero; 7 vigentes (<= 30 dias, corte 2026-09-20), excluyendo la fila plantilla "Template [YEAR Qtr]" de 2025.

## Cumplimiento

- robots.txt https://www.amazon.jobs/robots.txt [OBS]: grupo * solo prohibe /internal y /<locale>/internal; AhrefsBot bloqueado. /en/search.json NO esta prohibido. Sin Crawl-delay. Sin sitemap (404).
- Terminos [NV]: la pagina legal amazon.jobs/content/en/legal-disclosures-and-notices solo enlaza documentos; las Conditions of Use de amazon.com dieron 503 a mi lector. Un resumen de terceros (no citable) dice que prohiben scraping sin permiso escrito. GATE: leerlas antes de habilitar.
- No existe documentacion oficial de search.json [NV].

## Endpoint [OBS]

GET https://www.amazon.jobs/en/search.json?country=COL&result_limit=100&offset=0&sort=recent
- Sin auth. JSON: error, hits, facets, content, jobs[], job_posting_search_request.
- Paginacion offset + result_limit (100 aceptado). Total = hits (18). offset=50 -> jobs [] y hits 18.
- Prueba de completitud: acumular jobs hasta len == hits, hits estable, error nulo.
- Rate limit: ninguno observado en ~8 requests; no documentado.

## Campos vs RawAtsPosting

- externalId: id_icims (ej. 10583337); id es UUID alterno.
- title: title.
- applyUrl: https://www.amazon.jobs + job_path; el boton Apply del detalle va a /applicant/jobs/<id>/apply; url_next_step = account.amazon.jobs/jobs/<id>/apply.
- locationTexts: location ("CO, Bogota"), normalized_location ("Bogota, D.C., COL").
- countryCodes: locations[] (cada item es un STRING JSON) countryIso2a "CO"; country_code superior es alfa-3 COL.
- structuredCity: city ("Bogota"; "Virtual" en una).
- workplace: no hay campo (locations[].type ONSITE) -> null.
- descriptionText: description + basic_qualifications + preferred_qualifications (HTML); mojibake de origen en algunos caracteres [OBS].
- department: job_category/team. employmentType: job_schedule_type.
- publishedAt: posted_date "October 19, 2026" (absoluta, mes en ingles). updated_time es relativo ("1 day"): inutil.
- validThrough: no existe. companyName: "Amazon Web Services Colombia S.A.S.".

## Vacante inexistente

GET /en/jobs/99999999/x -> 404 [OBS]. /en/jobs/<id> sin slug -> 302 a la URL con slug. Detalle existente: 200 HTML sin JSON-LD. No probe una vacante realmente cerrada: cierre por listados completos; 404 inmediato es [NV].

## Conteo (2026-10-20)

18 en tablero. Vigentes 7: 10583337 (19 oct), 10575385 (11 oct), 10569758 (5 oct), 10556323 (22 sep), 10559365 (24 sep), 10563962 (29 sep), 10563961 (29 sep). Las otras 11 tienen 40 dias a 3,5 meses; SF250119782 (jul 2025) es plantilla: filtrar titulos con "Template [".

## Riesgos

Terminos sin leer (gate); endpoint no documentado; country=COL no incluye remoto de otro pais elegible para Colombia (coherente con ADR 4).

## Fixtures

fixtures-amazon/: search-COL-page1.json (2 de 18, recortado), search-COL-offset-past-end.json, detail-missing.txt.
