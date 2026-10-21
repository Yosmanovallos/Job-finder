# Meta (metacareers.com) - investigacion 2026-10-20

Leyenda: [DOC] [OBS] [NV]. UA BuscoTrabajoBot/1.0.

## Veredicto

NO. El robots.txt de metacareers.com abre con el aviso "Collection of data on Facebook through automated means is prohibited unless you have express written permission from Facebook" y enlaza http://www.facebook.com/apps/site_scraping_tos_terms.php. Esa pagina [DOC] dice: "You will not engage in Automated Data Collection without first obtaining Meta's express written permission" (aceptar los Terms no cuenta como permiso; se pide por separado) y define el termino incluyendo scrapers, bots, crawlers, user-agents. Es una clausula de terminos, no solo una regla de robots. Sin permiso escrito de Meta no hay conector. Vacantes en Colombia: [NV] (no se conto a proposito).

## Hechos tecnicos (para el caso de que Meta autorice)

- robots.txt (200): grupo * prohibe /*cursor=, /ajax/, /*.php, /login/, /resume/ etc.; no prohibe /profile/job_details/ ni /jobsearch/sitemap.xml.
- Sitemap https://www.metacareers.com/jobsearch/sitemap.xml (200): 1.235 URLs /profile/job_details/<id>/; lastmod identico en todas (2026-10-20T14:14:14-07:00) -> inutil como senal. El sitemap NO trae pais: para hallar Colombia habria que leer 1.235 detalles (~350 KB cada uno, ~430 MB). El otro sitemap (.xml.gz del robots) dio 403.
- Detalle: JSON-LD JobPosting con title, description, datePosted (ej. 2026-10-02T14:50:28-07:00), jobLocation[] con addressCountry, employmentType, directApply, identifier, hiringOrganization. O sea el metodo tecnico seria sitemap + JSON-LD, pero cuesta N requests.
- Plataforma de busqueda: GraphQL interno bajo /api o similar: no investigado (cae bajo la misma prohibicion).

## Divulgacion

Antes de leer la pagina de terminos hice 3 requests a metacareers.com: sitemap de jobsearch, el .gz (403) y UN detalle de vacante (no colombiana) para ver el JSON-LD. No se hicieron mas.

## Fixtures

fixtures-meta/job_details-jsonld.json (un JSON-LD recortado), sitemap-head.xml.
