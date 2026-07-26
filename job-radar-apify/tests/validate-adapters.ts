import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { allAdapters, Job } from "../src/sources/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, "fixtures");

const TEST_KEYWORDS = ["analista de datos"];

async function runCharacterizationTests() {
  console.log(`\n==================================================`);
  console.log(`🧪 CHARACTERIZATION TESTS: VALIDANDO SOURCE ADAPTERS VS GOLDEN FIXTURES`);
  console.log(`==================================================\n`);

  let allPassed = true;
  const resultsSummary: Array<{
    name: string;
    status: "PASSED" | "FAILED";
    fixtureCount: number;
    adapterCount: number;
    reason?: string;
  }> = [];

  for (const adapter of allAdapters) {
    const key = adapter.name.toLowerCase();
    const fixturePath = path.join(FIXTURES_DIR, `${key}.json`);

    let fixtureJobs: Job[] = [];
    if (fs.existsSync(fixturePath)) {
      try {
        fixtureJobs = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
      } catch (e) {
        fixtureJobs = [];
      }
    }

    console.log(
      `\n🔍 [Test] Probando adaptador: "${adapter.name}" (Baseline Fixture: ${fixtureJobs.length} vacantes)...`
    );

    try {
      const startTime = Date.now();
      const liveJobs = await adapter.fetch(TEST_KEYWORDS);
      const durationMs = Date.now() - startTime;

      // Validation 1: Result is array
      if (!Array.isArray(liveJobs)) {
        console.error(
          `❌ [FAILED] ${adapter.name}: Se esperaba un Array de vacantes, recibido: ${typeof liveJobs}`
        );
        resultsSummary.push({
          name: adapter.name,
          status: "FAILED",
          fixtureCount: fixtureJobs.length,
          adapterCount: 0,
          reason: "Formato de retorno no es Array"
        });
        allPassed = false;
        continue;
      }

      // Validation 2: Field integrity
      let invalidItems = 0;
      for (const job of liveJobs) {
        if (!job.jobId || !job.title || !job.url || !job.source) {
          invalidItems++;
        }
      }

      if (invalidItems > 0) {
        console.error(
          `❌ [FAILED] ${adapter.name}: ${invalidItems} vacantes carecen de campos obligatorios (jobId, title, url, source)`
        );
        resultsSummary.push({
          name: adapter.name,
          status: "FAILED",
          fixtureCount: fixtureJobs.length,
          adapterCount: liveJobs.length,
          reason: `${invalidItems} vacantes con esquema corrupto`
        });
        allPassed = false;
        continue;
      }

      // Validation 3: Non-degradation check
      // If fixture had > 0 items, live search must return > 0 items
      if (fixtureJobs.length > 0 && liveJobs.length === 0) {
        console.error(
          `❌ [FAILED] ${adapter.name}: Degradación detectada. Baseline tenía ${fixtureJobs.length} vacantes, la ejecución actual devolvió 0.`
        );
        resultsSummary.push({
          name: adapter.name,
          status: "FAILED",
          fixtureCount: fixtureJobs.length,
          adapterCount: 0,
          reason: "Degradación total (0 resultados cuando el baseline tenía datos)"
        });
        allPassed = false;
        continue;
      }

      console.log(
        `✅ [PASSED] ${adapter.name}: ${liveJobs.length} vacantes devueltas en ${durationMs}ms (Baseline: ${fixtureJobs.length})`
      );
      resultsSummary.push({
        name: adapter.name,
        status: "PASSED",
        fixtureCount: fixtureJobs.length,
        adapterCount: liveJobs.length
      });
    } catch (err: any) {
      console.error(
        `❌ [FAILED] ${adapter.name}: Excepción no capturada durante la ejecución: ${err?.message || err}`
      );
      resultsSummary.push({
        name: adapter.name,
        status: "FAILED",
        fixtureCount: fixtureJobs.length,
        adapterCount: 0,
        reason: err?.message || String(err)
      });
      allPassed = false;
    }
  }

  console.log(`\n==================================================`);
  console.log(`📊 RESUMEN FINAL DE PRUEBAS DE CARACTERIZACIÓN:`);
  console.log(`==================================================`);
  console.table(resultsSummary);

  if (!allPassed) {
    console.error(
      `\n❌ [TEST SUITE FAILED] Al menos un SourceAdapter no cumplió la prueba de caracterización.`
    );
    process.exit(1);
  } else {
    console.log(
      `\n🎉 [TEST SUITE PASSED] ¡Todos los ${allAdapters.length} SourceAdapters pasaron la verificación de caracterización al 100%!`
    );
    process.exit(0);
  }
}

runCharacterizationTests();
