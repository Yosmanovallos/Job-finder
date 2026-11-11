# Spec — cobertura base de empleos

## Hubs de ciudad con guarda

- **SEC-001** Cada ciudad de la lista con guarda responde 200 en
  `/empleos/<slug>` con el título, H1 y meta de un hub de ciudad.
- **SEC-002** Una ciudad con guarda no tiene versión `/ve/empleos/<slug>`
  distinta: sigue la regla de los hubs de ciudad (una sola URL canónica).
- **SEC-003** Ningún slug con guarda coincide con una ciudad existente, un
  rol, una intención o un rol retirado.
- **SEC-004** Un slug que no está en ninguna lista sigue respondiendo 404.
- **SEC-010** Con menos de 10 vacantes aptas para Google, el hub responde
  200 con `noindex,follow`.
- **SEC-011** Con 10 o más, el hub es indexable y su canonical es su propia
  URL.
- **SEC-012** `sitemap-categories.xml` solo lista los hubs con guarda que
  tienen 10 o más. Si un conteo falla, responde 503 sin caché.
- **SEC-013** `/empleos` solo enlaza un hub con guarda cuyo último total
  conocido es 10 o más. Total desconocido: sin enlace.

## Página índice

- **SEC-020** `/empleos` responde 200 con canonical `/empleos`, y
  `/ve/empleos` con canonical `/ve/empleos`.
- **SEC-021** Las dos llevan hreflang recíproco `es-CO` / `es-VE` y
  `x-default` a la de Colombia.
- **SEC-022** El número de vacantes que se muestra es el total real del
  país. Si no se puede obtener, no aparece ningún número.
- **SEC-023** La página enlaza todos los hubs de ciudad existentes de su
  país, las páginas de intención indexables y los hubs de cargo.
- **SEC-024** El HTML del servidor trae `BreadcrumbList` e `ItemList`; cada
  elemento de la lista es una vacante enlazada en la página.
- **SEC-025** `/empleos/` redirige 301 a `/empleos`.
- **SEC-026** El primer render del cliente coincide con el del servidor.

## Sin regresiones

- **SEC-030** El HTML de los hubs existentes y de las páginas de vacante es
  idéntico al de antes del cambio.
- **SEC-031** El filtro de ciudad del dashboard ofrece las mismas opciones.

## Rollback

- **SEC-040** Con `EMPLEOS_COVERAGE_ENABLED=false`, `/empleos` y
  `/ve/empleos` responden 404, los hubs con guarda 410, y ninguno aparece en
  el sitemap.
