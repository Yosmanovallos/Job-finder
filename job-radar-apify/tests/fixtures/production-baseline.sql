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
