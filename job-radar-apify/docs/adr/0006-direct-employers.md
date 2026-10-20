# ADR 0006 — Empresas y vacantes oficiales (directo del ATS de cada empresa)

**Fecha:** 2026-10-19
**Estado:** aceptado · D1 y D2 **desplegadas en producción** (2026-10-20:
migración, seed de 18 empresas y primer tick con 185 vacantes de Colombia);
D3 **en código, no desplegada** (2026-10-20, §7.1); **nada visible en el sitio** hasta D4
**Contexto:** pedido del dueño (2026-10-19): poblar BuscoTrabajo con las
vacantes que publican las empresas de Colombia en su propio portal, sin
mezclarlas con las que traen los scrapers de bolsas, con las empresas bien
organizadas y con salida a los 30 días.

## Problema

Todo lo que hay en `jobs` viene de bolsas intermediarias (LinkedIn,
Computrabajo, Elempleo, Magneto, Torre…). `/empresas` agrupa por el nombre
que escribe cada bolsa (`company_key`); no existe una entidad "empresa" con su
portal oficial. Las empresas publican sus vacantes en un ATS (Greenhouse,
Lever, Ashby, SmartRecruiters, Workday, SuccessFactors…) que expone un
listado público y **autoritativo**: si la vacante ya no está en el tablero, la
empresa la cerró. Ninguna bolsa da esa garantía.

Se evaluaron dos insumos previos y **no se adoptan como código**:

- `piloto-nacional-co/`: inventa fechas (`(idx % 9) + 1` días, `new Date()`),
  trae ~68 vacantes escritas a mano, IDs por posición (reabre el churn de URLs
  de `docs/SEO-PLAN.md` §9.2), rellena Colombia con vacantes de otros países y
  cuenta páginas de empresa de Magneto (una bolsa) como "directas". Solo se
  reutilizan sus **referencias de ATS** (tipo + slug), verificadas en vivo.
- `colombia_direct_ats_engine.py`: referencia de endpoints. Filtra `remote`
  mundial como Colombia, `cali` casa con "California", el JSON-LD fija
  `location="Colombia"` y no pagina.

## Decisión

### 1. Tablas propias, nunca `jobs`

Bloque aditivo `direct-employers` de `src/db/schema.sql` (lo aplica
`scripts/migrate-direct-employers.ts`, con `--dry-run`):

| Tabla | Qué guarda |
|---|---|
| `employers` | La empresa: `slug`, `display_name`, `company_key` (mismo builder `companyKeySql()`), dominio, NIT opcional, origen del descubrimiento |
| `employer_aliases` | `company_key` de cada forma en que las bolsas escriben a esa empresa → `employer_id`. Curado (como `company_reputation_alias`), nunca fuzzy. Es el puente que **organiza** también lo scrapeado |
| `employer_sources` | El tablero ATS de la empresa (`ats_type` + `ats_ref`), su URL pública, `enabled`, salud (`status`, último total, fallas seguidas) |
| `direct_jobs` | La vacante oficial: id externo estable del ATS, URL oficial de postulación, ciudad, modalidad, `published_at` **solo si el ATS la declara**, `valid_through`, `first_seen_at`/`last_seen_at`, `missing_count`, `closed_at` |

Las vacantes oficiales **no se insertan en `jobs`**: el `content_fingerprint`
las fundiría con la copia de LinkedIn y el `DISTINCT ON` de `getJobs*` las
colapsaría; además tocaría dashboard, sitemap, SSR e Indexing API. Sin FK ni
trigger hacia `jobs`. Las tablas nuevas llevan RLS sin políticas + `REVOKE`
para `anon`/`authenticated`, igual que el resto.

La unión con lo scrapeado es solo de lectura y por `employer_aliases`.

### 2. Vigencia: la misma regla de 30 días (ADR 0005), aplicada en lectura

