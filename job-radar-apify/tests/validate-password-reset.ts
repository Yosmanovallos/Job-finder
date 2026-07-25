// Real Supabase calls, no mocks — same philosophy as validate-paywall-auth.ts.
// Unlike that suite, this one never touches the `jobs` table, so it doesn't
// need ALLOW_TEST_DB_WIPE and is safe to run against the same project the app
// uses in production.
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en .env — no se puede validar.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// mailinator.com is a real, publicly-viewable inbox domain commonly used for
// throwaway test signups — Supabase accepts it (unlike "@example.com", which
// its email validator rejects outright), and it never reaches a real person.
const testEmail = `jobradar_test_${Date.now()}@mailinator.com`;
const testPassword = `Test${Date.now()}!aA`;

let failures = 0;

function report(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function main() {
  console.log('==================================================');
  console.log('🧪 SUITE DE VALIDACIÓN — Recuperación de contraseña y reenvío de confirmación');
  console.log(`   (usuario de prueba: ${testEmail})`);
  console.log('==================================================\n');

  const signUpResult = await supabase.auth.signUp({ email: testEmail, password: testPassword });
  report(
    'signUp crea el usuario de prueba sin error de configuración',
    !signUpResult.error,
    signUpResult.error?.message
  );

  const resendResult = await supabase.auth.resend({ type: 'signup', email: testEmail });
  report('resend (reenvío de confirmación) no falla', !resendResult.error, resendResult.error?.message);

  const resetResult = await supabase.auth.resetPasswordForEmail(testEmail, {
    redirectTo: 'https://job-radar-apify.onrender.com/reset-password'
  });
  report('resetPasswordForEmail no falla', !resetResult.error, resetResult.error?.message);

  // Supabase deliberately returns success for resetPasswordForEmail on
  // non-existent emails too (anti-enumeration) — so this call alone can't
  // prove an email was actually sent, only that the API/config accepted the
  // request. Actual delivery is part of the manual checklist.
  const unknownEmailResult = await supabase.auth.resetPasswordForEmail(
    `jobradar_nonexistent_${Date.now()}@mailinator.com`,
    { redirectTo: 'https://job-radar-apify.onrender.com/reset-password' }
  );
  report(
    'resetPasswordForEmail no revela si el correo existe (misma respuesta para uno inexistente)',
    !unknownEmailResult.error,
    unknownEmailResult.error?.message
  );

  console.log('\n==================================================');
  if (failures === 0) {
    console.log('✅ TODO PASÓ');
  } else {
    console.log(`❌ ${failures} verificación(es) fallaron`);
  }
  console.log('==================================================');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ Error inesperado en la suite:', err);
  process.exit(1);
});
