# Apple (jobs.apple.com) - investigacion 2026-10-20

Leyenda: [DOC] [OBS] [NV]. UA BuscoTrabajoBot/1.0.

## Veredicto

NO hay conector viable demostrado; vacantes en Colombia: [NV] (no es lo mismo que 0).

## Hechos

- robots.txt: https://jobs.apple.com/robots.txt responde 301 a https://www.apple.com/pagenotfound (404). Segun RFC 9309 un 4xx = no disponible = todo permitido [OBS]. Terminos: [NV].
- Sitemaps [OBS]: https://jobs.apple.com/sitemap/sitemap-index.xml (200) lista 74 sitemaps sitemap-jobs-<locale>.xml (en-us, es-mx, pt-br, ...) con URLs /<locale>/details/<id>/<slug>. NO hay sitemap de Colombia; es-mx y en-br traen 4 URLs cada uno.
- Busqueda: https://jobs.apple.com/en-us/search?location=<slug> devuelve HTML con window.__staticRouterHydrationData (searchResults, totalRecords). Control: location=united-states-USA resuelve (filters.locations con postLocation-USA, totalRecords 4401). location=colombia-COL NO resuelve (filters.locations [], totalRecords 0); tampoco mexico-MEX (0, pese a que hay vacantes MX en el sitemap es-mx). Conclusion: el slug de Colombia no se pudo resolver, asi que el 0 NO es evidencia. El HTML solo expone codigos postLocation de EE.UU.
- Apple publica una API interna (api/role/search) no documentada: no la use; sin documentacion ni permiso expreso queda fuera.
- JSON-LD en detalle: no verificado.

## Siguiente paso sugerido

Humano: abrir el selector de ubicacion de jobs.apple.com y ver si existe Colombia. Si no existe, queda cerrado con 0 honesto.

## Fixtures

fixtures-apple/search-colombia-COL.txt