`liveDirectJobSql()`: abierta (`closed_at IS NULL`) **y** fecha efectiva
`COALESCE(published_at, first_seen_at)` dentro de 30 días **y** `valid_through`
nulo o futuro.

- Ingesta: no se guarda una vacante cuya fecha declarada por el ATS tenga más
  de 30 días o cuyo `valid_through` ya pasó.
- **Una fila que el tablero sigue listando nunca se borra** (solo deja de
  verse al cumplir 30 días). Así el upsert por `(employer_source_id,
  external_id)` no puede resucitarla con fecha nueva: es la lección de §9.2.
- Purga: borra solo filas **cerradas** (ausentes del tablero).

### 3. Cierre: solo con evidencia completa

- Se cierra una vacante cuando falta en **2 listados completos seguidos**
  (`missing_count >= 2`), mismo criterio de dos señales que
  `validate-source-closure`.
- **Link muerto = cierre inmediato** donde el ATS tiene endpoint por vacante
  (Greenhouse, Lever): en la primera ausencia se consulta esa vacante y un
  404/410 la cierra en ese tick (máx. 25 consultas por tablero). Medido
  2026-10-19: los 185 links oficiales vigentes respondían 200; un id
  inexistente da 404 en Greenhouse/Lever, 400 en SmartRecruiters (no es
  prueba de cierre) y **200 en Ashby** (SPA): por eso Ashby y SmartRecruiters
  solo cierran por listados.
- Un listado cuenta solo si fue completo: HTTP 200, forma válida y todas las
  páginas leídas. Error, timeout o página faltante = no se toca nada.
- Si el total del tablero **o su subconjunto de Colombia** cae a 0 o a menos
  del 20 % del anterior (con ≥ 10 antes), el tablero queda `suspect` y no se
  cierra nada: probable cambio de ATS, de API o de formato de ubicación
  ("Remote - Colombia" → "Remote, CO"), no N cierres.
- La misma caída en 3 listados seguidos se acepta como real (la empresa sí
  cerró esas vacantes): la guardia retrasa cierres, no congela un tablero.
- `ats_type`, `status` y `discovery_origin` solo tienen CHECK de formato; sus
  valores los valida la app. Así sumar Workday/SuccessFactors (D5) nunca
  exige `DROP CONSTRAINT` sobre una tabla de producción.

### 4. Filtro Colombia: explícito o nada

- Primero el campo estructurado (`country` de Lever/SmartRecruiters, país de
  la dirección en Ashby). Si dice otro país, no entra.
- Si no hay campo, texto con límites de palabra y sin tildes: "colombia" o una
  ciudad colombiana no ambigua (`cali` no casa con "California"; Armenia,
  Cartagena, Palmira o Rionegro solo si el segmento dice Colombia).
- Multi-ubicación (`"Remote - Brazil; Remote - Colombia"`) se evalúa por
  segmento. "LATAM", "Americas" o remoto mundial **no** entran.
- Modalidad solo si el ATS la declara (campo o texto "remote/híbrido");
  si no, `NULL` (nunca se asume presencial).

### 5. Fuentes por fases

| Fase | Contenido |
|---|---|
| D1 ✅ | Esquema, Greenhouse, Lever, Ashby (APIs públicas documentadas) y SmartRecruiters; tick con `--dry-run`; BD local; pruebas |
| D2 ✅ (desplegada 2026-10-20) | Workflow `direct-employers-tick.yml` (tick cada 6 h; migración y seed solo por `workflow_dispatch`) + migración en producción. SmartRecruiters **habilitado por opt-in explícito del dueño el 2026-10-19** (ADR-0002 §2) |
| D3 | Descubrimiento de empresas (§7, decisión en §7.1). Meta del dueño (2026-10-20): cubrir el 100 % de las empresas de Colombia que publiquen vacantes en un portal propio — medido por vía y con denominador explícito, nunca afirmado sin evidencia |
| D4 | **Prioridad oficial sobre bolsas sin duplicados** (§8) y luego visibilidad en dashboard y `/empresas/:slug`. Hasta D4 nada de esto se muestra en el sitio |
| D5 | Conectores por cobertura medida (§7): Workday CXS, SuccessFactors (sitemap + microdatos `datePosted`), Phenom, Gupy, Eightfold, Teamtailor — cada uno tras revisión `source-researcher` de robots/términos |

