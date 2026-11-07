# Diseño — páginas de intención

## Estado actual (leído en el código el 2026-11-07, `main@8875d65`)

- **Servidor (`src/server.ts`, rama `/empleos/` y `/ve/empleos/`):**
  - `segments[0]` es el id. Si no es UUID, se resuelve con
    `resolveCategorySlug(id, requestCountry)`; `segments[1]` se ignora.
  - Un UUID bajo `/ve/empleos/` da 404.
  - Un slug desconocido da 404; un rol retirado, 410.
- **Cliente (`src/App.tsx`):** `/empleos/:id/:slug?` y `/ve/empleos/:id`
  apuntan a `EmpleosRoute`. Con `:id` no UUID se pinta `CategoryLanding`.
- **`resolveCategorySlug`:** recorre `CITY_OPTIONS` (CO, incluye «Remoto»),
  luego las ciudades de VE y luego `DEFAULT_ROLES_200`. Como «Remoto» es una
  ciudad de CO, `/ve/empleos/remoto` resuelve con `country: "CO"`.
  `buildCategoryPath` no pone prefijo `/ve` a las ciudades, así que el
  canonical es `/empleos/remoto`.
- **Hreflang:** solo los roles emiten el par recíproco `es-CO`/`es-VE`
  (`server.ts`, alrededor de la línea 1557). Las ciudades no, porque son de
  un solo país.
- **Modalidad:** hay un clasificador único (PR #104,
  `getJobModalityLabel`) con «Remoto», «Híbrido», «Presencial», «Freelance ·
  proyecto remoto» y «Sin especificar».
- **No existe ningún clasificador de experiencia.**

## Decisiones

### D1. Tipo de categoría `intencion`

```ts
type CategoryKind = "ciudad" | "rol" | "intencion";
interface ResolvedCategory { kind; label; country; city?: string; intent?: IntentId }
type IntentId = "remoto" | "sin-experiencia";
```

- `intencion` toma el país del prefijo de la URL, igual que `rol`.
  `/empleos/remoto` es CO y `/ve/empleos/remoto` es VE.
- «Remoto» sale de la resolución como ciudad. `resolveCategorySlug` resuelve
  primero las intenciones y después las ciudades y los roles. La lista
  `CITY_OPTIONS` del dashboard no cambia: el filtro de ciudad «Remoto» sigue
  funcionando igual.
- **Filtros:**
  - `remoto`: `{ modality: "remoto", country }`, con el mismo clasificador
    del PR #104. Excluye «Freelance · proyecto remoto», igual que el filtro
    del dashboard hoy; se confirma en la prueba SIP-004.
  - `sin-experiencia`: `{ experience: "sin-experiencia", country }`, con el
    clasificador D3.
- **Ciudad × intención:** `/empleos/<ciudad>/<intencion>`, solo si la ciudad
  resuelve como `ciudad` (CO o VE) y la intención está en la lista blanca de
  esta fase (`sin-experiencia` para Bogotá). El filtro combina el de
  `cityHubFilters` con el de la intención.
  - Cualquier otro segundo segmento bajo un hub de ciudad mantiene el
    comportamiento de hoy: hub de la ciudad con canonical al hub. Así no se
    rompen URLs ya rastreadas.

### D2. Guarda de inventario

`indexable = aptasGoogle(filtro) >= 10`. «Aptas» usa el mismo
`seoReadySql`/`isPubliclyDescribable` que el sitemap.

| | Indexable | No indexable |
|---|---|---|
| Código HTTP | 200 | 200 |
| `robots` | `index,follow` | `noindex,follow` |
| En `sitemap-categories.xml` | sí | no |
| Enlaces internos desde home y hubs | sí | no |

Nunca se rellena una página con vacantes de otra categoría. Con 0 vacantes
se muestra el aviso vacío que ya existe.

### D3. Clasificador «sin experiencia» (determinista)

- Coincide solo con **frases explícitas** en el título o en
  `description_text`, en minúsculas, sin tildes y por palabra completa:
  - «sin experiencia», «no requiere experiencia», «no se requiere
    experiencia», «sin experiencia previa», «primer empleo»;
  - «0 años de experiencia», «experiencia: no requerida».
- **No cuentan** «aprendiz», «practicante» ni «junior» solos. Pueden pedir
  experiencia: se evalúan en una fase posterior con datos.
