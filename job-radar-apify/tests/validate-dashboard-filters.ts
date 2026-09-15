import assert from 'node:assert/strict';
import type { Job } from '../src/sources/types.js';
import type { FilterState } from '../src/components/FilterBar.js';
import { applyJobFilters } from '../src/lib/job-filters.js';

const defaultFilters: FilterState = {
  search: '', sources: [], modality: 'all', freshness: 'all', savedOnly: false,
  appliedOnly: false, selectedRoles: [], cities: [], company: ''
};

// Sample dataset of 100 jobs for instant local filtering benchmark
const sampleJobs: Job[] = Array.from({ length: 100 }, (_, i) => ({
  jobId: `job_${i + 1}`,
  title: i % 2 === 0 ? `Desarrollador Senior #${i + 1}` : `Analista de Datos #${i + 1}`,
  company: i % 3 === 0 ? 'Bancolombia' : (i % 3 === 1 ? 'Rappi' : 'Platzi'),
  location: i % 2 === 0 ? 'Remoto' : (i % 4 === 1 ? 'Bogotá, Híbrido' : 'Medellín, Colombia'),
  url: `https://www.example.com/job/${i + 1}`,
  dateText: i % 2 === 0 ? 'Hace 2 horas' : 'Hace 1 día',
  source: i % 3 === 0 ? 'LinkedIn' : (i % 3 === 1 ? 'Computrabajo' : 'RemoteOK'),
  publishedAt: new Date(Date.now() - i * 3600000).toISOString().split('T')[0]
}));

function applyFiltersLocally(jobs: Job[], filters: FilterState): Job[] {
  return applyJobFilters(jobs, {
    search: filters.search, sources: filters.sources, cities: filters.cities,
    modality: filters.modality, freshness: filters.freshness,
    roles: filters.selectedRoles, company: filters.company
  });
}

async function runDashboardFilterTests() {
  assert.equal(applyFiltersLocally(sampleJobs, { ...defaultFilters, sources: ['LinkedIn', 'Computrabajo'] }).length, 67);
  assert.equal(applyFiltersLocally(sampleJobs, defaultFilters).length, 100);
  assert.equal(applyFiltersLocally(sampleJobs, { ...defaultFilters, cities: ['Bogotá'] }).length, 25);
  console.log(`\n==================================================`);
  console.log(`🧪 TEST DE VALIDACIÓN DE FILTROS INSTANTÁNEOS DEL DASHBOARD`);
  console.log(`==================================================\n`);

  console.log(`📥 [Test] Cargando corpus de prueba: ${sampleJobs.length} vacantes.`);

  // Test 1: Source Filter Execution Time (< 50ms)
  const start1 = performance.now();
  const res1 = applyFiltersLocally(sampleJobs, { ...defaultFilters, sources: ['LinkedIn'] });
  const duration1 = performance.now() - start1;
  assert.equal(res1.length, 34);

  console.log(`🔍 [Test 1] Filtro por Fuente "LinkedIn": ${res1.length} vacantes devueltas en ${duration1.toFixed(2)}ms.`);
  if (duration1 > 50) {
    console.error(`❌ [FAILED] El tiempo de filtrado excedió el límite de 50ms (${duration1.toFixed(2)}ms).`);
    process.exit(1);
  }
  console.log(`✅ [PASSED] Tiempo de respuesta instantáneo (${duration1.toFixed(2)}ms < 50ms).`);

  // Test 2: Modality Filter Execution
  const start2 = performance.now();
  const res2 = applyFiltersLocally(sampleJobs, { ...defaultFilters, modality: 'remoto' });
  const duration2 = performance.now() - start2;

  console.log(`\n🔍 [Test 2] Filtro por Modalidad "Remoto": ${res2.length} vacantes devueltas en ${duration2.toFixed(2)}ms.`);
  if (res2.length === 0 || duration2 > 50) {
    console.error(`❌ [FAILED] El filtro por modalidad no retornó resultados o tardó más de 50ms.`);
    process.exit(1);
  }
  console.log(`✅ [PASSED] Filtro por modalidad 'Remoto' verificado (${res2.length} resultados).`);

  // Test 3: Text Search Query Filter Execution
  const start3 = performance.now();
  const res3 = applyFiltersLocally(sampleJobs, { ...defaultFilters, search: 'Senior' });
  const duration3 = performance.now() - start3;

  console.log(`\n🔍 [Test 3] Búsqueda por palabra clave "Senior": ${res3.length} vacantes devueltas en ${duration3.toFixed(2)}ms.`);
  if (res3.length !== 50 || duration3 > 50) {
    console.error(`❌ [FAILED] La búsqueda de texto esperada era 50 resultados, obtenido: ${res3.length}`);
    process.exit(1);
  }
  console.log(`✅ [PASSED] Búsqueda por texto "Senior" verificada al 100%.`);

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] ¡Filtros instantáneos del Dashboard verificados al 100% (Respuestas < 50ms sin scrapes)!`);
  console.log(`==================================================\n`);
  process.exit(0);
}

runDashboardFilterTests();
