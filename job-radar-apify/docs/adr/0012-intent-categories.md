# ADR 0012 — Categorías de intención: remoto y sin experiencia

**Fecha:** 2026-11-07
**Estado:** propuesto (cambio OpenSpec `seo-intent-pages`, sin desplegar)
**Contexto:** `docs/SEO-GROWTH-ROADMAP-2026-11.md` (prioridad 1),
`openspec/changes/seo-intent-pages/` (proposal, design D1–D7, requisitos
SIP-001 a SIP-052).

## Problema

`resolveCategorySlug()` conoce dos tipos de categoría:

- `ciudad`, cuyo país sale de la ciudad;
- `rol`, cuyo país sale del prefijo de la URL.

«Remoto» está en `CITY_OPTIONS` como si fuera una ciudad de Colombia. Por
eso pasan dos cosas:

- `/ve/empleos/remoto` resuelve con `country: "CO"`, lista vacantes de
  Colombia y tiene canonical a `/empleos/remoto`. Venezuela no tiene página
  de remoto.
- El hub de remoto filtra por la palabra «remoto» en `location`, no con el
  clasificador de modalidad del PR #104.

No hay ningún tipo para «sin experiencia»:

- `/empleos/sin-experiencia` da 404;
- `/empleos/bogota/sin-experiencia` sirve el hub de Bogotá con canonical al
  hub, porque el segundo segmento se ignora.

## Decisión

### 1. Tipo nuevo `intencion`

```ts
type CategoryKind = "ciudad" | "rol" | "intencion";
type IntentId = "remoto" | "sin-experiencia";
interface ResolvedCategory { kind; label; country; intent?: IntentId; city?: string }
```

- **País:** sale del prefijo de la URL, igual que en `rol`:
  - `/empleos/<intención>` es CO;
  - `/ve/empleos/<intención>` es VE.
- **Orden de resolución:** `resolveCategorySlug()` prueba primero las
  intenciones, después las ciudades y después los roles. «Remoto» deja de
  resolver como ciudad.
- **Lo que no cambia con esto:**
  - `CITY_OPTIONS` y el filtro de ciudad «Remoto» del dashboard;
  - las páginas de vacante. `getCountryConfig("CO").cities` no incluye
    «Remoto», así que ninguna vacante tenía un hub «Remoto» en su miga de
    pan ni en sus enlaces relacionados.
- **Rutas:** `buildCategoryPath()` pone el prefijo `/ve` a las intenciones,
  igual que a los roles. La ciudad × intención es
  `/empleos/<ciudad>/<intención>`, sin prefijo, igual que las ciudades.

### 2. Filtros

