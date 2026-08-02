import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "[DB] Falta DATABASE_URL en job-radar-apify/.env. " +
      "En Supabase: Project Settings → Database → Connection string → URI " +
      '(usa el modo "Session pooler" para servidores serverless, o el directo si corres un proceso persistente). ' +
      "Pega esa cadena como DATABASE_URL."
  );
}

const isSupabase = /supabase\.(co|com)/.test(connectionString);

// Explicit cap (pg's own default is 10) — with a second country's GitHub
// Actions tick now running concurrently against this same Supabase project
// (see .github/workflows/scrape-jobs-ve.yml), two uncapped pools could
// together exceed what the connection string's pooler mode allows. Low
// enough that one workflow can never starve the other's headroom on a free
// "Session pooler" plan (200 conns) shared with everything else hitting it.
const POOL_MAX = 5;

export const pool = new Pool({
  connectionString,
  ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
  max: POOL_MAX
});

pool.on("error", (err) => {
  console.error("[DB] Error inesperado en el pool de Postgres:", err.message);
});
