# Validación — seo-intent-wave2

Rama `codex/seo-intent-wave2`, base `origin/main@c42719c`, con `main@db0c31e`
(#128) mezclado antes de las pruebas finales. Enmienda al ADR 0012.

## 1. Conteo previo en producción (tarea 1)

**Cómo se midió:**

- Script `scripts/count-intent-wave2.ts`, corrido el 2026-11-07 a las
  18:18 UTC desde el checkout con `.env`, con autorización del
  propietario.
- Una transacción `BEGIN READ ONLY` con `statement_timeout` de 60 s y
  `ROLLBACK` al final. Nada se escribe.
- Mismo método que `seo-intent-pages`: «apta» = fila canónica (el
  `DISTINCT ON` del sitemap) con `seo_ready`, activa y vigente. País
  «página» = `country IS NULL OR country = X`.
- Salida completa (conteos, 15 títulos de muestra por variante, EXPLAIN):
  en la carpeta de notas de la sesión, `seo-intent-wave2-count.json`. Solo
  títulos públicos, sin ids ni descripciones.

**Duración:** la consulta principal tardó 27 s. Cada muestra repitió la
lectura de descripciones (sin tablas temporales en una transacción de solo
lectura), así que el script completo tardó unos 10 min en una conexión.
El EXPLAIN dio **0 lecturas a disco** (78.008 bloques en caché): no repite
el incidente de Disk IO del #109.

| Aptas (página) | CO | VE |
|---|---:|---:|
| Total | 8.873 | 1.662 |
| Sin experiencia · Medellín | **34** | — |
| Sin experiencia · Cali | **15** | — |
| Fines de semana · título | **30** | 1 |
| · descripción estricta («solo fines de semana»…) sin título | 2 | 0 |
| · cualquier mención en la descripción | 175 | 21 |
| · negaciones | 6 | 0 |
| Medio tiempo · título | **26** | 3 |
| · `employment_type = 'Medio tiempo'` | 2.096 | 25 |
| · `employment_type` y remoto | 2 | 3 |
| · descripción sin título | 70 | 19 |
| · título con «tiempo completo» | 0 | 0 |
| Por días · título | **0** | 0 |
| · `employment_type = 'Por día'` | 346 | 0 |
| · descripción sin título | 15 | 1 |
| Temporada · título | **245** | 1 |
| · descripción sin título | 125 | 0 |
| «Temporal» · título | 56 | 9 |
| Ubicación «Puerto Ordaz» | 0 | **8** |
| Ubicación «Ciudad Guayana» | 0 | **0** |
| Ubicación «San Félix» | 0 | 0 |

**`employment_type` entre las aptas de CO:** Tiempo completo 4.436,
**Medio tiempo 2.094**, sin valor 1.167, Por día 346, Temporal 282,
Prácticas 125, Contrato 104 y variantes en inglés («Full time», «FullTime»…).

### Revisión de muestras (regla de precisión D2: ≥ 12 de 15)

| Variante | En la intención | Ejemplos |
|---|---:|---|
| Fines de semana · título (CO) | **15/15** | «Operador De Tienda Fines De Semana», «Cajero fin de semana», «Enfermera cuidado adulto mayor fin de semana» |
| Fines de semana · descripción estricta | 0/2 | «Administrador(a) de bolera», «Asesores comerciales…»: empleos de tiempo completo |
| Fines de semana · cualquier mención en la descripción | 0/15 | «Jefe de enfermería», «Programa de inclusión Tiendas Ara», «Administrador de bases de datos» |
| Medio tiempo · título (CO) | **15/15** | «CAJERA MEDIO TIEMPO», «Docente universitario medio tiempo», «SEMILLERO AGENTE DE OPERACIONES PART TIME» |
| Medio tiempo · solo `employment_type` | 0/15 verificables | «GUARDIA DE SEGURIDAD», «OPERARIO DE PRODUCCIÓN», «Conductor (distribución)», «TECNICO DE MANTENIMIENTO MECANICO» |
| Medio tiempo · solo descripción | 0/15 | sobre todo «Programa de Inclusión Tiendas Ara» |
| Temporada · título (CO) | **15/15** | «Asesor Comercial-TEMPORADA NAVIDEÑA», «SUPERVISOR POR TEMPORADA», «Mercaderista con moto para Temporada decembrina» |
| «Temporal» · título | — | contrato temporal («Analista de Contabilidad (Temporal)», «Especialista Financiero (Temporal 1 año)»): es otra intención |
| Puerto Ordaz (VE) | 8/8 | Todas «puerto ordaz, bolivar state, venezuela» |

### Decisiones (regla D2 del design, fijada antes del conteo)

- **Medellín × sin experiencia (34) y Cali × sin experiencia (15):**
  entran. Solo aplica la regla 1 (≥ 10). Cali queda cerca de la guarda; si
  baja de 10, pasa sola a `noindex`.
- **`/empleos/fines-de-semana` (CO): entra, solo con el título.** 30 aptas
  y 15/15. La descripción no entra: 0/15 en la mención suelta y 0/2 en las
  frases estrictas. No se solapa con remoto.
- **`/empleos/medio-tiempo` (CO): entra, solo con el título.** 26 aptas y
  15/15.
  - **`employment_type = 'Medio tiempo'` no sirve como evidencia.**
    Aparece en el 24 % de las aptas de CO (2.094), en cargos de jornada
    completa evidente. Hay contradicciones como «Operador De Tiendas Ara
    Medio Tiempo» marcado como «Tiempo completo» y «Operador De Tienda Fines
    De Semana» también como «Tiempo completo». Sale del JSON-LD de las
    fuentes (`job-posting-jsonld.ts`, `PART_TIME`) y no es fiable. No lo
    usa el clasificador y no cambia el JSON-LD de las vacantes (fuera de
    alcance).
- **`/empleos/temporada` (CO): entra, solo con el título.** 245 aptas y
  15/15: casi todo es la temporada navideña. Es estacional: después de
  enero el conteo bajará y la página pasará sola a `noindex` (guarda
  dinámica). «Temporal» (contrato temporal) no cuenta.
- **«Por días»: no entra.** 0 en el título. `employment_type = 'Por día'`
  (346) tiene el mismo problema que «Medio tiempo» y no se usa.
- **Versiones de Venezuela: ninguna.** Fines de semana 1, medio tiempo 3 y
  temporada 1, todas por debajo de la regla 1. No tienen ruta (404).
- **Ciudad Guayana:** el hub hoy no tiene **ninguna** vacante apta con
  «Ciudad Guayana» en la ubicación. Con el alias, pasa a 8 de Puerto Ordaz,
  todas del estado Bolívar. San Félix no tiene vacantes: no se añade como
  alias.
- **Sin columna derivada.** El clasificador de jornada lee solo el título,
  en la fila canónica, como el de modalidad: no lee descripciones. El
  EXPLAIN del conteo (8,7 s) mide la variante con descripción, que se
  descartó.

## 2. Pruebas (todas con código de salida 0)

Ver §5 para los comandos tras mezclar `main@db0c31e`.

- `tests/validate-intent-wave2.test.ts` (unitario, reloj fijo): SIW-001 a
  SIW-052. Se escribió antes del código; la primera ejecución falló por las
  exportaciones que faltaban.
- `tests/validate-intent-pages.ts` (`test:seo`, base desechable):
  - paridad SQL = memoria del clasificador de jornada (20 casos × 3
    intenciones, SIW-011);
  - por HTTP: SIW-001, -002, -010, -013, -020, -022, -030, -032, -033,
    -040, -041, -050, -051 y -052;
  - el rollback (`INTENT_PAGES_ENABLED=false`) devuelve 410 también en las
    URL nuevas.
- **Cambios intencionales en las pruebas del #123:**
  - SIP-003 usaba Medellín como ciudad fuera de la lista blanca; ahora usa
    Barranquilla.
  - SIP-022 fijaba la lista exacta de 5 páginas; ahora comprueba que siguen
    estando, y la lista exacta es SIW-021.
  - El título nacional de «sin experiencia» del fixture pasa de 10 a 20
    vacantes por las 10 de Medellín que siembra la prueba nueva.

## 3. Benchmark SIW-062

`npm run bench:intent-pages`. Usa la base desechable del runner, reloj
fijo, 3.000 filas sintéticas (ahora también con títulos de fines de
semana, medio tiempo y temporada) y 500 peticiones por medición.

**En memoria:**

| Medición | Media | p95 |
|---|---:|---:|
| Petición SSR de `/empleos/sin-experiencia` (60 filas) | **1,43 ms** | 2,00 ms |
| Petición SSR de `/empleos/fines-de-semana` (60 filas) | **1,36 ms** | 1,88 ms |
| Bloque de respuesta con las 3.000 filas (estrés) | 7,92 ms | 9,64 ms |
| Clasificador «sin experiencia» en memoria con 3.000 filas (solo cliente) | 38,1 ms | 43,6 ms |

- **RSS:** 98,5 MB antes y 104,1 MB después de 1.000 peticiones, **+5,6
  MB**: estable (#123: +4,7 MB).
- La petición de jornada no crea objetos `Intl` ni otros objetos pesados
  por fila: reutiliza las mismas funciones que las páginas del #123.
- La caché de intención pasa de 8 a 14 entradas (10 páginas + 4). Cada
  entrada es la primera página de 60 filas sin detalle.

**Filtro SQL con 3.000 filas** (mediana de 15):

| Filtro | Total | Mediana |
|---|---:|---:|
| CO fines de semana | 300 | 54,9 ms |
| CO medio tiempo | 172 | 64,1 ms |
| CO temporada | 93 | 56,8 ms |
| CO remoto | 500 | 81,9 ms |
| CO sin experiencia (descripciones) | 1.250 | 252,7 ms |
| Cali sin experiencia | 250 | 108,8 ms |
| Medellín sin experiencia | 0 | 47,4 ms |
| Hub de Bogotá (referencia) | — | 43,3 ms |

Las páginas de jornada solo leen el título: cuestan como el hub
(+11–21 ms), no como «sin experiencia».

**Resultado: SIW-062 OK** (< 10 ms por petición, RSS estable).

## 4. Drift local (SIW-060) y TTFB en frío (SIW-061)

**Cómo se midió:** `npm run drift:intent-pages`, sobre la misma base
desechable servida primero por un worktree de `origin/main@db0c31e` (con
su propio build) y después por esta rama. Cambios en el script:
- siembra filas sintéticas `drift-` (Medellín sin experiencia, fines de
  semana, medio tiempo, temporada, Puerto Ordaz y Ciudad Guayana) y las
  borra al final;
- toma la foto SEO en una pasada caliente, tras leer el sitemap. Así se
  ven los enlaces «Búsquedas populares» de los hubs y las vacantes
  relacionadas de una vacante;
- compara también `intentLinks` y `relatedJobs`;
- mide el TTFB aislado: un proceso nuevo por URL, primera petición, 5
  repeticiones alternando base y rama.

**Sin ningún cambio:**
- `/` y `/ve`;
- `/dashboard`;
- `/empleos/caracas`;
- `/empleos/remoto` (copia congelada hasta el 2026-11-26) y
  `/ve/empleos/remoto`;
- `/ve/empleos/project-manager`;
- `/empleos/sin-experiencia` y `/empleos/bogota/sin-experiencia`;
- una vacante de Bogotá;
- `/ve/empleos/fines-de-semana` (404 en las dos).

**Con cambios, todos intencionales (excepciones de SIW-060):**
- **Hubs de Bogotá, Medellín y Cali:** solo `intentLinks`. Ganan los
  enlaces a fines de semana, medio tiempo y temporada, y Medellín a su
  página sin experiencia, porque en el fixture son indexables. Título,
  meta, canonical, robots, H1, JSON-LD y H2 son idénticos.
- **`/empleos/ciudad-guayana`:** title, H1 y meta nombran Puerto Ordaz, y
  el JSON-LD (`ItemList`) lista sus vacantes. Canonical, robots y H2 no
  cambian.
- **`/empleos/medellin/sin-experiencia` y `/empleos/cali/sin-experiencia`:**
  antes eran el hub con canonical al hub; ahora son páginas propias. Cali
  queda `noindex,follow` porque en el fixture no tiene vacantes sin
  experiencia.
- **`/empleos/fines-de-semana`, `/empleos/medio-tiempo` y
  `/empleos/temporada`:** pasan de 404 a 200, con la copia D4 y H2 propios
  («Vacantes de fines de semana recientes en Colombia»…). La primera
  corrida del drift mostró H2 genéricos («Vacantes recientes de Fines de
  semana»); se corrigió y se añadió una prueba.
- **Vacante de Ciudad Guayana:** solo `relatedJobs`, que ahora incluye
  vacantes de Puerto Ordaz (design D6). Su título, meta, canonical, robots,
  JSON-LD y migas no cambian.

**TTFB en frío aislado (mediana de 5, ms):**

| URL | main | rama | Δ |
|---|---:|---:|---:|
| `/dashboard` | 64 | 58 | −9 % |
| `/empleos/bogota` | 98 | 86 | −12 % |
| `/empleos/medellin` | 88 | 84 | −5 % |
| `/empleos/cali` | 91 | 81 | −11 % |
| `/empleos/caracas` | 88 | 83 | −6 % |
| `/empleos/ciudad-guayana` | 88 | 84 | −5 % |
| `/empleos/remoto` | 91 | 85 | −7 % |
| Vacante de Bogotá | 85 | 82 | −4 % |

- **SIW-061 OK:** ninguna URL empeora.
- En cada par la rama corre segunda. Por eso puede llevar una pequeña
  ventaja de caché del sistema operativo, que explicaría que todas las
  diferencias sean negativas. Lo que se puede afirmar es que no hay
  regresión, no que la rama sea más rápida.
- El TTFB de 21 URL en el mismo proceso (método del #123) dio ±30 % entre
  dos corridas idénticas, así que no sirve para un umbral del 10 %. Por eso
  se añadió la medición aislada.
- **Pendiente tras desplegar:** el TTFB MISS en producción frente al
  runbook y la memoria en Render.

## 5. Comandos (todos con código de salida 0, tras mezclar `main@db0c31e`)

- `npx tsc --noEmit`
- `npm run build`
- `npm run test:unit`, que incluye `validate-intent-wave2.test.ts`.
- `npm run test:seo`: 169 comprobaciones, entre ellas la paridad SQL =
  memoria de jornada (60 casos), SIW por HTTP y el rollback.
- `npm run test:dashboard-filters`
- `npm run test:companies-search`
- `npm run bench:intent-pages`
- `npm run drift:intent-pages`
- `npx eslint src/server.ts`: 0 errores. Se quitó la importación sin uso de
  `resolveCategorySlug`, que venía de `main`, y también `ResolvedCategory`,
  que este cambio dejó sin uso.
- **Preexistente, fuera de alcance:** `npx eslint src/lib/job-seo.ts` da 3
  errores `no-misleading-character-class` en la regex `EMOJI` (línea ~351),
  que este cambio no toca.
