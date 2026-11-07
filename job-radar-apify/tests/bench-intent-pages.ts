// SIP-052 benchmark (seo-intent-pages): the per-request work of an intent
// page over 3,000 rows, and the intent SQL filter over 3,000 seeded rows of
// the isolated runner's disposable PostgreSQL. `npm run bench:intent-pages`.
// Fixed clock; synthetic rows only.
import "./require-isolated-database.js";
import { performance } from "node:perf_hooks";
import { pool } from "../src/db/client.js";
import { queryJobsPageForParity } from "../src/db/job-repository.js";
import { classifyExperience } from "../src/lib/job-experience.js";
import {
  buildHubIntentLinks,
  buildIntentAnswer,
  buildIntentHreflangTags,
  intentFilters,
  listIntentCategories,
  renderIntentAnswerHtml
} from "../src/lib/intent-pages.js";
import { buildCategoryInsights, buildCategoryMeta, buildCategoryStatsCopy, resolveCategorySlug, type SeoJob } from "../src/lib/job-seo.js";
import { buildNewTodayBlock, type RecentReadyJob } from "../src/lib/recent-jobs.js";

const NOW = new Date("2026-11-07T15:00:00.000Z");
const ROWS = 3000;
const REQUESTS = 500;
const CITIES = ["Bogotá, Colombia", "Medellín, Antioquia", "Cali", "Barranquilla", "Colombia", "Remoto"];
const DESCRIPTION =
  "Buscamos personas para atención al cliente. No se requiere experiencia, te capacitamos. Horario de lunes a sábado con un día compensatorio. " +
  "Ofrecemos contrato a término indefinido, prestaciones de ley y auxilio de transporte. ".repeat(8);

function rows(): SeoJob[] {
  return Array.from({ length: ROWS }, (_, i) => ({
    jobId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    title: i % 3 === 0 ? `Asesor comercial sin experiencia ${i}` : `Analista ${i}`,
    company: `Empresa ${i % 40}`,
    location: CITIES[i % CITIES.length],
    url: `https://example.invalid/${i}`,
    source: i % 7 === 0 ? "Computrabajo" : "LinkedIn",
    country: "CO",
    description: i % 2 === 0 ? DESCRIPTION : null,
    publishedAt: new Date(NOW.getTime() - (i % 72) * 3_600_000).toISOString()
  })) as SeoJob[];
}

interface Timing {
  msPerRequest: number;
  p95: number;
}

