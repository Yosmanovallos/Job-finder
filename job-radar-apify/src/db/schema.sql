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

-- Detalle enriquecido de la vacante (docs/LINKEDIN-DESCRIPTION-PLAN.md —
-- SUPERSEDED, ver nota al inicio de ese doc). Aditivo, todo nullable:
-- NULL siempre significa "no capturado", nunca se sintetiza un valor.
-- description/requirements/employment_type/applicant_count las escribe
-- saveJobs() (job-repository.ts) SOLO en el INSERT de una fila nueva
-- (para las fuentes que ya traen el dato en su propia respuesta — Torre/
-- RemoteOK/Remotive/GetOnBoard) o el enriquecimiento post-insert de
-- ScrapeWorker vía updateJobDetail() (para LinkedIn/Computrabajo/Magneto,
-- que necesitan un fetch aparte a la página de detalle) — nunca en el
-- UPDATE de una fila ya existente, así una vacante vieja jamás se
-- "completa" retroactivamente con datos que no vinieron con ella
-- originalmente.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS requirements JSONB DEFAULT '[]'::jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS technologies JSONB DEFAULT '[]'::jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS employment_type VARCHAR(50);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_min NUMERIC;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_max NUMERIC;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_currency VARCHAR(10);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_raw VARCHAR(255);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS applicant_count INTEGER;
-- Sin uso, a propósito (decisión 2026-08-12): reemplazadas por
-- salary_min/max/currency/raw arriba. No se borran hasta reconciliar
-- por completo con feat/vacantes-detalle — nullable, sin costo real.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary VARCHAR(100);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS description_fetched_at TIMESTAMPTZ;

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

-- Fase 1 de docs/RESUME-STUDIO-PLAN.md — flag por-usuario para el beta del
-- Resume Studio (Pilares A/B). DEFAULT false: nadie ve el nuevo flujo hasta
-- que se lo habilite explícitamente por fila; el kill-switch de despliegue
-- (RESUME_STUDIO_ENABLED, variable de entorno) apaga la feature para todos
-- sin importar esta columna, mismo patrón que PAYWALL_ENABLED en config.ts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS resume_studio_beta BOOLEAN NOT NULL DEFAULT false;

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

-- Corrección aditiva (Fase 10, docs/CV-GENERATION-PLAN.md §10): la tabla
-- se creó pensando en un único plan pagado (Pro). Con Pro Max agregando
-- un segundo monto/tier, el webhook necesita saber CUÁL plan pagó cada
-- transacción para subir al usuario al tier correcto (nunca "pro" a
-- secas) — `amount_in_cents` por sí solo no basta como esa señal porque
-- es un valor libre, no una clave. Default 'pro': toda fila creada antes
-- de esta columna (o por el checkout viejo, sin tocar) sigue siendo
-- correctamente un pago de Pro.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS plan VARCHAR(20) NOT NULL DEFAULT 'pro';

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

-- 11. Tabla `cv_profiles`: la hoja de vida base de cada usuario Pro/Pro Max
-- (docs/CV-GENERATION-PLAN.md §3.1/§9.3, Fase 0). Un solo perfil por
-- usuario — subir un CV nuevo reemplaza (UPSERT), nunca acumula versiones
-- viejas (`UNIQUE (user_id)`). `raw_text` es el texto ya extraído del
-- PDF/DOCX subido, acotado a 6.000 caracteres ANTES de llegar aquí (§7,
-- anti-abuso) — el `CHECK` es una segunda capa, no la única. `facts_json`
-- es la bóveda de hechos estructurada (`CvFacts`, §3.1) que la Etapa A
-- produce — nunca escrita a mano por otra ruta. Nullable: la subida
-- (Fase 2a, Etapa 0) inserta la fila con `raw_text` y `facts_json = NULL`;
-- la extracción real contra un modelo vivo (Fase 2b, Etapa A) rellena
-- `facts_json` después, en un UPDATE aparte — son dos pasos con historias
-- de verificación distintas (uno es plumbing, el otro es fidelidad de un
-- LLM) y no tenía sentido fingir el segundo con un cliente falso solo para
-- poder insertar la fila. El texto crudo y los hechos se borran por la
-- política de retención (§8.3: 30 días de gracia tras vencer la
-- suscripción sin renovar) o a solicitud explícita del usuario — ninguna
-- de las dos cosas vive en el schema, son jobs/rutas aparte que operan
-- sobre esta tabla.
CREATE TABLE IF NOT EXISTS cv_profiles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    raw_text    TEXT NOT NULL CHECK (char_length(raw_text) <= 6000),
    facts_json  JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id)
);
-- Corrección aditiva (Fase 2a, 2026-08-07): la tabla se creó en Fase 0 con
-- `facts_json JSONB NOT NULL`; idempotente re-ejecutar aunque ya esté
-- nullable.
ALTER TABLE cv_profiles ALTER COLUMN facts_json DROP NOT NULL;
-- Corrección aditiva (Fase 9, docs/CV-GENERATION-PLAN.md §8.3): el job de
-- limpieza por retención pone `raw_text = NULL` 30 días después de que
-- vence la suscripción sin renovar (ver cv-retention-repository.ts) —
-- necesita poder ser NULL. El CHECK de longitud no se toca: en Postgres
-- un CHECK sobre una columna NULL evalúa a NULL, no a false, así que una
-- fila con `raw_text = NULL` sigue pasando la restricción sin cambiarla.
ALTER TABLE cv_profiles ALTER COLUMN raw_text DROP NOT NULL;

