import { saveJobs, clearRepository } from '../src/db/job-repository.js';
import { generateSocialDigest } from '../src/social/digest-generator.js';
import { generateCardSvg } from '../src/social/card-generator.js';
import { publishPendingDigests, getSocialPostHistory } from '../src/social/publisher.js';
import { Job } from '../src/sources/types.js';

async function runSocialPublisherValidation() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN DEL MOTOR DE CAPTACIÓN VIRAL Y DIGESTS`);
  console.log(`==================================================\n`);

  clearRepository();

  // Create 18 test jobs for "Enfermería"
  const testJobs: Job[] = Array.from({ length: 18 }, (_, i) => ({
    jobId: `nurse_${i + 1}`,
    title: `Auxiliar de Enfermería #${i + 1}`,
    company: i % 2 === 0 ? 'Clínica Las Américas' : 'Grupo Éxito Salud',
    location: 'Bogotá, Colombia',
    url: `https://www.elempleo.com/co/ofertas-empleo/enfermeria-${i + 1}`,
    dateText: 'Hace 2 horas',
    source: i % 2 === 0 ? 'Elempleo' : 'LinkedIn',
    publishedAt: new Date().toISOString().split('T')[0]
  }));

  await saveJobs(testJobs, 'Enfermería');

  // Test 1: Digest Generator Format and Length
  console.log(`🔍 [Test 1] Verificando formato de Digest para "Enfermería"...`);
  const digest = generateSocialDigest('Enfermería', testJobs);

  console.log(`   Longitud de Twitter Copy: ${digest.twitterCopy.length} caracteres (Máximo permitido: 280)`);
  if (digest.twitterCopy.length > 280) {
    console.error(`❌ [FAILED] El copy de Twitter superó el límite de 280 caracteres (${digest.twitterCopy.length} chars).`);
    process.exit(1);
  }
  console.log(`✅ [PASSED] Copy de Twitter dentro del límite de 280 caracteres.`);

  // Test 2: UTM URL Format
  console.log(`\n🔍 [Test 2] Verificando enlace UTM para rastreo...`);
  console.log(`   UTM URL: ${digest.utmUrl}`);
  if (!digest.utmUrl.includes('utm_source=social') || !digest.utmUrl.includes('enfermeria')) {
    console.error(`❌ [FAILED] La URL UTM no contiene los parámetros de rastreo requeridos.`);
    process.exit(1);
  }
  console.log(`✅ [PASSED] Enlace UTM válido.`);

  // Test 3: Card Image SVG Generation with anima-project tokens
  console.log(`\n🔍 [Test 3] Verificando renderizado de la imagen Card SVG...`);
  const svg = generateCardSvg(digest);
  if (!svg.includes('1080') || !svg.includes('#34D399') || !svg.includes('#0A0B0D')) {
    console.error(`❌ [FAILED] La imagen Card SVG no contiene las dimensiones o los tokens de color de anima-project.`);
    process.exit(1);
  }
  console.log(`✅ [PASSED] Imagen Card SVG renderizada exitosamente con tokens de anima-project.`);

  // Test 4: Social Auto-Publisher Execution
  console.log(`\n🔍 [Test 4] Ejecutando motor de publicación automatizada (publishPendingDigests)...`);
  const pubResult = await publishPendingDigests();
  const history = getSocialPostHistory();

  console.log(`   Publicaciones realizadas: ${pubResult.publishedCount}`);
  console.log(`   Historial total de registros: ${history.length}`);

  if (pubResult.publishedCount !== 1 || history.length !== 1) {
    console.error(`❌ [FAILED] La publicación en redes no generó el registro esperado.`);
    process.exit(1);
  }
  console.log(`✅ [PASSED] Publicación registrada con éxito en el sistema.`);

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] ¡Motor de Captación Viral y Social Auto-Publisher verificado al 100%!`);
  console.log(`==================================================\n`);
  process.exit(0);
}

runSocialPublisherValidation();
