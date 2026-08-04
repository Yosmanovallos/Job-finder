-- =============================================================================
-- ESQUEMA DE BASE DE DATOS SQL (Job Radar PostgreSQL / Supabase)
-- =============================================================================

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tabla `jobs`: Almacenamiento central de vacantes deduplicadas
CREATE TABLE IF NOT EXISTS jobs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url_hash      VARCHAR(64) UNIQUE NOT NULL,      -- SHA-256 de la URL normalizada
    content_fingerprint VARCHAR(64),                 -- SHA-256 de (title+company+location) normalizado, dedup secundaria
    title         VARCHAR(500) NOT NULL,
    company       VARCHAR(255) DEFAULT 'Confidencial',
    location      VARCHAR(255),
    url           TEXT NOT NULL,
    source        VARCHAR(100) NOT NULL,            -- Fuente primaria (ej. 'LinkedIn')
    sources       JSONB DEFAULT '[]'::jsonb,         -- Array de fuentes deduplicadas (ej. ["LinkedIn", "Computrabajo"])
    date_text     VARCHAR(100),
    published_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Bumped on every re-scrape that still finds this URL (ON CONFLICT in
    -- saveJobs()). created_at never changes after first insert, so it can't
    -- tell "still live" from "first seen 29 days ago" — purgeOldJobs() uses
    -- this column instead, so a job that's still genuinely posted doesn't
    -- get deleted-and-reinserted-with-a-new-id every 30 days (see
    -- docs/SEO-PLAN.md §9.2 for the URL-churn bug this fixes).
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    role_origin   VARCHAR(255),                     -- Rol que la encontró (ej. "analista de datos")
    is_active     BOOLEAN DEFAULT TRUE
);

-- Country as a first-class data dimension (Venezuela expansion,
-- backlog/venezuela-expansion.md Día 1). ISO 3166-1 alpha-2, e.g. 'CO'/'VE'.
-- NULL means remote (mirrors the existing "Remoto" pseudo-city convention in
-- CITY_OPTIONS/job-filters.ts) — remote jobs are meant to surface for every
-- country, so NULL is a permanent value here, never a "not yet migrated"
-- placeholder. See scripts/migrate-country.ts for the one-time backfill of
-- pre-existing rows (must NOT blindly stamp every row 'CO' — that would
-- destroy the shared-remote behavior by mislabeling remote jobs as Colombia
-- only).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS country VARCHAR(2);
CREATE INDEX IF NOT EXISTS idx_jobs_country ON jobs (country);

-- Older deployments created this column with DEFAULT 'Colombia'. saveJobs()
-- always passes `location` explicitly (job-repository.ts), so the default
-- never actually fired from that path — but leaving it in place would let a
-- future direct INSERT silently mislabel a Venezuela row as Colombia. Drop
-- is idempotent (no-op if the column already has no default).
ALTER TABLE jobs ALTER COLUMN location DROP DEFAULT;

-- Índices de alto rendimiento para Paywall y Consultas Instantáneas
CREATE INDEX IF NOT EXISTS idx_jobs_published_at ON jobs (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_url_hash ON jobs (url_hash);
CREATE INDEX IF NOT EXISTS idx_jobs_sources ON jobs USING GIN (sources);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at DESC);
-- Predicate must match the index created by scripts/migrate-dedupe.ts
-- (also scoped to is_active = TRUE) — otherwise a deactivated row still
-- occupies the index and a later re-scrape of the same posting (new
-- url_hash, same fingerprint) hits an unhandled unique violation instead
-- of the intended ON CONFLICT (url_hash) merge path.
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_content_fingerprint
  ON jobs (content_fingerprint) WHERE content_fingerprint IS NOT NULL AND is_active = TRUE;

-- 2. Tabla `search_roles`: Monitoreo de 200+ roles y sinónimos
CREATE TABLE IF NOT EXISTS search_roles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) UNIQUE NOT NULL,
    synonyms    JSONB DEFAULT '[]'::jsonb,
    is_active   BOOLEAN DEFAULT TRUE,
    last_run_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabla `users`: Gestión de cuentas y suscripciones (Freemium / Pro)
