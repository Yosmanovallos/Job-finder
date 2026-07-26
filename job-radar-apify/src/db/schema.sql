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
-- no alcanza para eso).
CREATE TABLE IF NOT EXISTS role_source_runs (
    role_name    VARCHAR(255) NOT NULL,
    source_name  VARCHAR(100) NOT NULL,
    last_run_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (role_name, source_name)
);
