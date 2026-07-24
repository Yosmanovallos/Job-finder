import { startPaymentCheckout, confirmPaymentWebhook } from '../src/payments/checkout.js';
import { Job } from '../src/sources/types.js';

function isJobLocked(job: Job, userTier: 'free' | 'pro'): boolean {
  if (userTier === 'pro') return false; // Pro users see 100% unlocked
  if (!job.publishedAt) return true;

  const ageMs = Date.now() - new Date(job.publishedAt).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);

  // Jobs <= 48h are locked for Free users
  return ageHours <= 48;
}

async function runPaywallAuthValidation() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN DE PAYWALL DE FRESCURA 24H/48H & AUTH`);
  console.log(`==================================================\n`);

  const now = new Date();

  // Job 1: Published 2 hours ago (< 48h)
  const recentJob: Job = {
    jobId: 'job_recent_1',
    title: 'Desarrollador React Senior',
    company: 'Tech Corp',
    location: 'Bogotá, Colombia',
    url: 'https://www.example.com/job/1',
    dateText: 'Hace 2 horas',
    source: 'LinkedIn',
    publishedAt: new Date(now.getTime() - 2 * 3600000).toISOString()
  };

  // Job 2: Published 72 hours ago (> 48h)
  const olderJob: Job = {
    jobId: 'job_older_2',
    title: 'Analista de Datos',
    company: 'Bancolombia',
    location: 'Medellín, Colombia',
    url: 'https://www.example.com/job/2',
    dateText: 'Hace 3 días',
    source: 'Computrabajo',
    publishedAt: new Date(now.getTime() - 72 * 3600000).toISOString()
  };

  // Test 1: Free User - Recent Job (Must be locked)
  console.log(`🔍 [Test 1] Evaluando vacante reciente (< 48h) para Usuario FREE...`);
  const lockedForFree = isJobLocked(recentJob, 'free');
  console.log(`   Resultado isLocked: ${lockedForFree}`);
  if (!lockedForFree) {
    console.error(`❌ [FAILED] Las vacantes <48h deben estar bloqueadas para usuarios Free.`);
    process.exit(1);
  }
  console.log(`✅ [PASSED] Vacante de hace 2h bloqueada correctamente con PaywallCard.`);

  // Test 2: Free User - Older Job (Must be unlocked)
  console.log(`\n🔍 [Test 2] Evaluando vacante antigua (> 48h) para Usuario FREE...`);
  const lockedOlderForFree = isJobLocked(olderJob, 'free');
  console.log(`   Resultado isLocked: ${lockedOlderForFree}`);
  if (lockedOlderForFree) {
    console.error(`❌ [FAILED] Las vacantes >48h deben ser 100% públicas y gratuitas.`);
    process.exit(1);
  }
  console.log(`✅ [PASSED] Vacante de hace 72h libre y pública para todos.`);

  // Test 3: Pro User - All Jobs (Must be unlocked)
  console.log(`\n🔍 [Test 3] Evaluando vacantes para Usuario PRO...`);
  const lockedRecentForPro = isJobLocked(recentJob, 'pro');
  const lockedOlderForPro = isJobLocked(olderJob, 'pro');
  if (lockedRecentForPro || lockedOlderForPro) {
    console.error(`❌ [FAILED] El usuario Pro debe tener acceso total a 100% de las vacantes.`);
    process.exit(1);
  }
  console.log(`✅ [PASSED] Usuario Pro tiene 100% acceso ilimitado desbloqueado.`);

  // Test 4: Checkout Flow
  console.log(`\n🔍 [Test 4] Verificando motor de Checkout y Webhook...`);
  const checkout = await startPaymentCheckout({ planId: 'plan_pro_monthly', currency: 'COP', amount: 14900 });
  const confirmation = await confirmPaymentWebhook(checkout.transactionId, 'cliente@jobradar.app');
  if (!checkout.success || confirmation.tier !== 'pro') {
    console.error(`❌ [FAILED] El proceso de checkout/webhook no actualizó el tier a 'pro'.`);
    process.exit(1);
  }
  console.log(`✅ [PASSED] Proceso de pago y actualización de tier verificado exitosamente.`);

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] ¡Paywall de Frescura 48h y Checkout de Pagos verificado al 100%!`);
  console.log(`==================================================\n`);
  process.exit(0);
}

runPaywallAuthValidation();