CREATE TABLE IF NOT EXISTS users (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email             VARCHAR(255) UNIQUE NOT NULL,
    name              VARCHAR(255),
    subscription_tier VARCHAR(20) DEFAULT 'free',   -- 'free' | 'pro'
    subscription_end  TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Roles de interés recolectados en el paso de onboarding post-registro
-- (ver ¿Qué puestos estás buscando?). NULL = onboarding aún no completado;
-- un array (incluso vacío) = el usuario ya pasó por ese paso. ADD COLUMN IF
-- NOT EXISTS es idempotente, así que es seguro añadirlo aquí en vez de un
-- script de migración aparte.
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_roles JSONB DEFAULT NULL;
ALTER TABLE users ALTER COLUMN preferred_roles SET DEFAULT NULL;

-- 4. Tabla `social_posts`: Historial y estado de publicaciones en redes sociales
CREATE TABLE IF NOT EXISTS social_posts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID REFERENCES jobs(id) ON DELETE CASCADE,
    platform    VARCHAR(50) NOT NULL,               -- 'twitter' | 'instagram' | 'facebook' | 'tiktok'
    post_id     VARCHAR(255),
    status      VARCHAR(20) DEFAULT 'pending',       -- 'pending' | 'posted' | 'failed'
    posted_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts (status) WHERE status = 'pending';

-- 5. Tabla `transactions`: Historial de pagos Wompi, idempotencia de webhooks
CREATE TABLE IF NOT EXISTS transactions (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reference            VARCHAR(255) UNIQUE NOT NULL,     -- Referencia generada por nosotros
    wompi_transaction_id VARCHAR(255) UNIQUE,               -- ID de Wompi, llega en el webhook
    status               VARCHAR(20) DEFAULT 'pending',     -- 'pending' | 'approved' | 'declined' | 'error'
    amount_in_cents      BIGINT NOT NULL,
    currency              VARCHAR(10) NOT NULL,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_reference ON transactions (reference);

-- 6. Tabla `role_source_runs`: última corrida por (rol, fuente) — permite
-- cadencia distinta por fuente en vez de por rol (search_roles.last_run_at
-- no alcanza para eso). También se reusa con role_name = '__global__' para
-- fuentes de catálogo completo (RemoteOK, GetOnBoard, WeRemoto, Jooble) que
-- ignoran el rol/keywords y se corren una sola vez por ventana, no una vez
-- por cada uno de los ~30 roles activos.
CREATE TABLE IF NOT EXISTS role_source_runs (
    role_name    VARCHAR(255) NOT NULL,
    source_name  VARCHAR(100) NOT NULL,
    last_run_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (role_name, source_name)
);

-- 7. Tabla `source_circuit_state`: circuit breaker persistido entre corridas.
-- Cada tick de GitHub Actions es un proceso Node nuevo — un breaker en
-- memoria (como el anterior) olvida cualquier bloqueo apenas termina el
-- proceso, así que una fuente con 403 real se reintenta desde cero en cada
-- tick de 15 min para siempre. Persistiendo aquí, 3 fallos consecutivos
-- abren el circuito por DEGRADED_TIMEOUT_MS real (ver resilient-fetch.ts),
-- across ticks, no solo dentro de uno.
CREATE TABLE IF NOT EXISTS source_circuit_state (
    source_name  VARCHAR(100) PRIMARY KEY,
    failures     INTEGER NOT NULL DEFAULT 0,
    open_until   TIMESTAMPTZ
);

-- 8. Tabla `indexing_queue`: cola de notificaciones a la Google Indexing API
-- (SEO Fase 3). Guarda la URL ya resuelta, no el job_id — para URL_DELETED,
-- la fila de `jobs` que le dio origen ya no existe para el momento en que se
-- envía (purgeOldJobs() la borró), así que no hay FK que recalcular la URL
-- a partir de un id. `status='sent'` en las últimas 24h es lo que
-- run-indexing-tick.ts usa para no exceder la cuota diaria de Google (200/día
-- por defecto) sin depender de un contador en memoria que un cron de 15 min
-- reiniciaría en cada corrida.
CREATE TABLE IF NOT EXISTS indexing_queue (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url                TEXT NOT NULL,
    notification_type  VARCHAR(20) NOT NULL,          -- 'URL_UPDATED' | 'URL_DELETED'
    status             VARCHAR(20) DEFAULT 'pending',  -- 'pending' | 'sent' | 'failed'
    error              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_indexing_queue_status ON indexing_queue (status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_indexing_queue_sent_at ON indexing_queue (sent_at) WHERE status = 'sent';

-- 9. Tabla `company_reputation`: reputación de empresas como empleador,
-- agregada de varias fuentes (docs/COMPANY-REPUTATION-PLAN.md, Fase R1).
-- Poblada por scripts/run-reputation-tick.ts, un proceso batch aparte del
-- scraping de vacantes (cadencia semanal/mensual, no cada 15 min — estos
-- rankings cambian con frecuencia anual/semestral). `company_name` es el
-- nombre EXACTO tal como lo publica esa fuente (nunca normalizado/adivinado
-- contra `jobs.company` aquí — ese matching curado a mano vive en la tabla
-- de alias que introduce la Fase R2, junto con el primer fetcher real).
-- `score_scale` es obligatorio porque las escalas de distintas fuentes NO
-- son comparables entre sí (índice Merco 0-10000 vs. rating Computrabajo
-- 1-5 vs. insignia binaria de GPTW) — nunca normalizar a un solo número.
-- `source_url` es obligatorio: es el link real de atribución que el UI
-- muestra en vez de renderizar el logo de la fuente (ninguna de las fuentes
-- con dato real autoriza su reuso, ver el plan).
CREATE TABLE IF NOT EXISTS company_reputation (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name  VARCHAR(255) NOT NULL,
    source        VARCHAR(50) NOT NULL,
    score         NUMERIC,
    score_scale   VARCHAR(50) NOT NULL,
    review_count  INTEGER,
    source_url    TEXT NOT NULL,
    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_name, source)
);

-- 10. Tabla `company_reputation_alias`: mapeo curado a mano entre el
-- nombre crudo de una empresa tal como aparece en `jobs.company` y el
-- nombre canónico que usa cada fuente de reputación (docs/COMPANY-
-- REPUTATION-PLAN.md, Fase R2). Nunca poblada por fuzzy-match automático
-- — cada fila representa una coincidencia confirmada a mano (ver
-- scripts/seed-merco-aliases.ts). `canonical_name` debe coincidir con
-- `company_reputation.company_name` para esa misma `source`; una empresa
-- sin fila aquí simplemente no tiene reputación mostrable.
CREATE TABLE IF NOT EXISTS company_reputation_alias (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_company_name  VARCHAR(255) NOT NULL,
    source            VARCHAR(50) NOT NULL,
    canonical_name    VARCHAR(255) NOT NULL,
    UNIQUE (raw_company_name, source)
);

CREATE INDEX IF NOT EXISTS idx_company_reputation_alias_raw_name ON company_reputation_alias (raw_company_name);

-- 11. Tabla `company_user_reviews`: reseñas de empleadores escritas por
-- usuarios registrados de BuscoTrabajo (Fase E2) — distinta de
-- `company_reputation`/`company_reputation_alias` arriba, que son fuentes
-- externas agregadas (Merco/GPTW/Computrabajo). La atribución en el UI es
-- siempre genérica ("Usuario verificado de BuscoTrabajo"), nunca el nombre
-- real ni una relación laboral que no podemos verificar (regla 5 de
-- AGENTS.md) — esa decisión vive en el componente que renderiza esto, no
-- en el schema. `company_name` sigue la misma convención de string exacto
-- que `company_reputation_alias.raw_company_name` (el valor tal cual
-- aparece en `jobs.company`, nunca normalizado/fusionado). `status`
-- soporta moderación manual vía SQL desde el día uno ('visible'/'hidden');
-- no hay panel de admin en v1. UNIQUE(user_id, company_name): una reseña
-- por usuario por empresa, reescribible, nunca acumulable.
CREATE TABLE IF NOT EXISTS company_user_reviews (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_name  VARCHAR(255) NOT NULL,
    rating        SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment       TEXT,
    status        VARCHAR(20) NOT NULL DEFAULT 'visible',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, company_name)
);

CREATE INDEX IF NOT EXISTS idx_company_user_reviews_company_name ON company_user_reviews (company_name) WHERE status = 'visible';

-- =============================================================================
-- ROW LEVEL SECURITY: every read/write from this app goes through the `pool`
-- (direct `pg` connection as the `postgres` role, which has BYPASSRLS — see
-- src/db/client.ts) or from GitHub Actions cron scripts using the same
-- connection string. The frontend's supabase-js client (anon key, browser)
-- is only ever used for supabase.auth.* (Supabase Auth/GoTrue), never to
-- query these tables directly. No table here has an anon/authenticated
-- PostgREST use case, so RLS is enabled with zero policies: PostgREST
-- (anon/authenticated roles) is denied by default, `postgres` is unaffected.
-- Without this, Supabase's PostgREST exposes every one of these tables —
-- including `users` and `transactions` — to anyone with the project URL and
-- the public anon key.
-- =============================================================================
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_source_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_circuit_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE indexing_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_reputation ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_reputation_alias ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_user_reviews ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth on top of the RLS-with-zero-policies block above: Supabase
-- grants anon/authenticated broad SELECT/INSERT/UPDATE/DELETE on every
-- `public` table by default (confirmed live via information_schema —
-- 2026-08-02 security audit). RLS alone already blocks all of that today
-- (verified with the real anon key: every table returns [] on SELECT, a
-- write attempt gets a clean 42501 RLS-violation, no schema leaked) — but it
-- is the ONLY thing blocking it. If anyone ever adds a single permissive RLS
-- policy to any one of these tables later (even by accident, e.g. via
-- Supabase Studio's "add policy" wizard while debugging something unrelated),
-- these pre-existing grants mean that table's data is immediately reachable
-- with the public anon key — no second gate catches the mistake. Explicitly
-- revoking removes that fallback exposure regardless of what RLS policies
-- exist later; `postgres` (this app's own connection, see src/db/client.ts)
-- has BYPASSRLS and is unaffected by any of this.
REVOKE ALL ON jobs, search_roles, users, social_posts, transactions,
  role_source_runs, source_circuit_state, indexing_queue, company_reputation,
  company_reputation_alias, company_user_reviews
  FROM anon, authenticated;
