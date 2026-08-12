import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { getOrCreateUser, upgradeUserToPro } from "../src/db/job-repository.js";

dotenv.config();

/**
 * Crea UN usuario de prueba, Pro, con el email YA confirmado — evita por
 * completo el bloqueo de "Confirm email" de Supabase que impidió probar
 * el editor de CV (Vista 2) en un navegador real durante las Fases 2a/6/7.
 *
 * Requiere `SUPABASE_SERVICE_ROLE_KEY` en .env (Supabase Dashboard →
 * Settings → API → "service_role secret") — la clave anon normal no puede
 * crear usuarios pre-confirmados, solo el service_role puede. Este script
 * NO lee ni imprime esa clave más allá de usarla para esta única llamada.
 *
 * Alcance: inserta/actualiza exactamente UNA fila en auth.users (Supabase
 * Auth) y UNA fila en la tabla `users` de esta app — nada de `jobs`,
 * `companies`, ni ningún otro usuario. Corrido con `npx tsx
 * scripts/create-test-pro-user.ts`.
 */

const EMAIL = process.env.TEST_USER_EMAIL || `cv-editor-test-${Date.now()}@example-test.com`;
const PASSWORD = process.env.TEST_USER_PASSWORD || `TestCv-${Date.now()}!`;

async function main() {
  const url = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Faltan VITE_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env. " +
        "La service_role key está en Supabase Dashboard → Settings → API."
    );
  }

  const admin = createClient(url, serviceKey);

  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true // esto es lo que salta el bloqueo de "Confirm email"
  });
  if (error) throw error;
  if (!data.user) throw new Error("createUser no devolvió un usuario.");

  console.log(`Usuario creado y confirmado en Supabase Auth: ${data.user.id} <${EMAIL}>`);

  await getOrCreateUser(data.user.id, EMAIL);
  await upgradeUserToPro(data.user.id, new Date(Date.now() + 30 * 24 * 3600 * 1000));
  console.log("Fila en `users` creada/actualizada y subida a tier 'pro' por 30 días.");

  console.log("\n==================================================");
  console.log("Credenciales de prueba:");
  console.log(`  email:    ${EMAIL}`);
  console.log(`  password: ${PASSWORD}`);
  console.log("==================================================\n");

  await pool.end();
}

main().catch((e) => {
  console.error("Error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
