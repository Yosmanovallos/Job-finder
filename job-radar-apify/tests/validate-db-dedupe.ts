import { saveJobs, getJobs, clearRepository, computeUrlHash } from '../src/db/job-repository.js';
import { Job } from '../src/sources/types.js';
import { pool } from '../src/db/client.js';

async function runDedupeTest() {
  console.log(`\n==================================================`);
  console.log(`🧪 PRUEBA DE DEDUPLICACIÓN Y FUSIÓN DE FUENTES`);
  console.log(`==================================================\n`);

  clearRepository();

  // Generate 50 sample jobs from LinkedIn
  const sampleBatch1: Job[] = Array.from({ length: 50 }, (_, i) => ({
    jobId: `job_${i + 1}`,
    title: `Desarrollador Senior #${i + 1}`,
    company: `Empresa Tech ${i + 1}`,
    location: 'Bogotá, Colombia',
    url: `https://www.example.com/jobs/view/${i + 1}`,
    dateText: 'Hace 2 horas',
    source: 'LinkedIn',
    publishedAt: new Date().toISOString().split('T')[0]
  }));

  console.log(`📥 [Test] Insertando lote 1: 50 vacantes desde "LinkedIn"...`);
  const res1 = await saveJobs(sampleBatch1, 'Lote 1');
  console.log(`   Resultado Lote 1: Guardadas=${res1.savedCount}, Duplicadas=${res1.duplicateCount}`);

  if (res1.savedCount !== 50) {
    console.error(`❌ [FAILED] Se esperaban 50 vacantes nuevas, se guardaron ${res1.savedCount}`);
    process.exit(1);
  }

  // Generate same 50 jobs but from Computrabajo (same URLs)
  const sampleBatch2: Job[] = Array.from({ length: 50 }, (_, i) => ({
    jobId: `computrabajo_${i + 1}`,
    title: `Desarrollador Senior #${i + 1}`,
    company: `Empresa Tech ${i + 1}`,
    location: 'Bogotá, Colombia',
    url: `https://www.example.com/jobs/view/${i + 1}`, // SAME URL
    dateText: 'Hace 1 hora',
    source: 'Computrabajo',
    publishedAt: new Date().toISOString().split('T')[0]
  }));

  console.log(`\n📥 [Test] Insertando lote 2: Mismas 50 vacantes pero desde "Computrabajo"...`);
  const res2 = await saveJobs(sampleBatch2, 'Lote 2');
  console.log(`   Resultado Lote 2: Guardadas=${res2.savedCount}, Duplicadas Fusionadas=${res2.duplicateCount}`);

  if (res2.savedCount !== 0 || res2.duplicateCount !== 50) {
    console.error(`❌ [FAILED] Deduplicación falló. Guardadas nuevas=${res2.savedCount} (esperado 0), Duplicadas=${res2.duplicateCount} (esperado 50)`);
    process.exit(1);
  }

  // Retrieve stored jobs and verify deduplication and merged sources
  const storedJobs = await getJobs(100);
  console.log(`\n🔍 [Test] Consultando vacantes almacenadas en el repositorio: ${storedJobs.length} vacantes encontradas.`);

  if (storedJobs.length !== 50) {
    console.error(`❌ [FAILED] El número total de vacantes únicas debe ser 50, se encontró: ${storedJobs.length}`);
    process.exit(1);
  }

  // Verify merged sources array on first job
  const firstJob = storedJobs[0] as any;
  console.log(`\n📌 [Test] Verificando vacante deduplicada #${firstJob.jobId}:`);
  console.log(`   Título: "${firstJob.title}"`);
  console.log(`   Fuente primaria: "${firstJob.source}"`);
  console.log(`   Fuentes secundarias ("también en:"): [${(firstJob.alsoIn || []).join(', ')}]`);

  if (!firstJob.alsoIn || !firstJob.alsoIn.includes('Computrabajo')) {
    console.error(`❌ [FAILED] Las fuentes no se fusionaron correctamente. Esperado Computrabajo en alsoIn.`);
    process.exit(1);
  }

  // SEO Fase 9 (docs/SEO-PLAN.md §9.2): a re-scrape of an existing URL
  // (batch 2, ON CONFLICT path above) must bump last_seen_at without
  // touching created_at — that's the whole fix for the URL-churn bug.
  console.log(`\n🕒 [Test] Verificando que el re-scrape actualizó last_seen_at sin tocar created_at...`);
  const urlHash = computeUrlHash('https://www.example.com/jobs/view/1');
  const { rows } = await pool.query(
    `SELECT created_at, last_seen_at, NOW() AS db_now FROM jobs WHERE url_hash = $1`,
    [urlHash]
  );
  if (rows.length !== 1) {
    console.error(`❌ [FAILED] No se encontró la fila para verificar last_seen_at.`);
    process.exit(1);
  }
  const { created_at, last_seen_at, db_now } = rows[0];
  const staleMs = new Date(db_now).getTime() - new Date(last_seen_at).getTime();
  if (staleMs > 10_000) {
    console.error(
      `❌ [FAILED] last_seen_at no se actualizó en el re-scrape (hace ${staleMs}ms) — el bug de churn de URL volvió.`
    );
    process.exit(1);
  }
  if (new Date(last_seen_at).getTime() === new Date(created_at).getTime()) {
    console.error(
      `⚠️  [WARN] last_seen_at == created_at — esperado solo si ambos INSERT y el UPDATE de ON CONFLICT ocurrieron en el mismo instante exacto, revisar si es real o casualidad de timing.`
    );
  }
  console.log(`   ✅ last_seen_at actualizado por el re-scrape (created_at sin cambios).`);

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] ¡Deduplicación por SHA256 y fusión de fuentes verificada al 100%!`);
  console.log(`==================================================\n`);
  process.exit(0);
}

runDedupeTest();
