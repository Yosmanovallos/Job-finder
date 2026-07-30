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
    location      VARCHAR(255) DEFAULT 'Colombia',
    url           TEXT NOT NULL,
    source        VARCHAR(100) NOT NULL,            -- Fuente primaria (ej. 'LinkedIn')
    sources       JSONB DEFAULT '[]'::jsonb,         -- Array de fuentes deduplicadas (ej. ["LinkedIn", "Computrabajo"])
    date_text     VARCHAR(100),
    published_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    role_origin   VARCHAR(255),                     -- Rol que la encontró (ej. "analista de datos")
    is_active     BOOLEAN DEFAULT TRUE
);

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
