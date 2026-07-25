import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/db/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const schemaPath = path.join(__dirname, '..', 'src', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');

  console.log('🔧 [Migrate] Aplicando schema.sql contra la base de datos...');
  await pool.query(sql);
  console.log('✅ [Migrate] Schema aplicado correctamente (idempotente, seguro re-ejecutar).');

  await pool.end();
}

migrate().catch((err) => {
  console.error('❌ [Migrate] Falló la migración:', err.message);
  process.exit(1);
});
