# Grafo de enlaces de las páginas de vacante — 2026-10-29

## Por qué

Search Console (propiedad `sc-domain:buscotrabajo.co`, leída el 2026-10-29):

| Señal | Valor |
|---|---|
| Páginas indexadas | 569 |
| Rastreadas, sin indexar | 9.745 |
| Descubiertas, sin indexar | 7.095 |
| 404 / Soft 404 / noindex | 8.114 / 2.678 / 1.446 |
| Ofertas de trabajo válidas (mejoras) | 5 |
| Impresiones 30 sep–27 oct vs 2–29 sep | 2.895 vs 1.292 (posición 9,3 vs 11,7) |
| Apariciones «Detalles de empleos» (90 d) | 1.540 impresiones, posición 3,8 |

Hubs de ciudad con impresiones pero en página 2 (90 d): Caracas 29,1 ·
Santa Marta 22,8 · Neiva 16,4 · Ibagué 13,1 · Armenia 12,4.

Muestra de 12 URLs del `sitemap-jobs.xml`: 12/12 con `JobPosting` y sin
`noindex`. El marcado no es el cuello de botella: Google solo lo procesa en
páginas que indexa. Pero el HTML inicial de cada vacante tenía **exactamente
2 enlaces, ambos a la fuente** y ningún enlace interno; tras hidratar, solo
el menú genérico y la empresa. Las vacantes eran callejones sin salida que
no devolvían autoridad a los hubs que sí queremos posicionar.

## Qué cambia

- Ruta de navegación en el HTML inicial: `Inicio › Empleos en <ciudad> › vacante`,
  con `BreadcrumbList` equivalente.
- Sección «Más empleos en <ciudad>»: hasta 6 vacantes hermanas del mismo hub,
  con un desplazamiento estable por hash del id para repartir enlaces
  (no las 6 más nuevas en todas las páginas), y enlace al hub.
- React muestra lo mismo: la píldora «volver» apunta al hub de la ciudad
  cuando no hay origen, y el bloque de relacionadas va bajo la tarjeta.

## Invariantes protegidos

- **Sin consulta extra a Postgres en la respuesta.** Las hermanas salen de
  `peekJobsPage()`, la misma entrada de caché (`cityHubFilters` + límite 60 +
  offset 0 + sin detalles) que ya usa `/empleos/<ciudad>`. Caché fría → solo
  el enlace al hub, y la carga se calienta en segundo plano (una por ciudad).
- El hub se resuelve con el mismo plegado que el predicado SQL de ciudad y
  solo entre ciudades del país de la vacante; una prueba comprueba que el hub
  enlazado realmente lista la vacante.
- `JobPosting`, robots, canonical, sitemap y diseño sin cambios.
- Sin enlace a hubs de rol en v1: el emparejamiento por rol es difuso.

## Cómo medir (checkpoints)

- 2026-11-12 y 2026-11-26: indexadas (base 569), «rastreadas, sin indexar»
  (base 9.745), posición de los hubs de Caracas/Santa Marta/Neiva/Ibagué/Armenia,
  ítems válidos de Ofertas de trabajo (base 5).
- Inmediato tras despliegue: repetir la muestra de 12 URLs contando enlaces
  internos en el HTML crudo (base 0).

Esto no garantiza ranking. Es la condición para que la autoridad fluya entre
vacantes y hubs; la siguiente fase es dar contenido propio a los hubs.
