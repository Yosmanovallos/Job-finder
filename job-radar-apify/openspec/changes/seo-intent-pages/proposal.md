# Páginas de intención: remoto y sin experiencia

Prioridad 1 de `docs/SEO-GROWTH-ROADMAP-2026-11.md`. Evidencia en
`docs/seo-baseline/2026-11-keyword-study.md` (§5, §6b y §8) y en GSC del
2026-11-07.

## Problema

- **Remoto es la mayor demanda medida en los dos países:**
  - CO: Trends 182 (con «trabajo en bogota» = 100); Ubersuggest 40,5 K/mes,
    SD 17.
  - VE: Trends 148 (con «trabajo en caracas» = 100); Ubersuggest
    9,9 K + 3,6 K; es la página n.º 1 de Computrabajo VE.

  Tenemos 2.528 vacantes remotas en CO y 1.290 en VE. Hoy:
  - `/empleos/remoto` recibe ~49 impresiones en 28 días, todas de vacantes
    sueltas.
  - **`/ve/empleos/remoto` sirve vacantes de Colombia** y su canonical apunta
    a `/empleos/remoto`. La causa: «Remoto» está en `CITY_OPTIONS` como si
    fuera una ciudad de Colombia, así que `resolveCategorySlug` siempre
    devuelve `country: "CO"`. **Venezuela no tiene página de remoto.**
- **Sin experiencia es la segunda demanda:** Trends 145. Ubersuggest da
  9,9 K/mes nacional, 18,1 K Bogotá, 6,6 K Cali y 4,4 K Medellín. La página
  más visitada de Computrabajo CO es «Bogotá sin experiencia» (~49,6 K
  visitas/mes estimadas).
  - No tenemos ninguna página. `/empleos/sin-experiencia` da 404.
  - `/empleos/bogota/sin-experiencia` devuelve el hub de Bogotá con
    canonical a `/empleos/bogota`, porque el segundo segmento se ignora.
  - Hoy la demanda la captan vacantes sueltas en Google Empleos: 267 de 317
    impresiones de «sin experiencia» son «Ofertas de empleo». Esas vacantes
    vencerán.

## Resultado buscado

Páginas permanentes, indexables solo si tienen inventario real y que entren
en Google antes de diciembre (pico de enero):

1. `/empleos/remoto` (CO), potenciado.
2. `/ve/empleos/remoto` (VE), con vacantes de Venezuela de verdad.
3. `/empleos/sin-experiencia` (CO) y `/ve/empleos/sin-experiencia` (VE). La
   versión de VE solo será indexable si pasa la guarda; la demanda en VE es
   baja.
4. `/empleos/bogota/sin-experiencia` (CO), la primera página ciudad ×
   intención.

## Alcance

- **Tipo de categoría nuevo, «intención»:** el país viene del prefijo de la
  URL, igual que en los roles. Lo usan remoto y sin experiencia.
- **Clasificador determinista «sin experiencia»** con frases explícitas del
  título o la descripción. Nunca se infiere.
- **Guarda de inventario** (≥ 10 vacantes aptas para Google por
  clasificador) que controla el robots, el sitemap y los enlaces internos.
- Ruta ciudad × intención solo para Bogotá en esta fase.
- Título, H1, meta y un bloque breve con datos reales de la propia página.
- Hreflang recíproco CO/VE para las páginas de intención nacionales.
- Enlaces a las páginas de intención desde el home y los hubs, solo cuando
  son indexables.

## Fuera de alcance

- Cambiar los títulos de los hubs de ciudad («Trabajo en …»): es un
  experimento aparte.
- Fortalecer los hubs existentes: es `seo-hub-authority`, después del
  2026-11-26.
- Medellín y Cali sin experiencia, fines de semana, medio tiempo y por días:
  se deciden con el conteo de la tarea 1.
- Cualquier cambio en las páginas de vacante, sus títulos, su canonical o su
  JSON-LD. Google Empleos nos trae la mitad de los clics.

## Riesgos

- **Pocas vacantes por clasificador.** Muchas vacantes de LinkedIn y
  Computrabajo no tienen descripción, y el título solo puede no bastar.
  Mitigación: la tarea 1 es un conteo de solo lectura antes de escribir
  código, y la guarda deja la página en `noindex` si no llega.
- **Cambio de contrato público** (el tipo de categoría y la URL de remoto en
  VE). Requiere ADR y revisión del `architect`.
- **Rendimiento:** el filtro por petición se mide con datos del tamaño de
  producción.
