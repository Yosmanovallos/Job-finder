# Segunda ola de intención: Medellín, Cali, fines de semana, medio tiempo y Puerto Ordaz

Prioridad 4 de `docs/SEO-GROWTH-ROADMAP-2026-11.md`. Se adelanta de
diciembre a ya para que las URL nuevas estén indexadas antes del pico de
enero. Se construye sobre `seo-intent-pages` (ADR 0012, PR #123 y #124),
que ya está en producción.

## Problema

- **Ciudad × sin experiencia.** El conteo del 2026-11-07
  (`seo-intent-pages/validation.md` §1) dio 33 vacantes aptas en Medellín
  y 15 en Cali: las dos pasan la guarda de 10. Ubersuggest da 4,4 K/mes en
  Medellín y 6,6 K en Cali (`docs/seo-baseline/2026-11-keyword-study.md`
  §8). Hoy `/empleos/medellin/sin-experiencia` y
  `/empleos/cali/sin-experiencia` devuelven el hub de la ciudad con
  canonical al hub (SIP-003).
- **Jornada.** «trabajo fines de semana» tiene 12,1 K/mes en Ubersuggest
  (Trends 28) y «trabajo medio tiempo» Trends 66. No tenemos ninguna
  página. «por días» y «temporada» tienen demanda, pero el inventario por
  clasificador no se ha medido.
- **Puerto Ordaz.** La gente busca «Puerto Ordaz» (1,9 K) y no «Ciudad
  Guayana» (390). El hub `/empleos/ciudad-guayana` no lo nombra y solo
  lista las vacantes cuya ubicación dice «Ciudad Guayana»: en el estudio
  había 13 con `Puerto Ordaz` y 3 con `Ciudad Guayana`.

## Resultado buscado

1. `/empleos/medellin/sin-experiencia` y `/empleos/cali/sin-experiencia`.
2. `/empleos/fines-de-semana` y `/empleos/medio-tiempo` (CO), solo si pasan
   la guarda con un clasificador determinista de frases explícitas y la
   regla de decisión de design D2. «por días» y «temporada», con la misma
   regla. Las versiones de Venezuela, solo si pasan la regla de D2.
3. `/empleos/ciudad-guayana` nombra Puerto Ordaz y lista sus vacantes.

## Alcance

- Ampliar la lista blanca ciudad × intención (`CITY_INTENTS`).
- Intenciones de jornada nuevas, con un clasificador puro compartido
  (memoria y SQL), igual que `job-experience.ts`.
- Lista blanca de países por intención: una versión de VE que no pasa D2
  no tiene ruta.
- Alias de ubicación solo para el hub de Ciudad Guayana, con título, H1 y
  meta que nombran Puerto Ordaz.
- Caché de intención, keeper de conteos (#124), sitemap y enlaces de los
  hubs con las páginas nuevas.

## Fuera de alcance

- Títulos y copia de los hubs que están en medición hasta el 2026-11-26
  (`city-hub-pages`, `city-hub-stats`, `job-link-graph`,
  `home-role-hubs`). Ciudad Guayana no está en ninguna de esas mediciones
  (design D6).
- La copia de `/empleos/remoto` (CO), congelada hasta el 2026-11-26.
- Páginas de vacante, portada y dashboard. La única diferencia aceptada en
  vacantes es la lista de vacantes relacionadas de las pocas vacantes de
  Ciudad Guayana (design D6).
- Añadir Puerto Ordaz a la lista de ciudades del país: crearía un hub nuevo
  y cambiaría las migas de las vacantes.
- Columna derivada `jobs.experience_level` u otra migración.
- La API pública (`/api/v1/jobs`), MCP, `llms.txt` y OpenAPI no ganan
  filtros.

## Riesgos

- **Falsos positivos de jornada.** «fines de semana» en una descripción
  suele significar «disponibilidad para trabajar fines de semana» en un
  empleo de tiempo completo. Mitigación: el conteo separa título y
  descripción y saca 15 títulos de muestra; D2 fija la regla antes de ver
  los números.
- **Duplicado con remoto.** Las vacantes con `employment_type = 'Medio
  tiempo'` vienen de Torre, Remotive y RemoteOK: remotas y casi siempre sin
  país. Mitigación: regla de solapamiento de D2.
- **Rendimiento.** Cada página nueva es una consulta de 1–2 s en frío sobre
  descripciones. Mitigación: D5 (caché dimensionada, sitemap que reutiliza
  los conteos del keeper, benchmark con 3.000 filas).