Magneto (incluidas sus páginas de empresa) sigue siendo una **bolsa** — con
una pregunta abierta: para Éxito, Claro, Colombina o Vanti la página de
Magneto **es** el portal al que enlaza su propio sitio (§7).

### 7. Descubrimiento a escala (medido 2026-10-19, evidencia para D3/D5)

| Vía | Resultado medido |
|---|---|
| Nombres del directorio de producción (9.663 empresas) → slug en Greenhouse/Lever/Ashby/SmartRecruiters | Top 300 empresas: **10** con tablero público y vacantes en Colombia (~3 %). Útil pero no cubre a los grandes |
| Huella del sitio de la empresa (dominio sale del `logoUrl` del directorio) | Top 100: Phenom 5, Workday 4, Magneto 4, SuccessFactors 3, Gupy 2, Eightfold/iCIMS/Ashby/Teamtailor 1; 18 sitios bloquean bots; ~40 % del top son agencias de empleo (Adecco, Manpower, cajas) sin "portal oficial" propio |
| Common Crawl CDX (CC-MAIN-2026-39) | Workday: ≥281 tenants en la 1.ª página; SmartRecruiters 597 slugs; Lever 27; **Greenhouse y Ashby ~0** (bloquean al crawler) |
| Bancolombia (SuccessFactors) | `sitemap.xml` permitido por robots: 147 vacantes, 44 de Colombia (`-COL` en la URL); cada página trae `datePosted` |

Conclusión: no existe una vía gratuita única para "todas las empresas". El
embudo de D3 es: candidatos (directorio de producción + datos.gov.co + Common
Crawl) → huella de ATS → verificación automática (tablero con ≥ 1 vacante que
nombre Colombia **y** nombre de empresa coincidente donde el ATS lo da) →
`employer_sources` habilitado. Corre por lotes acotados en GitHub Actions. El
volumen grande llega con D5 (Workday/SuccessFactors/Phenom), no con más
slugs de Greenhouse.

### 7.1 Decisión D3 (2026-10-20, tras revisión `architect` + `data-quality-reviewer` + `source-researcher`)

Medido al diseñar: el directorio de producción **no tiene dominio** para casi
ninguna empresa. El `logoUrl` sale de `COMPANY_LOGO_DOMAINS`
(`src/data/company-logo-domains.ts`), un mapa curado a mano de ~80 nombres;
`jobs` no guarda el sitio de la empresa. Las cifras del top 100 de arriba son
de esa parte curada y no se extrapolan. Por eso la huella del sitio **no**
puede ser la vía principal.

- **Candidatos**: empresas del directorio de Colombia (`jobs` vigentes,
  `country = 'CO'` o remotas), en orden descendente de vacantes, sin nombres
  de relleno (`isPlaceholderCompanyKeySql`). datos.gov.co queda como
  **denominador** externo (pendiente), no como fuente de dominios. Common
  Crawl se pospone (Greenhouse/Ashby ~0 en CDX).
- **Vía 1 — nombre en el ATS** (escala sin dominio). Slugs deterministas
  derivados del nombre. Habilita sola **solo** en Greenhouse
  (`/v1/boards/{token}` declara `name`) y SmartRecruiters
  (`company.name`), y solo si: nombre declarado con el mismo `company_key`
  que el candidato, clave de ≥ 4 caracteres y no genérica, candidato que no
  es agencia (lista curada `data/direct-discovery-agencies.json`), listado
  completo y ≥ 1 vacante vigente en Colombia (la "señal Colombia"). Un
  acierto en Lever o Ashby (no declaran nombre) va a `needs_review`.
