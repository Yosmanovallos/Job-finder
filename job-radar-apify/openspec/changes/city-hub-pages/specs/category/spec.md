# Requirements

- CITY-001: a city page title/H1 is "Empleos en <ciudad>: trabajo y ofertas
  de empleo"; the remote bucket is "Trabajos remotos en <país>: empleos y
  ofertas de empleo". Role pages are unchanged.
- CITY-002: SSR and the hydrated page render the same H2 before the job
  list when it has rows, and the same related-cities H2 section.
- CITY-003: related links point only to other city pages of the same
  country that resolveCategorySlug() resolves; never the page itself, never
  "Remoto", never across CO/VE; role pages get none.
- CITY-004: counts, canonical, JSON-LD, robots and hreflang are unchanged.
