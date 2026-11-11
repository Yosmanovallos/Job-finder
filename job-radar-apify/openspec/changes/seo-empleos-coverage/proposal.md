# Propuesta — cobertura base: página nacional `/empleos` y hubs de ciudad que faltan

Fecha: 2026-11-10. Fase 1 del plan acordado el 2026-11-10 (lectura de
Search Console, GA4 y Ubersuggest). Rama `codex/seo-empleos-coverage`.

## Problema

1. **No existe página para «empleos».** `/empleos` y `/ve/empleos` responden
   404. Es la consulta genérica con más demanda estimada (Ubersuggest:
   «empleos» 60,5 K/mes en Colombia). En Search Console (28 días hasta el
   2026-11-08) «empleos» tiene 38 impresiones en posición 11,7, y las
   reciben vacantes sueltas, no una página propia.
2. **Faltan ciudades con demanda y con vacantes.** `sitemap-categories.xml`
   tiene 26 hubs de ciudad. Hay consultas reales en Search Console para
   ciudades sin hub («vacantes barrancabermeja» 35 impresiones, «empleo
   barrancabermeja» 29, «empleos en maturin» 14, «trabajo lecheria» 19,
   «empleo yopal» 7, «empleo facatativa» 9) y esas URL responden 404.
3. Todos los hubs juntos suman 21 clics y 1,28 mil impresiones en 28 días
   (posición media 16,8). Computrabajo posiciona 202 mil palabras clave;
   nosotros publicamos 100 URL de categoría.

## Evidencia (medida el 2026-11-10)

Inventario: `total` de `GET /api/jobs?cities=<ciudad>&country=<país>` en
producción. Es el total público, **no** el de vacantes aptas para Google; la
guarda usa el segundo y decide en producción.

| Ciudad | País | Vacantes | Demanda |
|---|---|---|---|
| Barrancabermeja | CO | 60 | GSC 94 impresiones en 4 consultas; Ubersuggest 2,9 K |
| Yopal | CO | 51 | GSC 14; Ubersuggest 1,6 K |
| Rionegro | CO | 202 | Ubersuggest 1,9 K + 880 («rionegro antioquia») |
| Soacha | CO | 141 | Ubersuggest 2,4 K |
| Zipaquirá | CO | 51 | Ubersuggest 1,6 K |
| Tocancipá | CO | 62 | Ubersuggest 1,6 K |
| Facatativá | CO | 57 | GSC 9 |
| Apartadó | CO | 35 | Ubersuggest 1 K |
| Quibdó | CO | 19 | Ubersuggest 880 |
| Fusagasugá | CO | 17 | Ubersuggest 2,4 K |
| Maturín | VE | 28 | GSC 55 en 5 consultas; Ubersuggest 2,9 K |
| Lechería | VE | 17 | GSC 19 |

Las cifras de Ubersuggest son estimaciones de un tercero y solo ordenan
prioridades. Las ubicaciones de cada ciudad se revisaron en una muestra de
100 vacantes: no hay coincidencias falsas con otros lugares.

Quedan fuera por falta de dato de demanda, aunque tienen vacantes:
Sincelejo, Riohacha, Florencia, Buenaventura, Tuluá, Dosquebradas, Girardot,
Cartago, Sogamoso, Duitama, Envigado, Itagüí, Bello y Chía.

## Qué cambia

1. **`/empleos` (Colombia) y `/ve/empleos` (Venezuela):** página índice con
   el total real de vacantes, las vacantes más recientes y enlaces a todos
   los hubs de ciudad, cargo e intención que existen.
2. **12 hubs de ciudad nuevos, con guarda:** indexables solo con 10 o más
   vacantes aptas para Google. Por debajo: `noindex,follow`, fuera del
   sitemap y sin enlaces.

## Qué no cambia

- Las páginas de vacante: ni título, ni canonical, ni migas.
- Los hubs existentes: su HTML no cambia, para no contaminar las lecturas
  abiertas del 2026-11-26 (`city-hub-pages`, `city-hub-stats`,
  `job-link-graph`, `home-role-hubs`).
- El filtro de ciudad del dashboard (`CITY_OPTIONS`) y la lista de roles
  (`DEFAULT_ROLES_200`, que además siembra el scraping).
- La API pública, MCP, A2A y WebMCP.

## Fuera de alcance (fases siguientes)

- **Hubs de profesión nuevos** (abogado, arquitecto, analista de datos,
  trabajo social, fisioterapeuta): la lista de roles alimenta el scraping,
  así que necesitan una lista propia de hubs y su clasificador. Cambio
  aparte.
- Miga `/empleos` en los hubs existentes y enlaces desde ellos a los hubs
  nuevos: después del 2026-11-26.
- Hubs por estado de Venezuela (Anzoátegui, Nueva Esparta, Carabobo).

## Decisiones del propietario

1. **Soacha y Rionegro.** `docs/SEO-IMPROVEMENT-PLAN.md` §1.17 dejó fuera los
   municipios satélite por riesgo de contenido casi duplicado con su
   metrópoli. Se propone incluir estos dos por la demanda medida. Rionegro
   casi no se cruza con Medellín (2 de 100). Soacha sí se cruza con Bogotá:
   61 de 100 vacantes dicen «Bogotá, D.C., Soacha». Si se prefiere, Soacha
   sale de la lista.
2. Hubs de profesión en un cambio aparte (arriba).

## Resultado esperado

- `/empleos` indexada y con impresiones para «empleos», «empleos colombia» y
  «ofertas de empleo» en la lectura a +28 días. No se promete posición: la
  autoridad del dominio es 5 frente a 80 de Computrabajo.
- Los hubs nuevos que pasen la guarda, indexados antes de diciembre.
- TTFB MISS de `/dashboard` y de los hubs existentes dentro de +10 % de la
  base del runbook; memoria de Render estable.