- **Vía 2 — sitio propio**, solo con dominio respaldado por evidencia (hoy
  el mapa curado). Reglas en `docs/source-catalog/site-probe-ats-links.md`:
  robots.txt (RFC 9309), nunca evadir bloqueos, no seguir dominios ajenos,
  redirects revisados salto a salto, cuerpo ≤ 2 MB, solo hrefs como
  evidencia. Un link desde el sitio a Greenhouse/Lever/Ashby/SmartRecruiters
  con ≥ 1 vacante vigente en Colombia verifica; a un ATS sin conector
  (Workday, SuccessFactors, Buk, Gupy…) queda solo como evidencia para D5;
  a Magneto, en su propio estado (pregunta abierta).
- **Dominios**: se miden antes de adivinarlos — modo de solo lectura
  `domain-census` del workflow (hosts de ATS, sitios y dominios de correo
  mencionados en las vacantes por empresa). Un dominio adivinado
  (`{clave}.com.co`) nunca habilita nada.
- **Nunca sobrescribe**: el descubrimiento solo inserta
  (`ON CONFLICT DO NOTHING`). Un tablero que ya tiene dueño no se reasigna,
  un slug existente con otra `company_key` no se renombra, un alias de otra
  empresa no se toma: todo eso va a `needs_review`. `employers` /
  `employer_sources` solo reciben candidatos `verified`; lo no verificado y
  los ATS sin conector viven solo en `employer_discovery`.
- **Reversión blanda**: `rejected` (decisión humana) es pegajoso — re-correr
  el descubrimiento no lo reabre. Revertir = `enabled = false` + retirar el
  alias, con constancia en `employer_discovery`. Nunca `DELETE employers`
  (cascada + purga de cerradas a 1 día).
- **Cobertura por vía**, nunca un solo porcentaje: cada candidato guarda
  `name_probe_status` y `site_probe_status` por separado. "No encontrado por
  nombre" no es "sin portal"; `no_portal` solo existe tras leer un sitio con
  dominio con evidencia. El reporte muestra la fracción sondeada y el grupo
  `no_domain` a propósito, por empresas y ponderado por vacantes.
- **Capacidad del tick**: con N tableros habilitados cada uno se lee cada
  ⌈N / 50⌉ × 6 h. El descubrimiento tiene tope de habilitaciones por
  corrida y el reporte muestra el `last_ok_at` más viejo; subir el tope del
  tick es una decisión aparte.
- **Aislamiento**: una prueba recorre el grafo de imports desde
  `src/server.ts` y falla si llega a `src/direct/**` o a
  `src/db/direct-*` (§9).

### 8. Prioridad: la vacante oficial gana y no se repite (requisito del dueño)

Medido 2026-10-19 contra producción (API pública): de 131 vacantes de bolsas
de estas 17 empresas, **63 son copia de una oficial** (mismo título; casi
todas LinkedIn) y 95 de las 185 oficiales ya estaban vía bolsas. Mostrar las
oficiales aparte duplicaría. Diseño para D4 (requisito previo a mostrar nada):

- Coincidencia: misma empresa **vía `employer_aliases`** (la bolsa escribe
  "Sezzle LA") + mismo `title_key` (título normalizado). La ciudad solo
  desempata si la empresa tiene ese título en varias ciudades. Nunca
  fuzzy-match: un título distinto es otra vacante.
- La vacante oficial vigente **reemplaza** a sus copias de bolsas en toda
  lectura pública (dashboard, búsqueda, SSR, sitemap, `/empresas`): la fila de
  bolsa no se borra (evita churn al re-scrapear), queda marcada como
  superada y deja de listarse. Cómo obtiene la oficial su propia página de
  detalle (y qué pasa con la URL ya indexada de la copia, respetando el
  flujo de tombstones 410 / Indexing API) lo decide D4.
