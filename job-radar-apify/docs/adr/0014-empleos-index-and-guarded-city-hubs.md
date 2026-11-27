# ADR 0014 — Página índice `/empleos` y hubs de ciudad con guarda

**Fecha:** 2026-11-10
**Estado:** propuesto (cambio OpenSpec `seo-empleos-coverage`, sin desplegar)
**Contexto:** `openspec/changes/seo-empleos-coverage/` (proposal, design
D1–D5, requisitos SEC-001 a SEC-040).

## Problema

- `/empleos` y `/ve/empleos` responden 404. No hay página propia para la
  consulta «empleos», ni un nodo que enlace todos los hubs.
- Las ciudades con hub salen de `CITY_OPTIONS` y `COUNTRIES.VE.cities`.
  Esas listas también alimentan el filtro del dashboard, los enlaces entre
  hubs y la miga de las vacantes. Añadir una ciudad ahí cambia todas esas
  páginas, y hasta el 2026-11-26 hay mediciones abiertas sobre ellas.
- Los hubs de ciudad no tienen guarda de inventario: solo `noindex` con 0.

## Decisión

1. **Tipo de página nuevo: índice nacional.** `/empleos` (CO) y
   `/ve/empleos` (VE), canonical propio, hreflang recíproco y `x-default` a
   CO. `/empleos/` redirige 301. Lista el total real del país, las vacantes
   recientes y enlaces a los hubs existentes. No hace consultas propias: usa
   la primera página del dashboard, ya en caché desde el arranque.
2. **Hubs de ciudad con guarda**, en una lista aparte
   (`GUARDED_CITY_HUBS`). Son `kind: "ciudad"` con la plantilla de ciudad de
   siempre y una sola URL (`/empleos/<slug>`), pero:
   - indexables solo con 10 o más vacantes; por debajo, `noindex,follow`,
     fuera del sitemap y sin enlace desde `/empleos`;
   - se sirven desde la caché de intención, nunca desde la LRU del dashboard;
   - no entran en el filtro del dashboard, ni en los enlaces de los hubs
     existentes, ni en la miga de las vacantes.
3. La guarda cuenta las mismas vacantes que la página muestra (filtro de
   ciudad y país). No usa `googleReady`, para que el HTML del servidor y la
   navegación en el cliente (`/api/jobs`) den la misma lista.
4. Una ciudad entra en la lista solo con evidencia de demanda (Search
   Console o una herramienta de palabras clave) y con vacantes reales
   revisadas en una muestra de ubicaciones.

## Enmienda a una decisión anterior

`docs/SEO-IMPROVEMENT-PLAN.md` §1.17 dejó fuera los municipios satélite
(Soacha, Rionegro, etc.) por riesgo de contenido casi duplicado. Este ADR
admite Soacha y Rionegro por demanda medida, con la guarda y sin tocar los
hubs de Bogotá y Medellín. Los demás satélites siguen fuera.

## Consecuencias

- `sitemap-categories.xml` pasa a listar dos páginas índice y hasta 12 hubs
  más, según la guarda.
- El keeper de totales hace 12 consultas más cada 3 h, en serie.
- La caché de intención crece en 12 entradas de 60 filas.
- Los hubs con guarda no reciben enlaces desde hubs existentes ni desde
  vacantes hasta una fase posterior al 2026-11-26.

## Rollback

`EMPLEOS_COVERAGE_ENABLED=false`: `/empleos` y `/ve/empleos` responden 404,
los hubs con guarda 410, y ninguno aparece en el sitemap. Para retirar una
sola ciudad se borra su entrada de `GUARDED_CITY_HUBS`.

## Enmienda (2026-11-27): segunda ola de hubs con guarda verificados por solapamiento

Auditoría en producción (`2026-11-27`) sobre inventarios activos y solapamiento Top-40 entre hubs vecinos:

- **Añadidos a `GUARDED_CITY_HUBS` (4):** `Chía` (`CO`, 228 vacantes, 0 % de solapamiento con Bogotá), `Sincelejo` (`CO`, 34 vacantes, 0 % con Bogotá), `Anzoátegui` (`VE`, 136 vacantes, 10 % con Lechería y 0 % con Caracas) y `San Cristóbal` (`VE`, 39 vacantes, 0 % con Caracas; demanda 1,3 K–5,5 K). `Palmira` ya existe en `COUNTRIES.CO.cities` como hub activo sin guarda. `INTENT_PAGE_CACHE_ENTRIES` escala automáticamente con `GUARDED_CITY_HUBS.length`.
- **Diferidos por riesgo doorway:** los satélites del Valle de Aburrá `Itagüí` (392), `Envigado` (340) y `Bello` (344) presentan **55,0 %–62,5 %** de vacantes compartidas en Top-40 entre sí, por lo que permanecen fuera hasta separar listados multipunto.
- `/empleos/puerto-ordaz` se mantiene como **404** (requisito `SIW-020/052`); «Puerto Ordaz» sigue cubierto dentro de `/empleos/ciudad-guayana` vía `CITY_HUB_LOCATION_ALIASES`.
