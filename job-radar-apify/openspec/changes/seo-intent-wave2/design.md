# Diseño — segunda ola de intención

## Estado actual (leído en el código el 2026-11-07, `main@c42719c`)

- `IntentId = "remoto" | "sin-experiencia"` (`src/lib/job-seo.ts`).
  `CITY_INTENTS` solo tiene Bogotá × sin experiencia.
- **Todas las ramas por intención son binarias:** `intentFilters`,
  `buildIntentMeta`, `intentLinkLabel` y `buildIntentAnswer` hacen
  `remoto` / si no. Una intención tercera tomaría en silencio el filtro y
  la copia de «sin experiencia».
- `listIntentCategories()` crea una versión CO y otra VE de cada intención
  nacional. De ella salen el sitemap, el keeper de conteos (#124), los
  enlaces de los hubs y la lista blanca de `/api/intent-page`.
- `intentPageCache`: 8 entradas, hoy 5 en uso.
- `sitemap-categories.xml` espera en serie la consulta de cada intención.
- `cityHubFilters(hub)` = `{ cities: [hub.label], country }`. Lo usan el
  hub y la ruta de vacante (`peekJobsPage`, vacantes relacionadas). El
  gemelo en memoria es `hubMatcher` en `src/lib/recent-jobs.ts`.
- `employment_type` guarda etiquetas en español (`'Medio tiempo'`,
  `'Temporal'`, `'Por día'`), no tokens de schema.org. Solo lo rellenan
  algunas fuentes (Torre, Remotive, RemoteOK, entre otras).

## Decisiones

### D1. Intenciones de jornada y tipo exhaustivo

```ts
type IntentId = "remoto" | "sin-experiencia" | "fines-de-semana" | "medio-tiempo" | "temporada";
// "por-dias" no pasó D2 (0 en el título). Ver validation.md §1.
```

**Resultado del conteo (2026-11-07, `validation.md` §1):** las tres
intenciones de jornada usan **solo el título**. La descripción (0/15) y
`employment_type` (2.094 filas «Medio tiempo», 0/15 verificables) no
cuentan. Así el filtro no lee descripciones y no necesita columna
derivada.

- Cada función que hoy ramifica por intención pasa a un `switch`
  exhaustivo con comprobación `never`. Un `IntentId` nuevo sin filtro,
  copia, etiqueta o respuesta no compila.
- **Filtro:** campo nuevo `schedule?: ScheduleIntent` en
  `JobFilterParams`, validado con lista blanca (`scheduleForFilter`). Solo
  lo rellena `intentFilters`. `/api/jobs` y `/api/v1/jobs` no lo leen de
  la URL.
- **Clasificador** `src/lib/job-schedule.ts`, puro y compartido, con
  `classifySchedule(job)` en memoria y `sqlSchedule(intent, …)` en SQL,
  sobre el mismo texto normalizado de `searchTitleText` / `sqlSearchTitle`.
  Mismo patrón que `job-experience.ts`: prefiltro barato y paridad
  SQL = memoria sobre un fixture compartido.
  - **Fines de semana:** frase explícita en el **título** («fin de
    semana», «fines de semana», «sábados y domingos», «weekend»). La
    descripción solo cuenta con frases estrictas («solo fines de semana»,
    «únicamente fines de semana», «turnos de fin de semana»…), y solo si la
    muestra de D2 lo justifica. Nunca la mención suelta en la
    descripción: suele ser «disponibilidad para laborar fines de semana»
    en un empleo de tiempo completo.
  - **Medio tiempo:** frase explícita en el título («medio tiempo»,
    «tiempo parcial», «part time», «media jornada», «jornada parcial») o
    `employment_type = 'Medio tiempo'`, que es un dato que publica la
    fuente. La descripción no cuenta salvo que D2 lo justifique.
  - **Negaciones** que excluyen la vacante aunque tenga la frase: «sin
    fines de semana», «fines de semana libres», «no se trabaja fines de
    semana», «no es medio tiempo»…
  - Las listas exactas son las de `scripts/count-intent-wave2.ts`, fijadas
    antes del conteo. La implementación usa exactamente las que gane D2.

### D2. Regla de decisión (fijada antes del conteo)

Una intención entra en esta fase si cumple **todo**:

1. **Inventario:** ≥ 10 vacantes aptas con la variante elegida del
   clasificador, en el país de la página (`country IS NULL OR country = X`).
2. **Precisión:** al menos 12 de los 15 títulos de muestra (80 %) son de
   verdad de esa intención, revisados a mano. Se revisa cada variante por
   separado (título; descripción estricta). Una variante que no llega al
   80 % no entra en el clasificador, aunque suba el conteo.
3. **No duplica otra página:** si más del 80 % de sus vacantes también
   están en `/empleos/remoto` del mismo país, no se crea. Sería casi la
   misma lista con otro nombre.
4. **Versión de Venezuela:** además de 1–3, al menos la mitad de sus
   vacantes tiene `country = 'VE'`. Si no, son vacantes sin país que ya
   salen en la página de CO (la lección de `/ve/empleos/remoto`: 141 de
   145). Sin este mínimo, la versión de VE no tiene ruta (404 como hoy).

- «por días» y «temporada» siguen la misma regla. Se espera que no pasen.
- Ciudad × intención (Medellín, Cali): solo la regla 1, con el clasificador
  D3 de `seo-intent-pages`, que ya está en producción.
- La guarda dinámica de 10 (ADR 0012 §2) sigue igual: una página que entra
  y luego baja de 10 pasa sola a `noindex`.

### D3. Lista blanca de países por intención

```ts
const INTENT_COUNTRIES: Record<IntentId, readonly ("CO" | "VE")[]> = {
  remoto: ["CO", "VE"], "sin-experiencia": ["CO", "VE"],
  "fines-de-semana": ["CO"], "medio-tiempo": ["CO"], temporada: ["CO"] // VE: 1, 3 y 1
};
```

- `resolveCategorySlug` solo resuelve una intención en un país de su
  lista. `/ve/empleos/fines-de-semana` sin VE en la lista da 404.
- `listIntentCategories`, `siblingIntent` y el hreflang la respetan: sin
  versión hermana no hay hreflang (SIW-022).

### D4. Copia y meta (solo datos reales)

| Página | Title / H1 |
|---|---|
| `/empleos/medellin/sin-experiencia` | «Trabajo sin experiencia en Medellín: {n} vacantes» (igual que Bogotá) |
| `/empleos/cali/sin-experiencia` | «Trabajo sin experiencia en Cali: {n} vacantes» |
| `/empleos/fines-de-semana` | «Trabajo los fines de semana en Colombia: {n} vacantes» |
| `/empleos/medio-tiempo` | «Trabajo de medio tiempo en Colombia: {n} vacantes» |
| `/empleos/temporada` | «Trabajo por temporada en Colombia: {n} vacantes» |

- Mismas reglas que D4 de `seo-intent-pages`: `{n}` es el `total` real y
  solo aparece desde 10; la descripción tiene 150–160 caracteres y solo
  dice lo que la página muestra; el H1 no lleva número.
- Bloque de respuesta: «¿Cuántas vacantes hay?» dice qué evidencia se usó
  («cuyo título dice que son de fines de semana / de medio tiempo / por
  temporada»). Ciudades y empresas, igual que hoy.
- Etiqueta del enlace desde los hubs: «Trabajo los fines de semana en
  Colombia», «Trabajo de medio tiempo en Colombia», «Trabajo sin
  experiencia en Medellín».

### D5. Rendimiento

- **Caché:** `intentPageCache.maxEntries` = número de páginas de
  intención + 4 de margen. Con 8 entradas y más de 8 páginas, el keeper y
  las páginas se expulsarían entre sí, y cada recarga cuesta 1–2 s de CPU
  en Nano. Se mide la RSS de N × 60 filas en el benchmark.
- **Sitemap:** usa primero el conteo conocido (`knownIntentTotal`, que
  mantiene el keeper) y solo consulta, en serie, las páginas sin conteo
  conocido. Así no espera 10–20 s en frío con 9–11 consultas. Un fallo
  sigue siendo 503 `no-store`, nunca un 200 al que le faltan URL.
- **Keeper (#124):** recorre `listIntentCategories()`, así que incluye las
  páginas nuevas sin código aparte. Se comprueba con una prueba
  (SIW-031). Con ~11 consultas en serie de 1–2 s cada 3 h, ocupa una
  conexión del pool unos 20 s cada 3 h.
- **Por petición:** nada nuevo en caliente. El bloque se calcula sobre las
  filas ya cargadas, sin `Intl` ni objetos pesados por fila (#117).
  Benchmark con 3.000 filas: < 10 ms por petición y RSS estable tras 500
  peticiones.
- Los hubs solo leen el último conteo conocido; nunca disparan una
  consulta de intención (lección del #123: Caracas pasó de 44 a 84 ms).

### D6. Puerto Ordaz en el hub de Ciudad Guayana

**Mediciones abiertas.** Revisado el 2026-11-07:

- `city-hub-pages`: el seguimiento en GSC es de las ciudades candidatas
  de su propuesta (Caracas, Santa Marta, Neiva, Valledupar).
- `city-hub-stats`: Caracas, Santa Marta, Neiva, Ibagué y Armenia.
- `job-link-graph` y `home-role-hubs`: no nombran Ciudad Guayana.

Ciudad Guayana no está en ninguna medición abierta, así que se cambia ya.

**Cambio:**

- Alias de ubicación propio del hub: `CITY_HUB_LOCATION_ALIASES =
  { "Ciudad Guayana": ["Puerto Ordaz"] }`. San Félix no tiene vacantes
  (conteo: 0) y no entra. Hoy el hub no tiene ninguna vacante apta con
  «Ciudad Guayana»; con el alias pasa a 8 de Puerto Ordaz. Lo leen **solo** `cityHubFilters` y su gemelo
  `hubMatcher`. La lista de ciudades de VE (`countries/index.ts`) no
  cambia, así que no hay hub nuevo, ni migas nuevas en vacantes, ni opción
  nueva en el dashboard.
- Título y H1: «Empleos en Ciudad Guayana y Puerto Ordaz: trabajo y ofertas
  de empleo». Es la plantilla de CITY-001 con el nombre que usa la gente.
  La meta nombra los dos. El slug y el canonical no cambian.
- **Diferencia aceptada en vacantes:** `cityHubFilters` también elige las
  vacantes relacionadas de la ruta de vacante. En las pocas vacantes de
  Ciudad Guayana, esa lista ahora puede incluir vacantes de Puerto Ordaz.
  No se le puede dar a esa ruta el filtro antiguo: nadie llenaría esa clave
  de caché y los enlaces desaparecerían. Es la única diferencia aceptada en
  vacantes y el drift la tiene que mostrar.
- Las vacantes de Puerto Ordaz siguen sin miga de hub
  (`resolveJobCityHub` no cambia). Darles miga cambiaría páginas de
  vacante y queda para otra fase.

## Compatibilidad

- Sin contrato público nuevo: las URL nuevas siguen el tipo `intencion` del
  ADR 0012. Basta una enmienda al ADR 0012 (lista de intenciones, países
  por intención y alias de ubicación). La API pública no cambia.
- `CITY_OPTIONS` del dashboard no cambia.

## Rollback

`INTENT_PAGES_ENABLED=false` apaga también las páginas nuevas (410 a las
URL nuevas ya publicadas, ADR 0012 §10; lo comprueba `test:seo`).

El alias de Ciudad Guayana **no tiene bandera de entorno**: lo leen el
servidor y el cliente (`CategoryLanding` pide las mismas ubicaciones a
`/api/jobs` al navegar), y una variable solo de servidor desalinearía la
hidratación. Para revertirlo se borra la entrada de
`CITY_HUB_LOCATION_ALIASES` (una línea) y se despliega: el hub vuelve al
filtro, título y meta de hoy.