- El enlace de postulación es siempre el del portal de la empresa.
- Toda lectura pública exige además `employer_sources.enabled`: un tablero
  apagado (p. ej. por un rechazo de D3, §7.1) deja de leerse en el tick, así
  que sus vacantes abiertas nunca se cerrarían y seguirían "vigentes" hasta
  30 días. Cerrarlas al rechazar no sirve (la purga las borraría al día).
- Se mide el dashboard en frío contra `DASHBOARD-PERFORMANCE-RUNBOOK.md`
  antes de desplegar (invariante protegido).

### 9. Seguridad operativa

- El servidor web nunca importa `src/direct/` (lección del OOM del
  2026-07-25). Todo corre en scripts.
- `run-direct-tick.ts`, `seed-direct-employers.ts` y `direct-report.ts`
  rechazan cualquier `DATABASE_URL` que no sea loopback salvo
  `--allow-remote-db` explícito (la `.env` del checkout principal es
  producción).
- Presupuestos: tope de tableros por tick, concurrencia 3, timeout 15 s por
  request, tope de páginas por tablero, cuerpo máximo 15 MB.
- Ninguna URL oficial entra al presupuesto de la Indexing API hasta decidirlo.

### 10. Enmienda D4 (2026-10-20): proyección materializada en `jobs`

**Enmienda a §1** ("nunca `jobs`"). Requisito del dueño: las oficiales se ven
con *exactamente* los mismos componentes, filtros, sitemap y JSON-LD que las
de bolsas, sin regresión de performance en frío. Unirlas en cada lectura
(`jobs UNION direct_jobs` + anti-join de copias) tocaría todas las consultas
calientes. En su lugar el tick **materializa** una proyección: `direct_jobs`
sigue siendo la fuente de verdad y `jobs` recibe una copia de lectura que el
tick escribe y borra. Las consultas públicas no cambian (ya filtran por
`is_active = TRUE AND liveJobSql()`). Revisado por `data-quality-reviewer`
(2026-10-20: aprobado con cambios, todos incorporados abajo).

1. **Identidad estable.** `jobs.id = jobs.direct_job_id = direct_jobs.id`;
   `url_hash = content_fingerprint = sha256("direct:" + id)`. **Nunca** el hash
   de la URL de postulación (una bolsa puede llevar esa URL y algunas cambian
   con el título) ni el fingerprint real (el índice único parcial de
   fingerprints haría que `saveJobs()` fundiera la bolsa en la oficial o que el
   INSERT chocara con una copia activa). Upsert por `id`.
2. **Campos.** Solo lo que el ATS declara: `url` = URL oficial (el botón
   "Aplicar" lleva al portal de la empresa), `source = sources = "Portal
   oficial"`, `country = 'CO'`, `location` = ciudad + ", Colombia" o solo
   "Colombia" (sin ciudad inventada: esa fila se ve pero no es apta para
   Google), `remote_type`/`applicant_countries = ['CO']` solo si el ATS dijo
   remoto, `detail_status` = `complete` o `unsupported`. `company =
   display_name` del empleador, **fijo al insertar** (su `company_key` ya es
   alias): un ranking de grafías cambiaría entre ticks.
3. **Fechas.** `published_at = COALESCE(direct.published_at,
   direct.first_seen_at)` al insertar; después solo puede moverse hacia atrás
   (`LEAST`), nunca a NOW() (§9.2 de SEO-PLAN). `last_seen_at = NOW()` en cada
   tick para toda proyección viva (si no, `purgeOldJobs` la borraría viva).
4. **Qué se proyecta.** `liveDirectJobSql()` con `employer_sources.enabled`.
   No se consulta `expired_job_urls`: la vigencia la decide `direct_jobs`, y
   una vacante reabierta (falso cierre, tablero re-encendido) debe volver con
   el **mismo id**. Por eso las oficiales cerradas se conservan 30 días en
   `direct_jobs` (antes 1): reaparecer reabre la misma fila, con su
   `first_seen_at` original. Venezuela no se toca.