function time(work: () => unknown): Timing {
  for (let i = 0; i < 20; i++) work(); // warm the JIT
  const times: number[] = [];
  for (let i = 0; i < REQUESTS; i++) {
    const t = performance.now();
    work();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  return {
    msPerRequest: Number((times.reduce((a, b) => a + b, 0) / times.length).toFixed(3)),
    p95: Number(times[Math.floor(times.length * 0.95)].toFixed(3))
  };
}

function inMemory() {
  const all = rows();
  const toRecent = (job: SeoJob): RecentReadyJob => ({
    jobId: job.jobId,
    title: job.title,
    company: job.company ?? null,
    location: job.location ?? null,
    url: job.url ?? null,
    country: job.country ?? null,
    publishedAt: job.publishedAt as string,
    isLocked: false,
    contentUpdatedAt: null
  });
  const sinExp = resolveCategorySlug("sin-experiencia", "CO")!;
  const bogota = resolveCategorySlug("bogota", "CO")!;
  // What one SSR request of an intent page does in memory: the SQL picked
  // the 60 newest matching rows (CITY_HUB_PAGE_LIMIT) out of the 3,000.
  const page = all.filter((job) => classifyExperience(job) === "sin-experiencia").slice(0, 60);
  const request = () => {
    const meta = buildCategoryMeta(sinExp, 1250);
    const insights = buildCategoryInsights(sinExp, 1250, page, NOW);
    buildCategoryStatsCopy(sinExp, insights);
    const answer = buildIntentAnswer(sinExp, 1250, page);
    if (answer) renderIntentAnswerHtml(answer);
    buildNewTodayBlock(sinExp, page.map(toRecent), NOW);
    buildIntentHreflangTags(sinExp, { CO: 1250, VE: 12 });
    buildHubIntentLinks(bogota, () => 1250);
    return meta.title;
  };
  // Stress: the new answer block over all 3,000 rows in one request.
  const answerStress = () => {
    const answer = buildIntentAnswer(sinExp, ROWS, all);
    return answer ? renderIntentAnswerHtml(answer) : "";
  };
  // The in-memory classifier over 3,000 rows (never per server request:
  // the server classifies in SQL).
  const classifierStress = () => all.filter((job) => classifyExperience(job) === "sin-experiencia").length;
  global.gc?.();
  const rssBefore = process.memoryUsage().rss;
  const ssrRequest = time(request);
  const answerBlock3000 = time(answerStress);
  global.gc?.();
  const rssAfter = process.memoryUsage().rss;
  const classifier3000 = time(classifierStress);
  return {
    ssrRequest60Rows: ssrRequest,
    answerBlock3000Rows: answerBlock3000,
    classifier3000Rows: classifier3000,
    rssBeforeMb: Number((rssBefore / 1e6).toFixed(1)),
    rssAfter1000RequestsMb: Number((rssAfter / 1e6).toFixed(1))
  };
}

async function sqlFilter(): Promise<Record<string, { medianMs: number; total: number }>> {
  await pool.query(`DELETE FROM jobs WHERE url_hash LIKE 'bench-%'`);
  const values: string[] = [];
  const params: unknown[] = [];
  rows().forEach((job, i) => {
    const b = params.length;
    values.push(`('bench-' || $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, 'CO', $${b + 5}, $${b + 6}::text, jsonb_build_array($${b + 6}::text), NOW() - ($${b + 7}::int * INTERVAL '1 hour'), $${b + 8}, $${b + 9}, TRUE)`);
    params.push(i, job.title, job.company, job.location, job.url, job.source, i % 72, job.description ?? null, i % 4 !== 0);
  });
  for (let start = 0; start < values.length; start += 500) {
    const chunk = values.slice(start, start + 500);
    const offset = start * 9;
    const chunkParams = params.slice(offset, offset + chunk.length * 9);
    const renumbered = chunk.map((v) => v.replace(/\$(\d+)/g, (_, n) => `$${Number(n) - offset}`));
    await pool.query(
      `INSERT INTO jobs (url_hash, title, company, location, country, url, source, sources, published_at, description, seo_ready, is_active) VALUES ${renumbered.join(", ")}`,
      chunkParams
    );
  }
  await pool.query("ANALYZE jobs");
  const out: Record<string, { medianMs: number; total: number }> = {};
  for (const category of listIntentCategories().filter((c) => c.country === "CO")) {
    const options = { filters: intentFilters(category), limit: 60, offset: 0, includeDetails: false };
    await queryJobsPageForParity(options, true);
    const times: number[] = [];
    let total = 0;
    for (let i = 0; i < 15; i++) {
      const t = performance.now();
      total = (await queryJobsPageForParity(options, true)).total;
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    out[category.city ? `${category.city}/${category.intent}` : `${category.country}/${category.intent}`] = {
      medianMs: Number(times[Math.floor(times.length / 2)].toFixed(1)),
      total
    };
  }
  // Baseline: the Bogotá city hub's own first-page query on the same data.
  const hubTimes: number[] = [];
  for (let i = 0; i < 15; i++) {
    const t = performance.now();
    await queryJobsPageForParity({ filters: { cities: ["Bogotá"], country: "CO" }, limit: 60, offset: 0, includeDetails: false }, true);
    hubTimes.push(performance.now() - t);
  }
  hubTimes.sort((a, b) => a - b);
  out["hub Bogotá (referencia)"] = { medianMs: Number(hubTimes[7].toFixed(1)), total: -1 };
  await pool.query(`DELETE FROM jobs WHERE url_hash LIKE 'bench-%'`);
  return out;
}

const memory = inMemory();
console.log(JSON.stringify({ rows: ROWS, requests: REQUESTS, inMemory: memory }, null, 2));
const sql = await sqlFilter();
console.log(JSON.stringify({ sqlFilter3000Rows: sql }, null, 2));
await pool.end();
const ok =
  memory.ssrRequest60Rows.msPerRequest < 10 &&
  memory.answerBlock3000Rows.msPerRequest < 10 &&
  memory.rssAfter1000RequestsMb - memory.rssBeforeMb < 20;
console.log(ok ? "SIP-052 OK" : "SIP-052 FUERA DE PRESUPUESTO");
process.exit(ok ? 0 : 1);
