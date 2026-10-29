# Cifras propias en los hubs de ciudad

Fecha: 2026-10-29. Rama `codex/city-hub-stats`, apilada sobre
`codex/jobposting-coverage` (PR #83, que añade `peekJobsPage` y los enlaces
vacante → hub).

Search Console (90 días, `docs/seo-baseline/2026-10-24-measurement-baseline.md`):
los hubs de ciudad reciben impresiones en página 2–3 (Caracas 28,6, Santa Marta
22,8, Neiva 16,7, Ibagué 13,2, Armenia 12,4). Las consultas son "empleos <ciudad>",
"trabajo(s) en <ciudad>" y "ofertas de empleo en <ciudad>". Los portales grandes
no publican cifras propias de cada ciudad. Estas páginas solo tenían un resumen
mínimo.

Entrega:
- `buildCategoryInsights` (ampliado, no duplicado) calcula, desde la misma página
  en caché y sin consultas nuevas:
  - activas en 30 días (= total, porque `MAX_JOB_AGE_DAYS` = 30);
  - nuevas en 7 días, con "60+" cuando la muestra limitada solo prueba un mínimo;
  - empresas que más contratan, con su conteo y sin marcadores "Confidencial";
  - cargos más pedidos del catálogo (≥ 2 coincidencias, el mismo comparador que
    la página de rol), enlazados a su hub de rol;
  - rango de salario solo con números publicados con moneda (≥ 3 vacantes, una
    sola moneda, nunca se interpreta texto libre).
- Una sección `data-category-stats` con el mismo texto en el SSR y en React.
- La meta descripción de las ciudades abre con "¿Buscas trabajo en X?" y mantiene
  "vacantes y ofertas de empleo" (≤ 160 caracteres para todas). Los títulos no
  cambian: `city-hub-pages` acaba de fijarlos y su seguimiento en GSC sigue
  abierto.
- Home: `getHomeCityDiscovery` enlaza también Santa Marta, Valledupar,
  Villavicencio y Palmira (CO), y Maracay y Valencia (VE), ordenados por
  impresiones. La línea base suma 23 URL `/empleos/<ciudad|rol>` con impresiones,
  pero solo detalla las ciudades. Sin las filas de los hubs de rol no se eligen
  cargos para el home. Queda como hueco abierto, y los hubs de ciudad enlazan sus
  cargos reales.
- `queryJobsPage` expone `salaryMin`, `salaryMax` y `salaryCurrency`, que ya
  seleccionaba, con la misma regla que `buildSalaryLabel`. `maskLockedFields`
  también los oculta. La API pública ya declaraba esos campos y antes los
  devolvía siempre `null` en las búsquedas.

Fuera de alcance: rediseño del home, consultas nuevas, cambios de caché, hubs de
rol con cifras propias y nuevas URL.