5. **Salida.** Proyección cuya oficial ya no está vigente o cuyo tablero se
   apagó → `deleteClosedJobs()` (lápida 410; `URL_DELETED` solo si Google la
   recibió por la API, que no ocurre). La edad la cubre también
   `purgeOldJobs()`.
6. **Copias (§8).** Fila activa de bolsa, no proyección, `country = 'CO'` **o
   NULL** (remotas: si no, la copia más nueva taparía a la oficial en el
   DISTINCT ON), con `company_key` en `employer_aliases` del empleador y el
   mismo `title_key` (la clave del trigger, igual a la de dedupe; nada fuzzy).
   La ciudad (`location_key`) desempata solo si la empresa tiene ese título en
   varias ciudades; una copia ambigua (país o remoto) se deja. Se oculta con
   `is_active = FALSE` + `superseded_by` en el **mismo** UPDATE
   (`mutateReadinessRelevantJobs`, que ahora admite ambas columnas). No se
   borra; `saveJobs()` no toca `is_active` y ahora funde un re-scrape con URL
   nueva en la copia oculta en lugar de insertar otra activa. El scrape tick
   corre el mismo paso al terminar (la copia nueva no espera una hora).
   **Regla única de reversión**, barrido idempotente en cada tick, sin importar
   quién borró la proyección: una copia cuya proyección ya no existe vuelve
   (`is_active = TRUE`, `superseded_by = NULL`, `source_checked_at = NULL` para
   que el cierre en la fuente la re-verifique) solo si su bolsa la vio en las
   últimas 48 h y no hay otra fila activa con su fingerprint; una por
   transacción (un choque de unicidad la pospone, no revierte el lote). Una
   copia más vieja queda oculta: su URL responde 410. `migrate-dedupe.ts`
   excluye proyecciones y copias.
7. **SEO.** `/empleos/:idCopia` responde **301** a su proyección viva (se
   revisa antes de 404/410), **410** si la oficial cerró; nunca 404.
   `/api/jobs/:idCopia` devuelve la oficial. La proyección pasa el gate de
   Google (`seo_ready`: sitemap y JSON-LD `JobPosting`) con `notify: false`:
   **no** encola `URL_UPDATED`, y el reconcile horario de la cola excluye
   `direct_job_id IS NOT NULL` (§9). Efecto: `seo_ready_at` queda fijado sin
   notificar; si el dueño habilita la Indexing API para oficiales, hará falta
   un backfill explícito.
8. **Aislamiento.** Código en `src/db/direct-projection-repository.ts`, llamado
   solo por `scripts/run-direct-tick.ts` y `scripts/run-scrape-tick.ts`; el
   servidor no lo importa (la prueba del grafo cubre `src/db/direct-*`). El
   servidor solo gana la lectura de `superseded_by` (`getSupersedingTarget`).
9. **Esquema.** Bloque aditivo `direct-projection`: `jobs.direct_job_id UUID
   NULL`, `jobs.superseded_by UUID NULL` (sin FK: la proyección se borra y la
   reversión es explícita) e índices parciales `WHERE … IS NOT NULL`. `ADD
   COLUMN` nullable es solo metadatos en PostgreSQL 16. Lo aplica
   `migrate-direct-employers.ts` (con `--dry-run`).
10. **Pruebas.** `tests/validate-direct-projection.ts` (Postgres desechable):
    proyección, copias ocultas y restauradas, 301/410, re-scrape sin copia
    activa nueva, reapertura con el mismo id, cero `URL_UPDATED` oficiales,
    Venezuela intacta, idempotencia.

## Consecuencias

- Volumen honesto de arranque (medido 2026-10-19): 185 vacantes oficiales
  vigentes en Colombia de 16 empresas (113 Greenhouse/Lever/Ashby + 72
  SmartRecruiters), todas con fecha del ATS (la más vieja, 28,5 días). El
  crecimiento depende de D3 y D5 (§7).
- Dos corpus en la base; **una sola vacante en el sitio**: la oficial
  reemplaza a sus copias de bolsas (§8, D4).
