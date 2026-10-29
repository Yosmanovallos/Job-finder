CREATE TABLE test_sandbox (run_id TEXT PRIMARY KEY);
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url_hash VARCHAR(64) UNIQUE NOT NULL,
  content_fingerprint VARCHAR(64),
  title VARCHAR(500) NOT NULL,
  company VARCHAR(255) DEFAULT 'Confidencial',
  location VARCHAR(255),
  url TEXT NOT NULL,
  source VARCHAR(100) NOT NULL,
  sources JSONB DEFAULT '[]'::jsonb,
  date_text VARCHAR(100),
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  role_origin VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  country VARCHAR(2),
  description TEXT,
  requirements JSONB DEFAULT '[]'::jsonb,
  technologies JSONB DEFAULT '[]'::jsonb,
  employment_type VARCHAR(50),
  salary_min NUMERIC,
  salary_max NUMERIC,
  salary_currency VARCHAR(10),
  salary_raw VARCHAR(255),
  applicant_count INTEGER
);
CREATE UNIQUE INDEX idx_jobs_content_fingerprint ON jobs (content_fingerprint)
  WHERE content_fingerprint IS NOT NULL AND is_active = TRUE;
CREATE TABLE indexing_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  notification_type VARCHAR(20) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);
CREATE TABLE role_source_runs (
  role_name VARCHAR(255) NOT NULL,
  source_name VARCHAR(100) NOT NULL,
  last_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_name, source_name)
);
CREATE TABLE source_circuit_state (
  source_name VARCHAR(100) PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  open_until TIMESTAMPTZ
);
CREATE TABLE company_reputation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name VARCHAR(255) NOT NULL,
  source VARCHAR(50) NOT NULL,
  score NUMERIC,
  score_scale VARCHAR(50) NOT NULL,
  review_count INTEGER,
  source_url TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_name, source)
);
CREATE TABLE company_reputation_alias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_company_name VARCHAR(255) NOT NULL,
  source VARCHAR(50) NOT NULL,
  canonical_name VARCHAR(255) NOT NULL,
  UNIQUE (raw_company_name, source)
);
INSERT INTO jobs (id, url_hash, title, company, location, country, url, source, sources,
                  published_at, description, requirements, technologies)
SELECT md5('p0-baseline-' || i)::uuid, md5('p0-url-' || i),
       CASE WHEN i % 4 = 0 THEN 'AI Engineer ' ELSE 'Analista de Datos ' END || i,
       'Empresa Sintetica ' || (i % 5),
       CASE i % 3 WHEN 0 THEN 'Bogotá, Colombia' WHEN 1 THEN 'Caracas, Venezuela' ELSE 'Remoto' END,
       CASE i % 3 WHEN 0 THEN 'CO' WHEN 1 THEN 'VE' ELSE NULL END,
       'https://example.com/jobs/p0-baseline-' || i,
       'LinkedIn', '["LinkedIn"]'::jsonb,
       date_trunc('day', NOW()) - INTERVAL '3 days' - i * INTERVAL '1 minute',
       'Descripción sintética para verificar el entorno aislado, sin datos de candidatos.',
       '["Requisito sintético"]'::jsonb, '["TypeScript"]'::jsonb
FROM generate_series(1, 120) AS i;

-- Explicitly synthetic destinations for the bounded discovery expansion.
INSERT INTO jobs (id, url_hash, title, company, location, country, url, source, sources,
                  published_at, description, requirements)
SELECT md5('mde-baseline-' || slug)::uuid, md5('mde-url-' || slug), title,
       'Empresa Sintetica MDE ' || slug, location, country,
       'https://example.invalid/jobs/mde-' || slug, 'LinkedIn', '["LinkedIn"]'::jsonb,
       NOW() - INTERVAL '3 days',
       'Vacante sintética para validar navegación aislada. No es una oferta real.',
       '["Requisito sintético MDE"]'::jsonb
FROM (VALUES
  ('armenia', 'Analista sintético MDE Armenia', 'Armenia, Colombia', 'CO'),
  ('neiva', 'Analista sintético MDE Neiva', 'Neiva, Colombia', 'CO'),
  ('ibague', 'Analista sintético MDE Ibagué', 'Ibagué, Colombia', 'CO'),
  ('popayan', 'Analista sintético MDE Popayán', 'Popayán, Colombia', 'CO'),
  ('civil-ve', 'Ingeniero Civil sintético MDE', 'Caracas, Venezuela', 'VE')
) AS fixture(slug, title, location, country);

-- Explicitly synthetic Santa Marta hub for the city statistics (SEO city hub
-- stats): repeated catalog role titles and numeric salaries with a currency,
-- plus one free-text salary that must never enter the range.
INSERT INTO jobs (id, url_hash, title, company, location, country, url, source, sources,
                  published_at, description, requirements, salary_min, salary_max,
                  salary_currency, salary_raw)
SELECT md5('stats-baseline-' || i)::uuid, md5('stats-url-' || i),
       CASE WHEN i <= 3 THEN 'Asesor comercial sintético ' ELSE 'Auxiliar administrativo sintético ' END || i,
       'Empresa Sintetica Stats ' || (i % 2), 'Santa Marta, Colombia', 'CO',
       'https://example.invalid/jobs/stats-' || i, 'LinkedIn', '["LinkedIn"]'::jsonb,
       NOW() - INTERVAL '10 days' - i * INTERVAL '1 hour',
       'Vacante sintética para validar las cifras del hub. No es una oferta real.',
       '["Requisito sintético"]'::jsonb,
       CASE WHEN i <= 3 THEN 1500000 + i * 100000 END,
       CASE WHEN i <= 3 THEN 2500000 + i * 100000 END,
       CASE WHEN i <= 3 THEN 'COP' END,
       CASE WHEN i = 4 THEN 'A convenir' END
FROM generate_series(1, 5) AS i;
