# ADR 0006 — Empresas y vacantes oficiales (directo del ATS de cada empresa)

**Fecha:** 2026-10-19
**Estado:** aceptado · Fase D1 implementada en `codex/direct-employers` · **no
desplegado** (solo local hasta aprobación explícita)
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
| **D1 (esta)** | Esquema, Greenhouse, Lever, Ashby (APIs públicas documentadas) y SmartRecruiters (implementado, **`enabled = false`** por ADR-0002 hasta opt-in del dueño); tick con `--dry-run`; BD local; pruebas |
| D2 | Workflow de GitHub Actions + migración en producción (requiere aprobación) |
| D3 | Descubrimiento de empresas (datos.gov.co, Common Crawl CDX, huella de ATS) |
| D4 | Sección "Vacantes en su portal oficial" en `/empresas/:slug` |
| D5 | Workday CXS, SuccessFactors/sitemap + JSON-LD, Buk — cada uno tras revisión `source-researcher` de robots/términos |

Magneto (incluidas sus páginas de empresa) sigue siendo una **bolsa**.

### 6. Seguridad operativa

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

- Volumen honesto de arranque (medido 2026-10-19): ~150 vacantes en Colombia en
  11 tableros Greenhouse/Lever/Ashby; ~630 más en 7 de SmartRecruiters si se
  habilita. El crecimiento depende de D3 (descubrir qué empresa usa qué ATS) y
  D5 (Workday/SuccessFactors, donde están los grandes empleadores colombianos).
- Dos corpus separados: un mismo puesto puede verse en una bolsa y en el
  portal oficial; en UI el oficial lleva su propio sello y enlace directo.
