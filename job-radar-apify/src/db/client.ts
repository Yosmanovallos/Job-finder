import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    '[DB] Falta DATABASE_URL en job-radar-apify/.env. ' +
    'En Supabase: Project Settings → Database → Connection string → URI ' +
    '(usa el modo "Session pooler" para servidores serverless, o el directo si corres un proceso persistente). ' +
    'Pega esa cadena como DATABASE_URL.'
  );
}

const isSupabase = /supabase\.(co|com)/.test(connectionString);

export const pool = new Pool({
  connectionString,
  ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => {
  console.error('[DB] Error inesperado en el pool de Postgres:', err.message);
});
