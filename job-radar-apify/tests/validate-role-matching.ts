import { jobMatchesRole } from '../src/lib/job-filters.js';

// Regression test for a real bug found 2026-08-04: jobMatchesRole() matched
// synonym tokens (ti/it/ia/ai, from TRANSLATION_MAP entries like
// software->["ti","it"] and ai<->ia) via raw substring, so "AI Engineer" and
// "Arquitecto de Software" matched thousands of unrelated titles just for
// containing "ia"/"ti" as a letter sequence (e.g. "Ejecutivo", "Historiador").
// Fixed by requiring a word-boundary match instead of `.includes()`.

function job(title: string) {
  return { title };
}

type Case = { role: string; title: string; expected: boolean; label: string };

const cases: Case[] = [
  // False positives that must now be rejected
  { role: 'AI Engineer', title: 'Ejecutivo de Ventas', expected: false, label: 'AI Engineer no matchea "ia" dentro de "Ejecutivo"' },
  { role: 'AI Engineer', title: 'Historiador Senior', expected: false, label: 'AI Engineer no matchea "ia" dentro de "Historiador"' },
  { role: 'Arquitecto de Software', title: 'Ejecutivo Comercial B2B', expected: false, label: 'Arquitecto de Software no matchea "ti" dentro de "Ejecutivo"' },
  { role: 'Arquitecto de Software', title: 'Gestión Administrativa', expected: false, label: 'Arquitecto de Software no matchea "it"/"ti" dentro de "Gestión"/"Administrativa"' },

  // Real matches that must still work
  { role: 'AI Engineer', title: 'Senior AI Engineer (Node.js, Python)', expected: true, label: 'AI Engineer sigue matcheando "AI Engineer" real' },
  { role: 'AI Engineer', title: 'Ingeniero de Inteligencia Artificial', expected: true, label: 'AI Engineer matchea vía sinónimo "inteligencia artificial"' },
  { role: 'Arquitecto de Software', title: 'Software Engineer (Python/React)', expected: true, label: 'Arquitecto de Software sigue matcheando "Software Engineer"' },
  { role: 'Arquitecto de Software', title: 'Pasante de IT', expected: true, label: 'Arquitecto de Software matchea "IT" como palabra completa' },

  // Canaries: punctuation and accented word boundaries must not regress
  { role: 'Desarrollador Node.js', title: 'Backend Engineer (Node.js + JavaScript)', expected: true, label: 'Desarrollador Node.js matchea "Node.js" con punto escapado' },
  { role: 'Desarrollador Node.js', title: 'Backend Engineer (NodeJS)', expected: false, label: 'Desarrollador Node.js NO matchea "NodeJS" sin punto (token exacto)' },
  { role: 'Auxiliar de Enfermería', title: 'Auxiliar de Enfermería Turno Noche', expected: true, label: 'Auxiliar de Enfermería matchea con tilde en frontera de palabra' },
  { role: 'Diseñador Gráfico', title: 'Diseñador Gráfico Freelance', expected: true, label: 'Diseñador Gráfico matchea con ñ dentro de la palabra' }
];

async function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 TEST DE VALIDACIÓN DE jobMatchesRole (word-boundary matching)`);
  console.log(`==================================================\n`);

  let failed = 0;
  for (const c of cases) {
    const actual = jobMatchesRole(c.role, job(c.title));
    if (actual === c.expected) {
      console.log(`✅ [PASSED] ${c.label}`);
    } else {
      console.error(`❌ [FAILED] ${c.label} — role="${c.role}" title="${c.title}" esperado=${c.expected} obtenido=${actual}`);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\n❌ [TEST SUITE FAILED] ${failed}/${cases.length} casos fallaron.`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] jobMatchesRole verificado (${cases.length} casos).`);
  console.log(`==================================================\n`);
  process.exit(0);
}

main();