- «con o sin experiencia» **sí cuenta**, porque contiene «sin experiencia».
- **Regla de exclusión:** si el título o la descripción exigen un mínimo de
  años (`(minimo|mínimo)? N años? de experiencia` con N ≥ 1, o
  «experiencia mínima de N»), la vacante **no cuenta**, aunque también diga
  «sin experiencia» en otro contexto. Las pruebas cubren estos casos.
- Función pura y compartida por cliente y servidor, igual que
  `getJobModalityLabel`. Cálculo:
  - en memoria, para el bloque de la página;
  - en SQL (`ILIKE` sobre título y descripción), acotado a las aptas y
    activas, para la página.
- Se estudia en la tarea 2 si conviene una columna derivada.

### D4. Copia y meta (solo datos reales)

| Página | Title / H1 |
|---|---|
| `/empleos/remoto` | «Trabajo remoto en Colombia: {n} vacantes desde casa» (el H1 sin {n}) |
| `/ve/empleos/remoto` | igual, con «Venezuela» |
| `/empleos/sin-experiencia` | «Trabajo sin experiencia en Colombia: {n} vacantes» |
| `/empleos/bogota/sin-experiencia` | «Trabajo sin experiencia en Bogotá: {n} vacantes» |

- **Desviación (ADR 0012 §5):** `/empleos/remoto` (CO) conserva byte a byte
  su title, H1, meta y copia actuales hasta la lectura del 2026-11-26 de
  `city-hub-pages`. La copia D4 aplica solo a las URL nuevas, y el bloque de
  respuesta también.
- `{n}` es el conteo real del momento. El título no lleva número si
  `n < 10`; en ese caso la página es `noindex` de todos modos.
- La descripción tiene 150–160 caracteres y solo dice lo que la página
  muestra.
- **Bloque de respuesta** (AEO), en el HTML del servidor e idéntico en
  React:
  - «¿Cuántas vacantes hay?»: `n`;
  - «¿En qué ciudades?»: top 5 por conteo, en las páginas nacionales;
  - «¿Qué empresas publican?»: top 5 con al menos 2 vacantes cada una.

  Sin cifras de salario si no hay al menos 10 vacantes con salario
  publicado.

### D5. Hreflang y canonical

- Páginas de intención nacionales: canonical propio y hreflang recíproco
  `es-CO`/`es-VE`, **solo cuando las dos son indexables**. Si una no lo es,
  ninguna de las dos emite hreflang.
- Ciudad × intención: canonical propio y sin hreflang, como las ciudades.
- `/ve/empleos/remoto` deja de tener canonical a `/empleos/remoto`.

### D6. Rendimiento

- Misma estructura que los hubs: `getJobsPage` con clave de caché propia en
  `jobsPageCache` y `CITY_HUB_PAGE_LIMIT`.
- **Sin consultas nuevas en caliente** fuera de esa clave de caché.
- El bloque de respuesta se calcula sobre las filas ya cargadas, nunca con
  `Intl` u objetos pesados creados por fila (lección del #117).
- El conteo para la guarda reutiliza el `total` de la misma consulta.
- Benchmark obligatorio con un fixture de 3.000 filas: menos de 10 ms por
  petición y RSS estable tras 500 peticiones.

### D7. Hidratación

`CategoryLanding` recibe del payload SSR (`__SSR_CATEGORY__`) `kind`,
`intent`, `indexable` y el bloque calculado. El cliente no recalcula nada en
el primer render.

## Compatibilidad y riesgos

- **Contrato público:** ADR nuevo `docs/adr/00xx-intent-categories.md` y
  revisión del agente `architect`. Afecta a:
  - las URL: `/ve/empleos/remoto` cambia de canonical;
  - la API pública: `/api/v1/jobs` gana el filtro de intención solo si se
    decide en el ADR; si no, no cambia;
  - `llms.txt` y OpenAPI, si cambia la API.
- **Venezuela:** si `/ve/empleos/remoto` no pasa la guarda, queda en
  `noindex`, pero ya no sirve vacantes de CO.
- **Mediciones en curso:** no se tocan títulos, copia ni enlaces de los hubs
  de ciudad o rol existentes, salvo añadir un enlace a una página de
  intención indexable, que es aditivo y queda anotado en los checkpoints.

## Rollback

Una bandera `INTENT_PAGES_ENABLED`, activa por defecto tras aprobación. Si
se desactiva:
- las rutas vuelven al comportamiento de hoy;
- el sitemap deja de listarlas;
- se responde 410 a las URL nuevas que ya se publicaron, para que Google
  las retire limpio.

`/ve/empleos/remoto` vuelve al comportamiento de hoy (vacantes de CO con
canonical a CO) solo si se desactiva la bandera.
