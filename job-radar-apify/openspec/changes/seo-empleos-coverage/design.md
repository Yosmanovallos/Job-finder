# Diseño — cobertura base (`/empleos` y hubs de ciudad con guarda)

## Estado actual (leído en el código el 2026-11-10, `main@fb1ad32`)

- `resolveCategorySlug` (`src/lib/job-seo.ts`) resuelve intención → ciudad de
  `CITY_OPTIONS` (CO) → ciudad de `COUNTRIES.VE.cities` → rol de
  `DEFAULT_ROLES_200`. Cualquier otro slug es 404.
- `CITY_OPTIONS` es también el filtro de ciudad del dashboard, la lista de
  `buildRelatedCityLinks` (enlaces entre hubs) y la de `resolveJobCityHub`
  (miga de las vacantes). Añadir una ciudad ahí cambia el HTML de todos los
  hubs y de vacantes.
- `DEFAULT_ROLES_200` siembra el scraping (`seedSearchRoles`).
- Los hubs de ciudad usan `getJobsPage` (LRU de 64 entradas, compartida con
  el dashboard) y no tienen guarda: solo `noindex` con 0 vacantes.
- Las páginas de intención usan `getIntentPage` (caché propia,
  `INTENT_PAGE_CACHE_ENTRIES`), `googleReady: true`, guarda de 10
  (`isIntentIndexable`), y un keeper que refresca sus totales cada 3 h.
- El servidor trata `/empleos/…` en una sola rama; `/empleos` sin segmento
  cae al 404. `App.tsx` solo registra `/empleos/:id/:slug?` y
  `/ve/empleos/:id`.
- `buildCategoryBreadcrumbList` tiene dos niveles porque «no existe una
  página `/empleos`».

## Decisiones

### D1. Hubs de ciudad con guarda: lista propia

```ts
// src/lib/job-seo.ts
export const GUARDED_CITY_HUBS: ReadonlyArray<{ label: string; country: "CO" | "VE" }> = [
  { label: "Barrancabermeja", country: "CO" }, { label: "Yopal", country: "CO" },
  { label: "Rionegro", country: "CO" },        { label: "Soacha", country: "CO" },
  { label: "Zipaquirá", country: "CO" },       { label: "Tocancipá", country: "CO" },
  { label: "Facatativá", country: "CO" },      { label: "Apartadó", country: "CO" },
  { label: "Quibdó", country: "CO" },          { label: "Fusagasugá", country: "CO" },
  { label: "Maturín", country: "VE" },         { label: "Lechería", country: "VE" }
];
export function isGuardedCityHub(category: ResolvedCategory): boolean;
```

- `resolveCategorySlug` las resuelve como `kind: "ciudad"` después de las
  ciudades de siempre y antes de los roles. Una prueba comprueba que ningún
  slug choca con una ciudad, un rol, una intención o un rol retirado.
- **No** entran en `CITY_OPTIONS` ni en `COUNTRIES.*.cities`. Por eso no
  cambian el dashboard, `buildRelatedCityLinks` de los hubs existentes ni
  `resolveJobCityHub`.
- Título, H1 y meta: la plantilla de ciudad de hoy (`buildCategoryMeta`),
  sin copia nueva.
- El hub nuevo sí muestra «Empleos en otras ciudades» con las ciudades de
  siempre de su país (enlaces salientes hacia hubs existentes).

### D2. Guarda e inventario

- Filtros: los de cualquier hub de ciudad, `{ cities: [label], country }`
  (`cityHubFilters`). El `total` es el número de la guarda y el que muestra
  la página. No se usa `googleReady`: así el HTML del servidor y la
  navegación en el cliente (`/api/jobs`) dan la misma lista.
- Caché: `getIntentPage` / `knownIntentTotal`. Nunca la LRU del dashboard.
  `INTENT_PAGE_CACHE_ENTRIES` = intenciones + hubs con guarda + 4.
- Robots: `intentRobots(total)` → `noindex,follow` por debajo de 10.
- Keeper: recorre también `GUARDED_CITY_HUBS` (12 consultas más, en serie,
  cada 3 h). Se mide el EXPLAIN de una en producción antes de desplegar.
