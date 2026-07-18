-- Enabled once, before any Drizzle migration runs, via
-- docker-entrypoint-initdb.d on first container start.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
