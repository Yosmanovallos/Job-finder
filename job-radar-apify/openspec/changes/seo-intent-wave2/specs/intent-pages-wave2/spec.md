# Requisitos — segunda ola de intención

IDs SIW-xxx. Cada uno tiene al menos un escenario y una prueba en
`tests/validate-intent-wave2.test.ts` (unitario, reloj fijo) o en
`test:seo` (render por HTTP). Los requisitos SIP-xxx de `seo-intent-pages`
siguen vigentes para todas las páginas de intención, nuevas incluidas.

## Ciudad × intención

- **SIW-001:** `/empleos/medellin/sin-experiencia` y
  `/empleos/cali/sin-experiencia` resuelven como ciudad × intención (CO),
  con canonical propio y sin hreflang.
  - Escenario: todas las vacantes listadas son de esa ciudad y pasan el
    clasificador D3 de `seo-intent-pages`.
- **SIW-002:** cualquier otro `/empleos/<ciudad>/<x>` conserva el
  comportamiento de hoy (SIP-003).
  - Escenario: `/empleos/medellin/fines-de-semana` → hub de Medellín con
    canonical a `/empleos/medellin`.

## Intenciones de jornada

- **SIW-010:** cuentan solo las frases explícitas que D2 aprobó, por
  palabra completa y sin tildes, en el campo que D2 aprobó (título; la
  descripción solo con frases estrictas aprobadas).
  - Positivos: «Mesero fines de semana», «Auxiliar de tienda medio tiempo»,
    «Cajero part-time», una vacante con `employment_type = 'Medio tiempo'`.
  - Negativos: «Asesor comercial» cuya descripción dice «disponibilidad
    para laborar fines de semana y festivos»; «Analista, lunes a viernes,
    fines de semana libres»; «Mensajero tiempo completo».
- **SIW-011:** la clasificación SQL y la de memoria dan el mismo resultado
  sobre el fixture compartido.
- **SIW-012:** cada intención tiene su propio filtro, copia, etiqueta de
  enlace y texto de respuesta. Ninguna toma los de otra.
  - Escenario: `intentFilters` de `fines-de-semana` no lleva `experience` ni
    `modality`; su title no dice «sin experiencia».
- **SIW-013:** el filtro `schedule` solo se acepta desde `intentFilters`.
  `/api/jobs?schedule=…` y `/api/v1/jobs?schedule=…` lo ignoran.

## Países

- **SIW-020:** una intención solo resuelve en los países de su lista
  blanca (D3).
  - Escenario: sin VE en la lista, `/ve/empleos/fines-de-semana` → 404.
- **SIW-021:** `listIntentCategories()` no incluye versiones fuera de la
  lista blanca. El sitemap, el keeper y los hubs no las ven.
- **SIW-022:** una intención nacional sin versión hermana no emite
  hreflang.

## Guarda, sitemap, enlaces y keeper

- **SIW-030:** las páginas nuevas cumplen SIP-020 a SIP-022: indexables
  solo con ≥ 10 aptas; si no, `noindex,follow`, fuera del sitemap y sin
  enlaces.
- **SIW-031:** el keeper de conteos (#124) recarga todas las páginas de
  `listIntentCategories()`, nuevas incluidas, en serie.
- **SIW-032:** los hubs de ciudad enlazan las páginas nuevas de su país y
  su ciudad solo cuando el último conteo conocido es ≥ 10. Nunca disparan
  una consulta de intención.
  - Escenario: el hub de Medellín enlaza «Trabajo sin experiencia en
    Medellín» con conteo 33 y no la enlaza sin conteo conocido.
- **SIW-033:** `sitemap-categories.xml` usa el conteo conocido y solo
  consulta, en serie, las páginas sin conteo. Un fallo da 503 `no-store`.
- **SIW-034:** `intentPageCache` tiene al menos tantas entradas como
  páginas de intención.

## Contenido

- **SIW-040:** title, H1 y meta siguen el design D4. El conteo del título
  es el `total` real y solo aparece desde 10. La meta tiene 150–160
  caracteres.
- **SIW-041:** el bloque de respuesta de las páginas nuevas aparece en el
  HTML del servidor y es idéntico tras la hidratación (SIP-031).

## Ciudad Guayana y Puerto Ordaz

- **SIW-050:** `/empleos/ciudad-guayana` lista las vacantes cuya ubicación
  dice «Ciudad Guayana» o «Puerto Ordaz», en SQL y en memoria
  (`hubMatcher`), con el mismo resultado.
- **SIW-051:** su title y H1 nombran Ciudad Guayana y Puerto Ordaz; el
  canonical sigue siendo `/empleos/ciudad-guayana`.
- **SIW-052:** ningún otro hub cambia su filtro, title, H1 ni meta. No
  existe `/empleos/puerto-ordaz` (404). La lista de ciudades de VE, las
  migas de las vacantes y las opciones del dashboard no cambian.
- **SIW-053:** sin la entrada de `CITY_HUB_LOCATION_ALIASES`, el hub vuelve
  al filtro, title y meta de hoy (rollback en una línea; design D6).
  Cubierto por SIW-052: los hubs sin alias se comportan como hoy.

## No regresión

- **SIW-060:** el drift local de la portada, `/ve`, `/dashboard`, los hubs
  de Bogotá, Medellín, Cali y Caracas, `/empleos/remoto`,
  `/ve/empleos/project-manager` y una vacante no cambia en title, meta,
  canonical, robots, hreflang, H1 ni JSON-LD. Excepciones documentadas:
  las URL nuevas; el bloque «Búsquedas populares» de los hubs cuando la
  página nueva es indexable; el hub de Ciudad Guayana (SIW-051); y las
  vacantes relacionadas de las vacantes de Ciudad Guayana (D6).
- **SIW-061:** TTFB en frío de los hubs y del dashboard dentro de ±10 %
  frente a `main`.
- **SIW-062:** benchmark con 3.000 filas: < 10 ms por petición SSR de una
  página nueva, sin objetos pesados por fila, y RSS estable tras 500
  peticiones.
