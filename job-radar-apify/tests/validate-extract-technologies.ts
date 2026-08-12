import { extractTechnologies, filterKnownTechnologyTags } from '../src/lib/extract-technologies.js';

type Case = { label: string; text: string | null | undefined; expected: string[] };

const cases: Case[] = [
  {
    label: 'Extrae el set completo de la vacante mockup (QA Automation)',
    text: `Vertex Labs busca un QA Automation Engineer senior para liderar la
      estrategia de automatización de nuestra plataforma de pagos.
      Requisitos: Dominio de Playwright, TypeScript y pruebas de API REST.
      Experiencia con SQL. Integración de suites en pipelines de GitHub
      Actions. Uso de Jira, metodologías Scrum, pruebas de carga con K6 y
      despliegue en Kubernetes.`,
    expected: [
      'TypeScript',
      'API REST',
      'SQL',
      'GitHub Actions',
      'Playwright',
      'K6',
      'Scrum',
      'Jira',
      'Kubernetes'
    ]
  },
  {
    label: 'Texto vacío/null/undefined no revienta y no inventa nada',
    text: '',
    expected: []
  },
  {
    label: 'SQL no matchea dentro de SQLite (frontera de palabra)',
    text: 'Experiencia con SQLite para almacenamiento local.',
    expected: []
  },
  {
    label: 'Node no matchea dentro de Nodo ni de un nombre propio compuesto',
    text: 'Buscamos un Nodo de coordinación regional.',
    expected: []
  },
  {
    label: 'C# se detecta pese a terminar en caracter no alfanumérico',
    text: 'Desarrollo backend en C# sobre .NET.',
    expected: ['C#', '.NET']
  },
  {
    label: 'CI/CD se detecta como token completo',
    text: 'Pipelines de CI/CD con Jenkins.',
    expected: ['Jenkins', 'CI/CD']
  },
  {
    label: 'Case-insensitive: k6 en minúsculas también matchea',
    text: 'Pruebas de carga con k6.',
    expected: ['K6']
  },
  {
    label: 'Sin coincidencias reales devuelve lista vacía',
    text: 'Se requiere excelente actitud de servicio y trabajo en equipo.',
    expected: []
  }
];

type TagCase = { label: string; tags: string[]; expected: string[] };

const tagCases: TagCase[] = [
  {
    label: 'Bug real 2026-08-12: tags de RemoteOK "Carpenter" mezclan categorías del sitio con tech real',
    tags: [
      'customer support', 'marketing', 'travel', 'speech', 'finance', 'sales', 'medical',
      'recruiter', 'non tech', 'architecture', 'exec', 'education', 'ops', 'golang', 'scheme',
      'full time', 'game dev', 'engineer', 'music', 'ios', 'design', 'swift', 'technical',
      'dev', 'c', 'haskell', 'senior', 'digital nomad', 'microsoft', 'excel',
      'virtual assistant', 'html', 'legal', 'teaching'
    ],
    expected: ['Go', 'Swift', 'Excel', 'HTML']
  },
  { label: 'Sin tags no revienta', tags: [], expected: [] },
  {
    label: 'Case-insensitive y sin duplicados',
    tags: ['TypeScript', 'typescript', 'SQL'],
    expected: ['TypeScript', 'SQL']
  }
];

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((x) => bSet.has(x));
}

async function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 TEST DE VALIDACIÓN DE extractTechnologies (matching determinista, sin LLM)`);
  console.log(`==================================================\n`);

  let failed = 0;
  for (const c of cases) {
    const actual = extractTechnologies(c.text);
    if (sameSet(actual, c.expected)) {
      console.log(`✅ [PASSED] ${c.label}`);
    } else {
      console.error(
        `❌ [FAILED] ${c.label} — esperado=[${c.expected.join(', ')}] obtenido=[${actual.join(', ')}]`
      );
      failed++;
    }
  }

  for (const c of tagCases) {
    const actual = filterKnownTechnologyTags(c.tags);
    if (sameSet(actual, c.expected)) {
      console.log(`✅ [PASSED] ${c.label}`);
    } else {
      console.error(
        `❌ [FAILED] ${c.label} — esperado=[${c.expected.join(', ')}] obtenido=[${actual.join(', ')}]`
      );
      failed++;
    }
  }

  const total = cases.length + tagCases.length;
  if (failed > 0) {
    console.error(`\n❌ [TEST SUITE FAILED] ${failed}/${total} casos fallaron.`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] extractTechnologies/filterKnownTechnologyTags verificado (${total} casos).`);
  console.log(`==================================================\n`);
  process.exit(0);
}

main();
