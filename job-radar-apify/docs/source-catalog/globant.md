# Globant (career.globant.com) - investigacion 2026-10-20

Leyenda: [DOC] [OBS] [NV]. UA BuscoTrabajoBot/1.0.

## Veredicto

NO hay conector con listado completo demostrable. Colombia: [NV] (0 entre las 34 del sitemap, pero el sitemap no es completo).

## Hechos

- Plataforma actual [OBS]: career.globant.com es una app Next.js (no el RMK de SuccessFactors que asumia el catalogo; solo queda un asset en rmkcdn.successfactors.com).
- robots.txt (200): Disallow /search/, */page/, /?utm, /applybutton/, /talentcommunity/, /services/. Sitemap: https://career.globant.com/sitemap.xml. /job/ NO esta prohibido. /search/ (el listado) SI: queda vetado y no se evade.
- Sitemap (200): 36 URLs, 34 de /job/<Slug>/<id> (ids 78596 a 79187, creadas del 2026-04-28 al 2026-10-19); lastmod = hora de generacion. 34 vacantes para Globant parece bajo y no hay forma permitida de contrastarlo: la home no muestra total y /search/ esta vetado.
- Detalle: GET /job/<Slug>/<id> 200 SSR; sin JSON-LD; datos en el payload RSC de Next (country, location, jobReqId, createdDateTime ISO absoluta, jobTitle, jobDescription) [OBS, fragil]. Id inexistente (/job/X/99999999) -> 404 real.
- Medicion (34 detalles, 1,5 s entre requests): US 6, AR 8, VN 6, IN 4, UK 3, MX 2, CL 1, ES 1, DK 1, PH 1, BR 1, CO 0.
- Otra via: no vi RSS ni otro ATS (no busque RSS exhaustivamente ni adivine URLs).

## Conclusion

Sin sitemap completo ni listado permitido no se puede probar complete (ADR 3). Opciones: pedir a Globant un feed o permiso; o fuente parcial solo para altas (nunca cierres) si el dueno lo acepta.

## Fixtures

fixtures-globant/sitemap-head.xml, job-pages-parsed.txt
