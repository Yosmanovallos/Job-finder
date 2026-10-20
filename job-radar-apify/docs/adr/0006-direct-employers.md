# ADR 0006 — Empresas y vacantes oficiales (directo del ATS de cada empresa)

**Fecha:** 2026-10-19
**Estado:** aceptado · D1 y D2 desplegadas el 2026-10-19 (recolección en
producción; **nada visible en el sitio** hasta D4)
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
| D2 ✅ | Workflow `direct-employers-tick.yml` (tick cada 6 h; migración y seed solo por `workflow_dispatch`) + migración en producción. SmartRecruiters **habilitado por opt-in explícito del dueño el 2026-10-19** (ADR-0002 §2) |
| D3 | Descubrimiento de empresas (§7) |
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

## Consecuencias

- Volumen honesto de arranque (medido 2026-10-19): 185 vacantes oficiales
  vigentes en Colombia de 16 empresas (113 Greenhouse/Lever/Ashby + 72
  SmartRecruiters), todas con fecha del ATS (la más vieja, 28,5 días). El
  crecimiento depende de D3 y D5 (§7).
- Dos corpus en la base; **una sola vacante en el sitio**: la oficial
  reemplaza a sus copias de bolsas (§8, D4).