- **`remoto`:** `{ modality: "remoto", country }` (`sqlJobModality`, el
  clasificador del PR #104). Excluye «Freelance · proyecto remoto»
  (Workana).
- **`sin-experiencia`:** `{ experience: "sin-experiencia", country }`. Usa un
  clasificador determinista nuevo, `classifyExperience()`, que es puro,
  compartido por cliente y servidor, y tiene un gemelo SQL generado desde
  las mismas tablas.
  - Admite solo frases explícitas del design D3.
  - Tiene una regla de exclusión: un mínimo de N ≥ 1 años o meses de
    experiencia descarta la vacante.
  - El texto se normaliza con `searchTitleText`/`sqlSearchTitle`, la misma
    normalización que usa la modalidad.
  - La parte de la descripción se evalúa con una subconsulta por clave
    primaria sobre las filas canónicas ya filtradas. Nunca se evalúa dentro
    del CTE materializado de la proyección canónica: eso leería todas las
    descripciones (lección del Disk IO de Supabase, PR #109).
- **Inventario de las páginas de intención:** listan **solo** vacantes aptas
  para Google (`seo_ready = TRUE` sobre la fila canónica, el mismo criterio
  del sitemap).
  - El `total` de la consulta es el conteo de la guarda (D2/D6), sin
    consultas extra.
  - Los hubs de ciudad y de rol siguen listando lo mismo que hoy.
- **País:** igual que en el resto del sitio, `country IS NULL OR country =
  X`. Una vacante remota sin país aparece en CO y en VE. Ninguna vacante con
  `country = CO` aparece en una página de VE (SIP-001).

### 3. Guarda de inventario

Una página es indexable si `total >= 10`.

- **Indexable:**
  - `index,follow`;
  - aparece en `sitemap-categories.xml`;
  - recibe enlaces desde el home y los hubs.
- **No indexable:**
  - responde 200 con `noindex,follow`;
  - no aparece en el sitemap;
  - no recibe enlaces.
- El sitemap espera, con caché, el conteo de las pocas claves de intención.
  No usa `peek`: con `peek`, un arranque en frío quitaría las URL del sitemap
  y Cloudflare guardaría ese sitemap.

### 4. Canonical y hreflang

- `/ve/empleos/remoto` pasa a tener canonical propio.
- **Intención nacional:** emite hreflang recíproco `es-CO`/`es-VE` y
  `x-default` = CO, solo si las dos páginas son indexables.
- **Ciudad × intención:** no emite hreflang.

### 5. Copia de `/empleos/remoto` (CO)

`/empleos/remoto` (CO) es un hub que ya existe. Su título viene del cambio
`city-hub-pages` y está en medición hasta el 2026-11-26. En esta fase:

- **No cambian, byte a byte:** el title, el H1, la meta description y las
  secciones de copia.
- `isRemoteBucket()` reconoce `intencion`/`remoto`, así que los encabezados,
  la sección de ciudades y las cifras de `/empleos/remoto` se mantienen. Una
  prueba fija el hash de su title, H1, meta y copia.
- **Cambian:** el filtro (SIP-004), la guarda y el hreflang. El bloque de
  respuesta solo va en las URL nuevas.
- La copia D4 se aplica solo a las URL nuevas:
  - `/ve/empleos/remoto`;
  - `/empleos/sin-experiencia`;
  - `/ve/empleos/sin-experiencia`;
  - `/empleos/bogota/sin-experiencia`.
- El cambio de título de `/empleos/remoto` queda para después de la lectura
  del 2026-11-26.

### 6. Caché propia y respaldo del cliente

- **Caché propia `intentPageCache`:** las páginas de intención no usan el LRU
  de 64 entradas del dashboard, porque desalojarían las páginas calentadas.
  Es el mismo precedente que la portada y las empresas en el runbook.
  - Tiene 8 entradas y la misma política: 5 min fresca, 6 h obsoleta y una
    sola recarga a la vez.
  - Una entrada guarda la primera página (60 filas) y el `total`.
  - Sirve a la página, a la guarda, al sitemap, al hreflang (el conteo del
    país hermano sale de la misma caché) y a los enlaces desde los hubs. Los
    hubs solo hacen `peek`: en frío omiten el enlace.
  - No hay calentamiento nuevo al arrancar.
- **Respaldo del cliente:** `CategoryLanding` llega sin el payload SSR
  cuando se navega en el cliente. En ese caso pide
  `GET /api/intent-page?path=<ruta>`, que solo acepta las 5 rutas de la lista
  blanca y responde desde la misma caché. `/api/jobs` no gana parámetros
  nuevos, así que no hay combinaciones arbitrarias de búsqueda con
  experiencia.

### 7. Columna derivada de experiencia

El clasificador sobre la descripción puede leer muchas descripciones en cada
recarga. Ese es el riesgo de Disk IO del PR #109. La decisión depende del
`EXPLAIN (ANALYZE, BUFFERS)` del Bloque 1, registrado en `validation.md`:

- **Si el costo es acotado:** subconsulta por clave primaria, que solo se
  ejecuta en las recargas de la caché (como mucho, una por clave cada 5 min).
- **Si no:** columna derivada `jobs.experience_level`, añadida con una
  migración aditiva que necesita aprobación del propietario y calculada en la
  ingesta.

### 8. Portada

La portada no cambia en esta fase (SIP-050; `home-role-hubs` está en
medición hasta el 2026-11-26). Los enlaces desde la portada a las páginas de
intención y el enlace de remoto de `/ve`, que hoy apunta a la página de CO,
quedan para después de esa lectura. En esta fase, los enlaces internos salen
de los hubs de ciudad del mismo país.

### 9. API pública

`/api/v1/jobs`, MCP, WebMCP, OpenAPI y `llms.txt` **no cambian** en esta
fase. El filtro de experiencia queda interno:

- sirve al SSR;
- sirve al `fetch` de respaldo de `CategoryLanding` en `/api/jobs`, que está
  bloqueado en `robots.txt` y no figura en OpenAPI.

Exponerlo en la API pública es una decisión aparte, con su propio ADR y con
los contratos actualizados juntos.

### 10. Rollback: `INTENT_PAGES_ENABLED`

Se lee en cada petición. Sin definir equivale a `true`; para desactivarla,
`false`. Con `false`:

- `/empleos/remoto` y `/ve/empleos/remoto` vuelven al comportamiento
  anterior: hub de ciudad «Remoto» de CO.
- Las URL nuevas responden 410 `noindex`, para que Google las retire limpio:
  - `/empleos/sin-experiencia`;
  - `/ve/empleos/sin-experiencia`;
  - `/empleos/bogota/sin-experiencia`.
- El sitemap y los enlaces dejan de listarlas.
- Cloudflare guarda el HTML y el sitemap durante su TTL, así que la bandera
  no actúa al instante. Para un rollback inmediato hay que purgar esas URL.

## Consecuencias

- **Cambio de contrato de URL:** `/ve/empleos/remoto` deja de servir datos de
  CO. Si no pasa la guarda, queda en `noindex`, pero nunca vuelve a mostrar
  vacantes de CO.
- **Caché:** `intentPageCache` es propia, de 8 entradas, y queda fuera del LRU
  del dashboard (§6).
- **Pruebas:** `validate-job-internal-links.test.ts` comprueba que cada hub
  enlazado resuelve de vuelta al mismo hub. Sigue siendo cierto, porque
  ninguna vacante enlaza al hub «Remoto».
- **No cambian:** las páginas de vacante (title, canonical, JSON-LD) ni los
  hubs de ciudad y de rol (title, meta, robots, JSON-LD), salvo el enlace
  aditivo a una página de intención indexable. La portada no cambia.

## Revisión del agente `architect` (2026-11-07)

Veredicto: aprobar con cambios. Se incorporaron así:

- `isRemoteBucket` reconoce la intención remoto, con una prueba de hash de la
  copia (§5);
- caché propia fuera del LRU (§6);
- respaldo del cliente cerrado, sin abrir `/api/jobs` (§6);
- decisión de la columna derivada con el EXPLAIN (§7);
- portada sin cambios (§8);
- nota sobre Cloudflare en el rollback (§10).

El architect aceptó la desviación de la §5, con la condición de anotarla en
D4/SIP-030; queda anotada en el design.

## Enmienda 1 (2026-11-07): segunda ola (`seo-intent-wave2`)

Cambio OpenSpec `openspec/changes/seo-intent-wave2/` (design D1–D6,
requisitos SIW-001 a SIW-062). No crea un tipo nuevo: amplía `intencion`.

- **Intenciones de jornada:** `fines-de-semana`, `medio-tiempo` y
  `temporada`. Clasificador determinista por frases explícitas del
  **título** (`src/lib/job-schedule.ts`, memoria = SQL). La descripción y
  `employment_type` no cuentan: el conteo de producción mostró que no son
  evidencia fiable (`validation.md` §1).
- **Países por intención (`INTENT_COUNTRIES`):** una intención solo
  resuelve en los países de su lista. Las de jornada son solo de CO: en VE
  tienen 1–3 vacantes. Sin versión hermana no hay hreflang. Un país fuera
  de la lista da 404, no `noindex`, así que no gasta caché, consultas del
  keeper ni entradas del sitemap.
- **Ciudad × intención:** Medellín y Cali se suman a Bogotá con
  «sin experiencia».
- **`switch` exhaustivo:** toda función que ramifica por intención usa un
  `switch` con comprobación `never`.
- **Caché y sitemap:** `intentPageCache` tiene tantas entradas como
  páginas de intención más 4 (antes 8 fijas). `sitemap-categories.xml`
  reutiliza los conteos que ya cargó el keeper y solo consulta, en serie,
  los que no conoce.
- **Alias de ubicación de un hub de ciudad:** `CITY_HUB_LOCATION_ALIASES`
  (`"Ciudad Guayana": ["Puerto Ordaz"]`). Lo leen solo el filtro del hub,
  su gemelo en memoria y su título y meta. La lista de ciudades del país no
  cambia, así que no hay hub nuevo ni migas nuevas en las vacantes. Única
  diferencia en vacantes: las vacantes relacionadas de las vacantes de
  Ciudad Guayana.
- **Sin cambios:** la API pública, MCP, `llms.txt`, OpenAPI y el filtro de
  ciudad del dashboard. `/api/jobs` no lee `schedule`.
