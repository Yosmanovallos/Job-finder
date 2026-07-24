import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  scrapeLinkedIn,
  scrapeComputrabajo,
  scrapeElempleo,
  scrapeTorre,
  scrapeWorkana,
  scrapeMagneto,
  scrapeWeRemoto,
  scrapeGetOnBoard,
  scrapeRemoteOK,
  scrapeRemotive,
  scrapeIndeedLocal,
  scrapeGlassdoor,
  Job
} from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, '..', 'tests', 'fixtures');

if (!fs.existsSync(FIXTURES_DIR)) {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
}

const TEST_KEYWORD = 'analista de datos';

async function runFixtureCapture() {
  console.log(`\n==================================================`);
  console.log(`📸 CAPTURANDO GOLDEN FIXTURES PARA ROL: "${TEST_KEYWORD}"`);
  console.log(`==================================================\n`);

  const scrapers: Array<{ name: string; runner: () => Promise<Job[]> }> = [
    { name: 'linkedin', runner: () => scrapeLinkedIn(TEST_KEYWORD) },
    { name: 'computrabajo', runner: () => scrapeComputrabajo(TEST_KEYWORD) },
    { name: 'elempleo', runner: () => scrapeElempleo(TEST_KEYWORD) },
    { name: 'torre', runner: () => scrapeTorre(TEST_KEYWORD) },
    { name: 'workana', runner: () => scrapeWorkana(TEST_KEYWORD) },
    { name: 'magneto', runner: () => scrapeMagneto(TEST_KEYWORD) },
    { name: 'weremoto', runner: () => scrapeWeRemoto() },
    { name: 'getonboard', runner: () => scrapeGetOnBoard() },
    { name: 'remoteok', runner: () => scrapeRemoteOK() },
    { name: 'remotive', runner: () => scrapeRemotive([TEST_KEYWORD]) },
    { name: 'indeed', runner: () => scrapeIndeedLocal(TEST_KEYWORD) },
    { name: 'glassdoor', runner: () => scrapeGlassdoor(TEST_KEYWORD) }
  ];

  const summary: Record<string, number> = {};

  for (const { name, runner } of scrapers) {
    console.log(`\n[Fixture] Ejecutando scraper: ${name}...`);
    try {
      const jobs = await runner();
      const fixturePath = path.join(FIXTURES_DIR, `${name}.json`);
      fs.writeFileSync(fixturePath, JSON.stringify(jobs, null, 2), 'utf-8');
      summary[name] = jobs.length;
      console.log(`✅ [Fixture] ${name}: ${jobs.length} vacantes guardadas en ${fixturePath}`);
    } catch (err: any) {
      console.error(`❌ [Fixture] ${name} falló:`, err?.message || err);
      summary[name] = 0;
      const fixturePath = path.join(FIXTURES_DIR, `${name}.json`);
      fs.writeFileSync(fixturePath, JSON.stringify([], null, 2), 'utf-8');
    }
  }

  console.log(`\n==================================================`);
  console.log(`📊 RESUMEN DE GOLDEN FIXTURES CAPTURADOS:`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`==================================================\n`);
}

runFixtureCapture();