- «Nuevas hoy»: del mismo snapshot que los demás hubs de ciudad.
- Cliente: `CategoryLanding` no cambia; resuelve el slug con la misma
  función y pide `/api/jobs` con los mismos filtros. El robots lo pone el
  servidor, como en las páginas de intención.

### D3. Página índice `/empleos` y `/ve/empleos`

| | CO | VE |
|---|---|---|
| URL y canonical | `/empleos` | `/ve/empleos` |
| Title | «Empleos en Colombia: ofertas de trabajo hoy \| BuscoTrabajo» | «Empleos en Venezuela: ofertas de trabajo hoy \| BuscoTrabajo» |
| H1 | «Empleos en Colombia» | «Empleos en Venezuela» |

- Meta description de 150–160 caracteres con el total real. Si el total no
  está disponible, la frase sin número.
- `/empleos/` (con barra final) redirige 301 a `/empleos`.
- hreflang recíproco `es-CO` / `es-VE` y `x-default` a CO.
- **Datos, sin consulta nueva en caliente:** el total y las vacantes
  recientes salen de la primera página del dashboard del país
  (`getJobsPage`, la misma entrada que calienta el arranque). Si falla, la
  página responde 200 con los enlaces y sin la lista (nunca un total
  inventado).
- **Secciones (HTML en el servidor, mismos datos en el cliente):**
  1. Párrafo con el total real y las fuentes del país (`SOURCES_BY_COUNTRY`).
  2. «Vacantes recientes» (24 enlaces a vacantes).
  3. «Empleos por ciudad»: ciudades de siempre + hubs con guarda cuyo total
     conocido es ≥ 10. Total desconocido = sin enlace.
  4. «Empleos por modalidad y jornada»: páginas de intención con total
     conocido ≥ 10 (misma regla que los hubs).
  5. «Empleos por cargo»: los roles de `DEFAULT_ROLES_200`.
  6. Enlaces a `/dashboard`, `/empresas` e inicio.
- Sin conteos por ciudad o cargo: pedirlos costaría una consulta por enlace.
- JSON-LD: `BreadcrumbList` (Inicio › Empleos) e `ItemList` de las vacantes
  mostradas. Nada más.
- Cliente: sección nueva `EmpleosIndex.tsx`, rutas `/empleos` y
  `/ve/empleos` en `App.tsx`. Lee `window.__SSR_EMPLEOS__`; sin payload
  (navegación interna) pide `/api/empleos-index?country=`.
- Negociación Markdown y `Vary`: las mismas que un hub (`sendBody`).

### D4. Sitemap

`sitemap-categories.xml` añade `/empleos`, `/ve/empleos` y los hubs con
guarda que pasan, con la misma regla que las intenciones
(`collectIndexableIntents`: total conocido o consulta en serie; un fallo es
503 `no-store`).

### D5. Rendimiento

- `/empleos` no añade consultas: reutiliza la entrada caliente del dashboard.
- Hubs con guarda: 12 entradas más en la caché de intención (12 × 60 filas).
  Se mide RSS con el benchmark de intención ampliado y con datos del tamaño
  de producción.
- Nada de `Intl` ni objetos pesados por fila (lección del #117).
- Puertas: TTFB MISS de `/dashboard`, `/empleos/bogota` y una vacante dentro
  de +10 % de la base del runbook; `/api/health` de memoria tras una ráfaga
  de 60 peticiones.

## Compatibilidad y contrato

- URL nuevas de un tipo nuevo (página índice) y una regla nueva (hub de
  ciudad con guarda): **ADR 0014** antes de fusionar (AGENTS regla 13).
- `llms.txt`, API Catalog y la documentación de agentes citan rutas reales:
  se añade `/empleos` donde se listan las páginas públicas y se corre
  `test:agent-readiness`.
- El drift de las URL de base (portada, dashboard, hubs existentes,
  vacantes) tiene que salir sin diferencias.

## Rollback

`EMPLEOS_COVERAGE_ENABLED=false` (leída por petición, por defecto
encendida): `/empleos` y `/ve/empleos` vuelven a 404, los hubs con guarda
responden 410 y salen del sitemap. El cliente no depende de la bandera: sin
payload y con la API en 404 muestra «no encontrada».