-- 12. Tabla `cv_generations`: un CV generado/editado para una vacante
-- específica (docs/CV-GENERATION-PLAN.md §3.2/§9.5, Fase 0). `job_id` usa
-- `ON DELETE SET NULL`, no CASCADE — `jobs` purga filas viejas
-- (purgeOldJobs()) independientemente de si un usuario ya pagó créditos
-- por generar un CV para esa vacante; perder esa vacante del corpus no
-- debe borrar el CV que el usuario ya generó y puede seguir editando/
-- descargando. `job_title`/`job_company` son una copia fija tomada al
-- momento de generar, precisamente para que el CV siga teniendo contexto
-- legible aun si `job_id` queda NULL después. `model_option`
-- ('standard'|'premium'|'compare') y `credits_charged` quedan siempre
-- poblados — la cuota de Pro Y Pro Max se verifica igual, sumando
-- `credits_charged` (Pro cobra 1 por generación/regeneración; ver
-- src/cv/quota.ts y la corrección de Fase 4 en §6.2 — `COUNT(*)` de filas
-- no sirve para Pro porque `UNIQUE (user_id, job_id)` limita a una fila
-- por vacante sin importar cuántas veces se regenere).
-- `generated_document_json` es inmutable (lo que salió del pipeline);
-- `document_json` es el estado actual, mutado por cada guardado del
-- editor — Etapa F siempre renderiza este último. `UNIQUE (user_id,
-- job_id)` — reabrir "Ajustar CV" en la misma vacante siempre resuelve a
-- la misma fila (§9.2); los NULL de `job_id` tras una purga no chocan
-- entre sí (comportamiento estándar de UNIQUE en Postgres). "Inmutable"
-- arriba es sobre el pipeline normal (nunca lo pisa un guardado del
-- editor) — el job de retención (Fase 9, §8.3, cv-retention-repository.ts)
-- SÍ pone ambos campos en NULL 30 días después de vencer la suscripción
-- sin renovar; el resto de la fila (metadata de auditoría/cuota ya
-- cobrada) se conserva.
CREATE TABLE IF NOT EXISTS cv_generations (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_id                   UUID REFERENCES jobs(id) ON DELETE SET NULL,
    job_title                VARCHAR(500) NOT NULL,
    job_company              VARCHAR(255) NOT NULL,
    status                   VARCHAR(20) NOT NULL DEFAULT 'reserved', -- 'reserved' | 'completed' | 'failed'
    model_option             VARCHAR(20) NOT NULL,                   -- 'standard' | 'premium' | 'compare'
    credits_charged          INTEGER NOT NULL,
    generated_document_json  JSONB,
    document_json            JSONB,
    -- Fase 10 de docs/RESUME-STUDIO-PLAN.md — qué CvTemplateSpec usar al
    -- renderizar PDF/preview (src/cv/templates/*.ts). Nunca afecta
    -- document_json/generated_document_json ni dispara el pipeline de IA
    -- — cambiar de plantilla es puramente de presentación. Default
    -- explícito 'ats_classic' = el único layout que existía antes de
    -- esta fase, así que toda fila vieja renderiza EXACTAMENTE igual que
    -- siempre sin necesitar backfill.
    template_id              VARCHAR(50) NOT NULL DEFAULT 'ats_classic',
    edited_at                TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_cv_generations_user_created ON cv_generations (user_id, created_at DESC);

-- Fase 10 de docs/RESUME-STUDIO-PLAN.md — aditivo para despliegues donde
-- `cv_generations` ya existía antes de esta fase (mismo patrón que
-- `resume_studio_beta`/`preferred_roles` arriba: la definición de
-- CREATE TABLE de arriba ya la trae para un deploy nuevo desde cero,
-- esta línea es la que de verdad importa contra la BD real).
ALTER TABLE cv_generations ADD COLUMN IF NOT EXISTS template_id VARCHAR(50) NOT NULL DEFAULT 'ats_classic';

-- 13. Tabla `llm_response_cache`: cache por hash de cada llamada al
-- gateway nativo de este subproyecto (docs/CV-GENERATION-PLAN.md §6.1,
-- Fase 0/1) — puerto de `packages/models/src/gateway.ts` del proyecto
-- raíz, pero en Postgres en vez de `var/llm-cache/*.json` porque Render
-- free tier tiene disco efímero (se pierde en cada redeploy, y con él la
-- cuenta de qué ya se generó). `key` es el sha256 de
-- (prompt+version+model+system+user), igual que el gateway original.
CREATE TABLE IF NOT EXISTS llm_response_cache (
    key         VARCHAR(64) PRIMARY KEY,
    output_json JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fase 2 de docs/RESUME-STUDIO-PLAN.md — fix de la cache key compartida,
-- hecho ANTES de que exista el primer proveedor BYOK, no después. `key`
-- (arriba) ya deja de ser puramente global desde que model-gateway.ts
-- empieza a incluir user_id/provider_id en el hash para llamadas
-- financiadas con la key propia de un usuario (nunca para el fallback del
-- operador, que sigue exactamente igual que hoy) — estas dos columnas son
-- la copia consultable/limpiable de esa misma decisión, no una fuente de
-- verdad alternativa. `user_id` con ON DELETE CASCADE es lo que hace que
-- borrar una cuenta también borre su cache scoped (nunca queda huérfano
-- reteniendo fragmentos de su CV/vacante indefinidamente — no hay TTL en
-- esta tabla, ver nota de la auditoría del plan aprobado). NULL en ambas
-- columnas = entrada compartida/global, exactamente el comportamiento
-- actual, cero regresión.
ALTER TABLE llm_response_cache ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE llm_response_cache ADD COLUMN IF NOT EXISTS provider_id VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_llm_response_cache_user ON llm_response_cache (user_id) WHERE user_id IS NOT NULL;

-- 14. Tabla `llm_usage_ledger`: costo real de cada llamada LLM del
-- pipeline de CV (docs/CV-GENERATION-PLAN.md §6.1/§6.2, Fase 0/1) — mismo
-- motivo que la tabla anterior, Postgres en vez de `var/llm-usage.jsonl`.
-- Es la fuente del circuit breaker diario (`SUM(cost_usd) WHERE ts >=
-- hoy AND cached = false`, §6.1) y del registro de costo real aunque una
-- generación termine en `status = 'failed'` y no se cobre en créditos al
-- usuario (§6.2 paso 5) — el gasto en dólares sí ocurrió y debe quedar
-- visible independientemente de si se cobró o no.
CREATE TABLE IF NOT EXISTS llm_usage_ledger (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ts                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
    stage             VARCHAR(20) NOT NULL,   -- 'extract' | 'draft' | 'critique' | 'regenerate'
    model             VARCHAR(100) NOT NULL,
    input_tokens      INTEGER NOT NULL,
    output_tokens     INTEGER NOT NULL,
    cost_usd          NUMERIC NOT NULL,
    cached            BOOLEAN NOT NULL DEFAULT FALSE,
    cv_generation_id  UUID REFERENCES cv_generations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_ledger_ts ON llm_usage_ledger (ts);

-- 15. Tabla `user_ai_credentials`: credenciales BYOK cifradas (Fase 3 de
-- docs/RESUME-STUDIO-PLAN.md, plan aprobado 2026-08-09 en §3.2). Inerte —
-- nada la llama todavía; `credential-crypto.ts` (esta misma fase) trae el
-- módulo de cifrado, `credential-resolver.ts` (Fase 5) es quien la va a
-- leer de verdad. Es el dato más sensible que este proyecto va a guardar
-- jamás — más que el CV crudo de `cv_profiles` — así que RLS se habilita
-- en esta MISMA migración, nunca como follow-up (regla explícita del plan
-- aprobado, ver la nota "defense-in-depth" más abajo sobre qué pasa si no).
CREATE TABLE IF NOT EXISTS user_ai_credentials (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_id    VARCHAR(50) NOT NULL,
    label          VARCHAR(100),
    last4          VARCHAR(4) NOT NULL,       -- para mostrar "····3f2a", nunca la key completa
    ciphertext     BYTEA NOT NULL,
    iv             BYTEA NOT NULL,            -- 12 bytes aleatorios, único por fila, nunca reusado
    auth_tag       BYTEA NOT NULL,            -- tag de AES-256-GCM
    key_version    INTEGER NOT NULL DEFAULT 1, -- rotación futura de BYOK_ENCRYPTION_KEY sin migración big-bang
    validated_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, provider_id)
);

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
ALTER TABLE cv_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE cv_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_response_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_ai_credentials ENABLE ROW LEVEL SECURITY;

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
  company_reputation_alias, cv_profiles, cv_generations, llm_response_cache,
  llm_usage_ledger, user_ai_credentials
  FROM anon, authenticated;
