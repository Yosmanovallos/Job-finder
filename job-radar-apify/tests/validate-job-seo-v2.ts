/**
 * Job SEO V2 — integration suite (disposable PostgreSQL only).
 *
 * Drives the REAL pipeline — saveJobs(), the detail state machine, the
 * readiness repository, purge, the reconcile/classify/cleanup scripts and the
 * HTTP server — and asserts the invariant that matters most: the four Google
 * consumers always agree for every job:
 *
 *   robots (index vs noindex,follow) · JobPosting · job sitemap · URL_UPDATED
 *
 * i.e. never "noindex + in sitemap", never "not ready + JobPosting", never
 * "not ready + URL_UPDATED queued".
 */
import "./require-isolated-database.js";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db/client.js";
import { saveJobs } from "../src/db/job-repository.js";
import {
  claimDueDetailJobs,
  DETAIL_BACKOFF_MS,
  mutateReadinessRelevantJobs,
  recordDetailOutcome,
  refreshGoogleReadiness
} from "../src/db/job-readiness-repository.js";
import { checkIndexingTarget, getPendingIndexingBatch, wasJobPurged } from "../src/db/indexing-repository.js";
import { purgeOldJobs } from "../src/db/scheduler-repository.js";
import { buildJobPath, buildJobUrl, escapeHtml } from "../src/lib/job-seo.js";
import type { Job } from "../src/sources/types.js";
import { DETAIL_ADAPTER_NAMES, sourceSupportsDetail } from "../src/sources/detail-capability.js";

/** The JobPosting properties these tests read. */
interface PostingShape {
  title?: string;
  description?: string;
  employmentType?: string;
  validThrough?: string;
  jobLocationType?: string;
  hiringOrganization?: { name?: string };
  jobLocation?: { address: { addressLocality?: string; addressRegion?: string; addressCountry?: string } };
  applicantLocationRequirements?: { name: string }[];
  [key: string]: unknown;
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.TEST_HTTP_PORT);
const BASE = `http://127.0.0.1:${PORT}`;

const RICH = [
  "Buscamos analista de datos para el equipo de riesgo crediticio de la compañía.",
  "Serás responsable de construir tableros de seguimiento de cartera y automatizar reportes mensuales.",
  "Horario de lunes a viernes, contrato a término indefinido."
].join("\n");
const RICH_REQ = ["Profesional en estadística o afines.", "Dos años de experiencia con SQL.", "Manejo de Power BI."];

function job(overrides: Partial<Job>): Job {
  return {
    jobId: "",
    title: "Analista de Datos",
    company: "Empresa V2",
    location: "Bogotá, Colombia",
    url: `https://example.com/v2/${Math.random().toString(36).slice(2)}`,
    dateText: "Hoy",
    source: "Magneto",
    publishedAt: new Date(Date.now() - 3_600_000).toISOString(),
    country: "CO",
    ...overrides
  };
}

async function saveOne(input: Job): Promise<string> {
  const result = await saveJobs([input], "V2 test");
  assert.equal(result.insertedJobs.length, 1, `expected an insert for ${input.title}`);
  return result.insertedJobs[0].id;
}

async function row(id: string) {
  const result = await pool.query(`SELECT * FROM jobs WHERE id = $1`, [id]);
  return result.rows[0];
}

async function updatedRows(id: string) {
  const result = await pool.query(
    `SELECT status, priority FROM indexing_queue WHERE job_id = $1 AND notification_type = 'URL_UPDATED' ORDER BY created_at`,
    [id]
  );
  return result.rows as { status: string; priority: number }[];
}

function startServer(): ChildProcess {
  return spawn(process.execPath, [...process.execArgv, path.join(root, "src", "server.ts")], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: { ...process.env, PORT: String(PORT) }
  });
}

async function waitForServer(server: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error(`server exited with ${server.exitCode}`);
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("server did not start");
}

function runScript(script: string, args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, path.join(root, "scripts", script), ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

async function snapshotPath(label: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "job-seo-v2-snapshot-"));
  return path.join(directory, `${label}.json`);
}

interface PageFacts {
  status: number;
  indexable: boolean;
  noindexFollow: boolean;
  jobPosting: PostingShape | null;
  applyLink: boolean;
  html: string;
}

async function page(id: string): Promise<PageFacts> {
  const current = await row(id);
  const response = await fetch(`${BASE}${buildJobPath({ jobId: id, title: current.title, location: current.location })}`);
  const html = await response.text();
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const postings = blocks.filter((block) => block["@type"] === "JobPosting");
  assert.ok(postings.length <= 1, "at most one JobPosting per page");
  const robots = /<meta name="robots" content="([^"]+)">/.exec(html)?.[1] ?? null;
  return {
    status: response.status,
    indexable: robots === null,
    noindexFollow: robots === "noindex,follow",
    jobPosting: postings[0] ?? null,
    applyLink: /data-apply-link href="https?:\/\//.test(html),
    html
  };
}

/** The page's JobPosting, asserting it exists (for jobs the test expects to be ready). */
async function postingOf(id: string): Promise<PostingShape & { description: string }> {
  const posting = (await page(id)).jobPosting;
  assert.ok(posting && typeof posting.description === "string", "expected a JobPosting with a description");
  return posting as PostingShape & { description: string };
}

async function sitemapLocs(): Promise<string[]> {
  const response = await fetch(`${BASE}/sitemap-jobs.xml`);
  assert.equal(response.status, 200);
  return [...(await response.text()).matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
}

/** The central invariant, checked for one job against all four consumers. */
async function assertConsumersAgree(id: string, expectedReady: boolean, label: string) {
  const current = await row(id);
  const facts = await page(id);
  const locs = await sitemapLocs();
  const url = buildJobUrl({ jobId: id, title: current.title, location: current.location });
  const queued = (await updatedRows(id)).filter((r) => r.status === "pending" || r.status === "sent");
  assert.equal(facts.status, 200, `${label}: user-visible page must be 200`);
  assert.ok(facts.applyLink, `${label}: source link must be in the raw HTML`);
  assert.equal(facts.indexable, expectedReady, `${label}: robots`);
  assert.equal(facts.noindexFollow, !expectedReady, `${label}: noindex,follow when not ready`);
  assert.equal(facts.jobPosting !== null, expectedReady, `${label}: JobPosting`);
  assert.equal(locs.includes(url), expectedReady, `${label}: sitemap membership`);
  if (!expectedReady) assert.equal(queued.length, 0, `${label}: URL_UPDATED must never be queued for a non-ready job`);
  else assert.ok(queued.length >= 1, `${label}: a ready job has its URL_UPDATED`);
  // Brief §15: the raw server-rendered HTML (no hydration, no login) carries
  // the title, the source's own description, source attribution and the
  // apply path — for every user-visible job, ready or not.
  const body = facts.html.split('<div id="app">')[1] ?? "";
  assert.ok(body.includes(`<h1>`) && body.includes(escapeHtml(current.title)), `${label}: title in raw HTML`);
  assert.ok(body.includes(`Fuente: ${escapeHtml(current.source)}`), `${label}: source attribution in raw HTML`);
  const firstLine = String(current.description ?? "").split("\n")[0]?.trim();
  if (firstLine) assert.ok(body.includes(escapeHtml(firstLine)), `${label}: source description in raw HTML`);
  console.log(`✅ [consumers] ${label}: ready=${expectedReady} — robots, JobPosting, sitemap and URL_UPDATED agree.`);
}

// --- 1. Schema block: additive, idempotent -----------------------------------
{
  const schema = await readFile(path.join(root, "src/db/schema.sql"), "utf8");
  const block = /-- BEGIN job-seo-v2\r?\n([\s\S]*?)-- END job-seo-v2/.exec(schema)?.[1];
  assert.ok(block, "schema.sql must contain the job-seo-v2 block");
  assert.doesNotMatch(block!, /\bDROP\b|\bTRUNCATE\b|DELETE FROM|ALTER TABLE (?!jobs |indexing_queue )/i, "block must be purely additive");
  await pool.query(block!);
  await pool.query(block!);
  const migrationDry = await runScript("migrate-job-seo-v2.ts", []);
  assert.equal(migrationDry.code, 0, migrationDry.output);
  const migrationApply = await runScript("migrate-job-seo-v2.ts", ["--apply"]);
  assert.equal(migrationApply.code, 0, migrationApply.output);
  const migrationRerun = await runScript("migrate-job-seo-v2.ts", ["--apply"]);
  assert.equal(migrationRerun.code, 0, migrationRerun.output);
  console.log("✅ [schema] job-seo-v2 block is additive and idempotent (applied twice on top of the runner's copy).");
}

// --- 2. Detail capability registry matches the real adapters ------------------
{
  // Every adapter imports src/index.ts, which exits at import time without
  // Notion settings. Synthetic values never reach the network: the isolated
  // runner blocks every TCP connection except the disposable database.
  process.env.NOTION_TOKEN = "job-seo-v2-synthetic-notion-token";
  process.env.NOTION_DATABASE_ID = "job-seo-v2-synthetic-notion-database";
  const { allAdapters } = await import("../src/sources/index.js");
  const withDetail = allAdapters.filter((adapter) => typeof adapter.fetchDetail === "function").map((a) => a.name).sort();
  assert.deepEqual(withDetail, [...DETAIL_ADAPTER_NAMES].sort(), "detail-capability.ts out of sync with allAdapters");
  assert.equal(sourceSupportsDetail("Glassdoor"), false);
  assert.equal(sourceSupportsDetail("Torre"), false);
  console.log("✅ [capability] detail-capability.ts matches every adapter that implements fetchDetail.");
}

const server = startServer();
try {
  await waitForServer(server);

  // --- 3. New job with a complete source description → READY at insert --------
  const fullId = await saveOne(job({ title: "Analista de Riesgo", description: RICH, requirements: RICH_REQ, employmentType: "Tiempo completo" }));
  assert.equal((await row(fullId)).detail_status, "complete");
  assert.equal((await row(fullId)).seo_ready, true);
  assert.deepEqual(await updatedRows(fullId), [{ status: "pending", priority: 2 }], "exactly one URL_UPDATED, newly-ready lane");
  assert.ok((await row(fullId)).content_updated_at, "content_updated_at set from real content");
  await assertConsumersAgree(fullId, true, "new job with full source description");
  const fullPosting = await postingOf(fullId);
  assert.equal(fullPosting.validThrough, undefined, "no synthetic validThrough");
  assert.equal(fullPosting.jobLocation?.address.addressCountry, "CO");
  assert.ok((await page(fullId)).html.includes(fullPosting.description), "JSON-LD description is the visible description");

  // --- 3b. Every readiness-relevant administrative mutation is atomic -------
  const mutationId = await saveOne(job({ title: "Especialista de Operaciones", description: RICH, requirements: RICH_REQ }));
  const beforeCountryHash = (await row(mutationId)).content_hash;
  const blockedCountry = await mutateReadinessRelevantJobs([
    { id: mutationId, patch: { country: "VE" } }
  ]);
  assert.equal(blockedCountry[0]?.outcome?.ready, false);
  const countryBlocked = await row(mutationId);
  assert.ok(countryBlocked.seo_reasons.includes("LOCATION_COUNTRY_CONFLICT"));
  assert.notEqual(countryBlocked.content_hash, beforeCountryHash, "country changes the persisted content hash");
  assert.deepEqual(await updatedRows(mutationId), [{ status: "superseded", priority: 2 }], "ready to non-ready supersedes pending update");
  await assertConsumersAgree(mutationId, false, "country conflict after shared mutation");

  const restoredCountry = await mutateReadinessRelevantJobs([
    { id: mutationId, patch: { country: "CO" } }
  ]);
  assert.equal(restoredCountry[0]?.outcome?.notified, "content_changed");
  assert.deepEqual(await updatedRows(mutationId), [
    { status: "superseded", priority: 2 },
    { status: "pending", priority: 3 }
  ], "previously-ready recovery is a meaningful update");

  const changedEmployment = await mutateReadinessRelevantJobs([
    { id: mutationId, patch: { employment_type: "Temporal" } }
  ], { contentObtained: true });
  assert.equal(changedEmployment[0]?.outcome?.notified, "content_changed");
  assert.equal((await updatedRows(mutationId)).filter((item) => item.status === "pending").length, 1, "one pending update remains idempotent");

  await mutateReadinessRelevantJobs([{ id: mutationId, patch: { is_active: false } }]);
  const inactive = await row(mutationId);
  assert.equal(inactive.seo_ready, false);
  assert.ok(inactive.seo_reasons.includes("INACTIVE"));
  assert.equal((await updatedRows(mutationId)).filter((item) => item.status === "pending").length, 0, "deactivation supersedes pending updates");

  const unreadyId = await saveOne(job({ title: "Coordinador de Operaciones", location: "Bogotá", country: null, description: RICH, requirements: RICH_REQ }));
  assert.equal((await row(unreadyId)).seo_ready, false);
  const firstReady = await mutateReadinessRelevantJobs([{ id: unreadyId, patch: { country: "CO" } }]);
  assert.equal(firstReady[0]?.outcome?.notified, "first_ready");
  assert.deepEqual(await updatedRows(unreadyId), [{ status: "pending", priority: 2 }], "not-ready to ready uses newly-ready priority");
  await assertConsumersAgree(unreadyId, true, "country completion after shared mutation");

  const workanaId = await saveOne(job({ title: "Consultor Independiente", source: "Workana", description: RICH, requirements: RICH_REQ }));
  assert.ok((await row(workanaId)).seo_reasons.includes("SOURCE_REQUIRES_JOB_CLASSIFICATION"));
  await assertConsumersAgree(workanaId, false, "rich Workana remains user-visible but not SEO-ready");

  const magnetoCountryOnlyId = await saveOne(job({ title: "Analista de Inventarios", location: "Colombia", country: "CO", description: RICH, requirements: RICH_REQ }));
  assert.ok((await row(magnetoCountryOnlyId)).seo_reasons.includes("MISSING_LOCATION"));
  await assertConsumersAgree(magnetoCountryOnlyId, false, "Magneto country-only location");

  // --- 4. Thin new job from a detail-capable source → PENDING, nothing for Google
  const thinId = await saveOne(job({ title: "Asesor Comercial", source: "LinkedIn" }));
  const thin = await row(thinId);
  assert.equal(thin.detail_status, "pending");
  assert.equal(thin.seo_ready, false);
  assert.ok(thin.detail_next_attempt_at, "pending rows are due for the drain");
  await assertConsumersAgree(thinId, false, "thin new job (pending detail)");

  // --- 5. Thin job from a source without fetchDetail → UNSUPPORTED -------------
  const glassId = await saveOne(job({ title: "Ayudante de Mecánica", source: "Glassdoor", location: "Maracay", country: "VE" }));
  assert.equal((await row(glassId)).detail_status, "unsupported");
  await assertConsumersAgree(glassId, false, "unsupported source");

  // --- 6. Torre-style teaser → never complete ------------------------------------
  const torreId = await saveOne(
    job({ title: "Business Developer", source: "Torre", location: "Remoto", country: null, descriptionKind: "snippet", remoteType: "fully_remote",
      description: "You will drive sustainable agricultural growth by empowering farmers with innovative technology." })
  );
  const torre = await row(torreId);
  assert.equal(torre.detail_status, "unsupported");
  assert.ok(torre.seo_reasons.includes("DESCRIPTION_SNIPPET"));
  assert.ok(torre.seo_reasons.includes("INVALID_REMOTE_LOCATION"), "remote without source-stated countries");
  await assertConsumersAgree(torreId, false, "Torre teaser, remote without eligible countries");

  // --- 7. Drain claim: SKIP LOCKED + lease ----------------------------------------
  const claimed = await claimDueDetailJobs({ source: "LinkedIn", market: "OTHER" }, 10);
  assert.deepEqual(claimed.map((c) => c.id), [thinId]);
  assert.equal((await claimDueDetailJobs({ source: "LinkedIn", market: "OTHER" }, 10)).length, 0, "a claimed row is leased");
  assert.equal((await claimDueDetailJobs({ source: "Glassdoor", market: "VE" }, 10)).length, 0, "unsupported rows are never claimed");
  console.log("✅ [drain] claim uses SKIP LOCKED + a lease; unsupported rows are never claimed.");

  // --- 8. Detail success → COMPLETE → READY → one URL_UPDATED ---------------------
  const successStatus = await recordDetailOutcome(thinId, {
    kind: "success",
    detail: { description: RICH, requirements: RICH_REQ, employmentType: "Medio tiempo" }
  });
  assert.equal(successStatus, "complete");
  assert.deepEqual(await updatedRows(thinId), [{ status: "pending", priority: 2 }]);
  assert.equal((await row(thinId)).description_source, "detail");
  await assertConsumersAgree(thinId, true, "thin job after successful detail fetch");
  assert.equal(
    await recordDetailOutcome(thinId, { kind: "success", detail: { description: "otra" } }),
    null,
    "a late duplicate result cannot move a settled row"
  );

  // --- 9. Faults → retry with bounded backoff → failed ---------------------------
  const retryId = await saveOne(job({ title: "Contador Público", source: "Elempleo" }));
  const t0 = Date.now();
  for (let attempt = 1; attempt <= DETAIL_BACKOFF_MS.length; attempt++) {
    const status = await recordDetailOutcome(retryId, { kind: "fault", errorClass: "FetchTimeoutError" });
    const current = await row(retryId);
    if (attempt < DETAIL_BACKOFF_MS.length) {
      assert.equal(status, "retry");
      const waited = new Date(current.detail_next_attempt_at).getTime() - t0;
      assert.ok(waited >= DETAIL_BACKOFF_MS[attempt - 1] - 5_000, `backoff after attempt ${attempt}`);
    } else {
      assert.equal(status, "failed");
      assert.equal(current.detail_next_attempt_at, null);
    }
    assert.equal(current.detail_last_error, "FetchTimeoutError");
  }
  const rateLimitedId = await saveOne(job({ title: "Ejecutivo de Ventas", source: "Elempleo" }));
  await recordDetailOutcome(rateLimitedId, { kind: "fault", errorClass: "FetchRateLimitedError", retryAfterMs: 6 * 3_600_000 });
  const rl = await row(rateLimitedId);
  assert.ok(new Date(rl.detail_next_attempt_at).getTime() - Date.now() > 5 * 3_600_000, "Retry-After is honored when longer than backoff");
  const noDetailId = await saveOne(job({ title: "Auxiliar Administrativo", source: "Magneto" }));
  assert.equal(await recordDetailOutcome(noDetailId, { kind: "no_detail" }), "retry");
  assert.equal(await recordDetailOutcome(noDetailId, { kind: "no_detail" }), "no_detail");
  await assertConsumersAgree(retryId, false, "detail attempts exhausted");
  console.log("✅ [state] retry → bounded backoff → failed; Retry-After honored; no_detail is terminal after 2.");

  // --- 10. Rediscovery of an unchanged job never queues again ----------------------
  const again = await saveJobs([job({ title: "Analista de Riesgo", description: RICH, requirements: RICH_REQ, employmentType: "Tiempo completo", url: (await row(fullId)).url })]);
  assert.equal(again.savedCount, 0);
  await refreshGoogleReadiness(fullId);
  assert.equal((await updatedRows(fullId)).length, 1, "re-scrape / re-evaluation of unchanged content never enqueues");

  // --- 11. Duplicate by content fingerprint → merged, no second page ---------------
  const dup = await saveJobs([job({ title: "Analista de Riesgo", description: RICH, requirements: RICH_REQ, employmentType: "Tiempo completo", url: "https://other.example.com/same-job", source: "Elempleo" })]);
  assert.equal(dup.savedCount, 0);
  assert.equal(dup.duplicateCount, 1);
  assert.deepEqual((await row(fullId)).sources, ["Magneto", "Elempleo"]);
  console.log("✅ [dedupe] same job from another source merges into the canonical row — no second page.");

  // --- 12. Meaningful content change of a ready job → one update, lane ≤ 3 --------
  await pool.query(`UPDATE jobs SET employment_type = 'Temporal' WHERE id = $1`, [fullId]);
  const changed = await refreshGoogleReadiness(fullId, { contentObtained: true });
  assert.equal(changed?.notified, "content_changed");
  const fullQueue = await updatedRows(fullId);
  assert.equal(fullQueue.filter((r) => r.status === "pending").length, 1, "still one pending row per URL (idempotent)");

  // --- 13. Remote (source-stated, with countries) and hybrid ----------------------
  const remoteId = await saveOne(
    job({ title: "Desarrollador Backend", source: "WeRemoto", location: "Remoto", country: null, description: RICH, requirements: RICH_REQ,
      remoteType: "fully_remote", applicantCountries: ["CO", "VE"] })
  );
  await assertConsumersAgree(remoteId, true, "100% remote with source-stated eligible countries");
  const remotePosting = await postingOf(remoteId);
  assert.equal(remotePosting.jobLocationType, "TELECOMMUTE");
  assert.deepEqual((remotePosting.applicantLocationRequirements ?? []).map((c) => c.name), ["Colombia", "Venezuela"]);
  assert.equal(remotePosting.jobLocation, undefined);

  const hybridId = await saveOne(
    job({ title: "Diseñador Gráfico", source: "GetOnBoard", location: "Híbrido - Medellín, Antioquia", description: RICH, requirements: RICH_REQ, remoteType: "hybrid" })
  );
  await assertConsumersAgree(hybridId, true, "hybrid job");
  const hybridPosting = await postingOf(hybridId);
  assert.equal(hybridPosting.jobLocationType, undefined, "hybrid is never TELECOMMUTE");
  assert.equal(hybridPosting.jobLocation?.address.addressLocality, "Medellín");

  const remoteUnknownId = await saveOne(
    job({ title: "Soporte Técnico", source: "RemoteOK", location: "Remote", country: null, description: RICH, requirements: RICH_REQ })
  );
  await assertConsumersAgree(remoteUnknownId, false, "remote text with unknown eligibility");

  // --- 14. Malicious description --------------------------------------------------
  const evilId = await saveOne(
    job({ title: "Analista QA", source: "RemoteOK", location: "Cali, Colombia", description: `${RICH}\n<script>alert("x")</script><img src=x onerror=alert(1)>`, requirements: RICH_REQ })
  );
  const evil = await page(evilId);
  assert.doesNotMatch(evil.html.split("<div id=\"app\">")[1] ?? "", /<script>alert|<img src=x/i, "source text is escaped in the body");
  assert.doesNotMatch(JSON.stringify(evil.jobPosting ?? {}), /<script|<img/i, "source text is escaped in JSON-LD");
  console.log("✅ [xss] hostile source text is escaped in the visible body and in JSON-LD.");

  // --- 15. Source expiration (validThrough) --------------------------------------
  const expiringId = await saveOne(
    job({ title: "Ingeniero Civil", source: "Magneto", description: RICH, requirements: RICH_REQ, validThrough: new Date(Date.now() + 86_400_000).toISOString() })
  );
  assert.ok((await postingOf(expiringId)).validThrough, "a source-stated expiration is emitted");
  await pool.query(`UPDATE jobs SET valid_through = NOW() - INTERVAL '1 minute' WHERE id = $1`, [expiringId]);
  const expired = await page(expiringId);
  assert.equal(expired.jobPosting, null);
  assert.ok(expired.noindexFollow);
  assert.ok(!(await sitemapLocs()).some((loc) => loc.includes(expiringId)));
  assert.deepEqual(await checkIndexingTarget({ url: buildJobUrl({ jobId: expiringId, title: "Ingeniero Civil", location: "Bogotá, Colombia" }), notification_type: "URL_UPDATED", job_id: expiringId }), { send: false, reason: "target_not_seo_ready" });
  console.log("✅ [expiry] a passed source validThrough turns every consumer off on read.");

  // --- 16. Send order and pre-send check -----------------------------------------
  const batch = await getPendingIndexingBatch(100);
  const priorities = batch.map((r) => r.priority);
  assert.deepEqual(priorities, [...priorities].sort((a, b) => a - b), "priority lanes first");
  assert.deepEqual(await checkIndexingTarget({ url: "https://buscotrabajo.co/empleos/00000000-0000-4000-8000-000000000000/x", notification_type: "URL_UPDATED", job_id: null }), { send: false, reason: "target_missing" });

  // --- 17. Purge → legitimate URL_DELETED (lane 1), pending UPDATED superseded, 410
  const purgedUrl = buildJobUrl({ jobId: thinId, title: (await row(thinId)).title, location: (await row(thinId)).location });
  await pool.query(`UPDATE jobs SET last_seen_at = NOW() - INTERVAL '31 days' WHERE id = $1`, [thinId]);
  assert.ok((await purgeOldJobs()) >= 1);
  const deleted = await pool.query(`SELECT notification_type, status, priority, superseded_reason FROM indexing_queue WHERE url = $1 ORDER BY notification_type`, [purgedUrl]);
  assert.deepEqual(deleted.rows, [
    { notification_type: "URL_DELETED", status: "pending", priority: 1, superseded_reason: null },
    { notification_type: "URL_UPDATED", status: "superseded", priority: 2, superseded_reason: "target_deleted" }
  ]);
  assert.ok(await wasJobPurged(thinId));
  assert.equal((await fetch(`${BASE}${new URL(purgedUrl).pathname}`)).status, 410);
  console.log("✅ [expiry] purge keeps the 410 tombstone, queues URL_DELETED in lane 1 and supersedes the pending update.");

  // --- 18. Reconcile never enqueues non-ready jobs --------------------------------
  const reconcile = await runScript("backfill-indexing-queue.ts", []);
  assert.equal(reconcile.code, 0, reconcile.output);
  for (const id of [glassId, torreId, retryId, remoteUnknownId, expiringId]) {
    assert.equal((await updatedRows(id)).filter((r) => r.status === "pending" || r.status === "sent").length, 0, `reconcile queued non-ready ${id}`);
  }
  console.log("✅ [reconcile] the hourly reconcile never queues a non-ready job.");
  // The expired job had a URL_UPDATED queued while it was ready. Until the
  // hourly reconcile, that row is pending but can never be sent (pre-send
  // check); after it, the four consumers agree at rest too.
  await assertConsumersAgree(expiringId, false, "expired job (after the hourly reconcile)");

  // --- 19. Legacy classification: dry-run writes nothing, apply is exact and idempotent
  const legacy = await pool.query<{ id: string; kind: string }>(
    `INSERT INTO jobs (url_hash, content_fingerprint, title, company, location, country, url, source, sources, published_at, description, requirements)
     VALUES
       (md5('legacy-rich'), md5('fp-legacy-rich'), 'Legacy Rico', 'Legado SA', 'Bogotá, Colombia', 'CO', 'https://example.com/l1', 'LinkedIn', '["LinkedIn"]', NOW() - INTERVAL '40 days', $1, $2::jsonb),
       (md5('legacy-none'), md5('fp-legacy-none'), 'Legacy Vacio', 'Legado SA', 'Bogotá, Colombia', 'CO', 'https://example.com/l2', 'LinkedIn', '["LinkedIn"]', NOW() - INTERVAL '3 days', NULL, '[]'),
       (md5('legacy-torre'), md5('fp-legacy-torre'), 'Legacy Torre', 'Legado SA', 'Remoto', NULL, 'https://example.com/l3', 'Torre', '["Torre"]', NOW() - INTERVAL '3 days', 'Short tagline for a remote role.', '[]'),
       (md5('legacy-glass'), md5('fp-legacy-glass'), 'Legacy Glass', 'Legado SA', 'Caracas', 'VE', 'https://example.com/l4', 'Glassdoor', '["Glassdoor"]', NOW() - INTERVAL '3 days', NULL, '[]')
     RETURNING id, title AS kind`,
    [RICH, JSON.stringify(RICH_REQ)]
  );
  const unclassifiedBefore = Number((await pool.query(`SELECT COUNT(*) FROM jobs WHERE detail_status IS NULL`)).rows[0].count);
  const dry = await runScript("classify-job-readiness.ts", ["--json"]);
  assert.equal(dry.code, 0, dry.output);
  assert.equal(Number((await pool.query(`SELECT COUNT(*) FROM jobs WHERE detail_status IS NULL`)).rows[0].count), unclassifiedBefore, "dry-run writes nothing");
  const report = JSON.parse(dry.output.slice(dry.output.indexOf("{")));
  assert.equal(report.mode, "dry-run");
  assert.equal(report.examined, unclassifiedBefore);
  assert.ok(report.perSource.Torre.remoteAmbiguity >= 1);

  const classifierWithoutSnapshot = await runScript("classify-job-readiness.ts", ["--apply", "--json"]);
  assert.notEqual(classifierWithoutSnapshot.code, 0, "classifier apply refuses to write without a pre-write snapshot");
  assert.equal(Number((await pool.query(`SELECT COUNT(*) FROM jobs WHERE detail_status IS NULL`)).rows[0].count), unclassifiedBefore, "missing snapshot leaves legacy rows unchanged");
  const classifierSnapshot = await snapshotPath("classify");
  const applied = await runScript("classify-job-readiness.ts", ["--apply", "--json", `--snapshot-out=${classifierSnapshot}`]);
  assert.equal(applied.code, 0, applied.output);
  const classifierBackup = JSON.parse(await readFile(classifierSnapshot, "utf8"));
  assert.equal(classifierBackup.version, 1);
  assert.ok(classifierBackup.jobs.every((snapshotRow: Record<string, unknown>) => !Object.hasOwn(snapshotRow, "description")), "snapshot excludes source descriptions");
  const byTitle = Object.fromEntries(
    (await pool.query(`SELECT title, detail_status, seo_ready, content_updated_at, seo_ready_at FROM jobs WHERE title LIKE 'Legacy %'`)).rows.map((r) => [r.title, r])
  );
  assert.equal(byTitle["Legacy Rico"].detail_status, "complete");
  assert.equal(byTitle["Legacy Rico"].seo_ready, true);
  assert.ok(byTitle["Legacy Rico"].seo_ready_at);
  assert.equal(byTitle["Legacy Rico"].content_updated_at, null, "legacy content change time stays unknown (no fake lastmod)");
  assert.equal(byTitle["Legacy Vacio"].detail_status, "backlog");
  assert.equal(byTitle["Legacy Torre"].detail_status, "unsupported");
  assert.equal(byTitle["Legacy Glass"].detail_status, "unsupported");
  assert.equal(Number((await pool.query(`SELECT COUNT(*) FROM jobs WHERE detail_status IS NULL AND is_active`)).rows[0].count), 0);
  assert.equal(
    (await claimDueDetailJobs({ source: "LinkedIn", market: "OTHER" }, 50)).filter((c) => legacy.rows.some((l) => l.id === c.id)).length,
    0,
    "backlog rows are never claimed by the tick's drain (historical backfill needs authorization)"
  );
  const rerun = await runScript("classify-job-readiness.ts", ["--apply", "--json", `--snapshot-out=${await snapshotPath("classify-rerun")}`]);
  assert.equal(JSON.parse(rerun.output.slice(rerun.output.indexOf("{"))).examined, 0, "classification is idempotent");
  const legacyRichId = legacy.rows.find((r) => r.kind === "Legacy Rico")!.id;
  assert.equal((await updatedRows(legacyRichId)).length, 0, "classification never enqueues by itself");
  console.log("✅ [classify] dry-run writes nothing; apply is exact, idempotent, never enqueues, never fakes lastmod.");

  // --- 20. Queue cleanup: dry-run is read-only, apply only moves pending rows -------
  const fixtureUrl = (id: string, title: string, location: string) => buildJobUrl({ jobId: id, title, location });
  const legacyRichUrl = fixtureUrl(legacyRichId, "Legacy Rico", "Bogotá, Colombia");
  const glassUrl = fixtureUrl(glassId, "Ayudante de Mecánica", "Maracay");
  const goneUrl = "https://buscotrabajo.co/empleos/00000000-0000-4000-8000-00000000abcd/gone";
  const goneNotifiedUrl = "https://buscotrabajo.co/empleos/00000000-0000-4000-8000-00000000abce/gone-notified";
  const staleSlugUrl = "https://buscotrabajo.co/empleos/" + legacyRichId + "/old-slug";
  // Legacy-shaped rows: no job_id, default priority 5 — as they exist in
  // production, where pending duplicates exist and therefore the idempotency
  // index could not be created yet. Reproduce that state in this disposable
  // DB (the index was created by the schema block because the test queue had
  // no duplicates); the cleanup below must bring it back.
  await pool.query(`DROP INDEX IF EXISTS uq_indexing_queue_pending_url_type`);
  await pool.query(
    `INSERT INTO indexing_queue (url, notification_type, status, created_at, sent_at) VALUES
       ($1, 'URL_UPDATED', 'pending', NOW() - INTERVAL '40 days', NULL),
       ($1, 'URL_UPDATED', 'pending', NOW() - INTERVAL '39 days', NULL),
       ($2, 'URL_UPDATED', 'pending', NOW() - INTERVAL '38 days', NULL),
       ($3, 'URL_UPDATED', 'pending', NOW() - INTERVAL '37 days', NULL),
       ($3, 'URL_DELETED', 'pending', NOW() - INTERVAL '5 days', NULL),
       ($4, 'URL_UPDATED', 'sent', NOW() - INTERVAL '50 days', NOW() - INTERVAL '49 days'),
       ($4, 'URL_DELETED', 'pending', NOW() - INTERVAL '4 days', NULL),
       ($5, 'URL_UPDATED', 'pending', NOW() - INTERVAL '36 days', NULL),
       ($6, 'URL_DELETED', 'pending', NOW() - INTERVAL '3 days', NULL)`,
    [legacyRichUrl, glassUrl, goneUrl, goneNotifiedUrl, staleSlugUrl, glassUrl]
  );
  const totalBefore = Number((await pool.query(`SELECT COUNT(*) FROM indexing_queue`)).rows[0].count);
  const snapshot = async () => (await pool.query(`SELECT id, status, priority FROM indexing_queue ORDER BY id`)).rows;
  const beforeRows = await snapshot();
  const cleanupDry = await runScript("cleanup-indexing-queue.ts", []);
  assert.equal(cleanupDry.code, 0, cleanupDry.output);
  assert.deepEqual(await snapshot(), beforeRows, "cleanup dry-run is read-only");
  for (const metric of ["pending_total", "pending_updated", "pending_deleted", "updated_target_exists", "updated_target_404", "updated_target_410", "updated_target_seo_ready", "updated_target_not_seo_ready", "pending_duplicates"]) {
    assert.ok(cleanupDry.output.includes(metric), `dry-run reports ${metric}`);
  }
  const cleanupWithoutSnapshot = await runScript("cleanup-indexing-queue.ts", ["--apply"]);
  assert.notEqual(cleanupWithoutSnapshot.code, 0, "cleanup apply refuses to write without a pre-write snapshot");
  assert.deepEqual(await snapshot(), beforeRows, "missing cleanup snapshot leaves queue unchanged");
  const cleanupSnapshot = await snapshotPath("cleanup");
  const cleanupApply = await runScript("cleanup-indexing-queue.ts", ["--apply", `--snapshot-out=${cleanupSnapshot}`]);
  assert.equal(cleanupApply.code, 0, cleanupApply.output);
  assert.equal(Number((await pool.query(`SELECT COUNT(*) FROM indexing_queue`)).rows[0].count), totalBefore, "no queue row is ever deleted");
  const state = async (url: string, type: string) =>
    (await pool.query(`SELECT status, priority, superseded_reason FROM indexing_queue WHERE url = $1 AND notification_type = $2 ORDER BY created_at`, [url, type])).rows;
  assert.deepEqual(await state(legacyRichUrl, "URL_UPDATED"), [
    { status: "pending", priority: 4, superseded_reason: null },
    { status: "superseded", priority: 5, superseded_reason: "duplicate" }
  ]);
  assert.deepEqual((await state(glassUrl, "URL_UPDATED")).map((r) => r.superseded_reason), ["target_not_seo_ready"]);
  assert.deepEqual((await state(glassUrl, "URL_DELETED")).map((r) => r.superseded_reason), ["target_still_exists"]);
  assert.deepEqual((await state(goneUrl, "URL_UPDATED")).map((r) => r.superseded_reason), ["target_deleted"]);
  assert.deepEqual(await state(goneUrl, "URL_DELETED"), [{ status: "pending", priority: 4, superseded_reason: null }], "never-notified deletion: low lane");
  assert.deepEqual(await state(goneNotifiedUrl, "URL_DELETED"), [{ status: "pending", priority: 1, superseded_reason: null }], "notified deletion: top lane");
  assert.deepEqual((await state(staleSlugUrl, "URL_UPDATED")).map((r) => r.superseded_reason), ["url_changed"]);
  const pendingUpdatedForMissing = await pool.query(
    `SELECT COUNT(*) FROM indexing_queue WHERE url = $1 AND notification_type = 'URL_DELETED' AND created_at > NOW() - INTERVAL '1 minute'`,
    [goneUrl]
  );
  assert.equal(Number(pendingUpdatedForMissing.rows[0].count), 0, "a stale update is never converted into a deletion");
  const cleanupRowsAfterApply = await snapshot();
  const cleanupRestoreDry = await runScript("restore-job-seo-v2-state.ts", [`--from=${cleanupSnapshot}`]);
  assert.equal(cleanupRestoreDry.code, 0, cleanupRestoreDry.output);
  assert.deepEqual(await snapshot(), cleanupRowsAfterApply, "cleanup restore dry-run is read-only");
  const cleanupRestore = await runScript("restore-job-seo-v2-state.ts", [`--from=${cleanupSnapshot}`, "--apply"]);
  assert.equal(cleanupRestore.code, 0, cleanupRestore.output);
  assert.deepEqual(await snapshot(), beforeRows, "queue cleanup snapshot restores every changed pending row");
  const cleanupReapply = await runScript("cleanup-indexing-queue.ts", ["--apply", `--snapshot-out=${await snapshotPath("cleanup-reapply")}`]);
  assert.equal(cleanupReapply.code, 0, cleanupReapply.output);
  const queueIndexDry = await runScript("finalize-job-seo-v2-queue-index.ts", []);
  assert.equal(queueIndexDry.code, 0, queueIndexDry.output);
  const queueIndexApply = await runScript("finalize-job-seo-v2-queue-index.ts", ["--apply"]);
  assert.equal(queueIndexApply.code, 0, queueIndexApply.output);
  const uniqueIndex = await pool.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'uq_indexing_queue_pending_url_type'`);
  assert.equal(uniqueIndex.rowCount, 1, "idempotency index exists once duplicates are gone");
  console.log("✅ [cleanup] dry-run read-only; apply supersedes (never deletes, never converts to DELETE) and re-prioritizes.");

  // --- 21. Final sweep: every job in the table obeys the invariant ----------------
  const all = await pool.query(`SELECT id, seo_ready, valid_through FROM jobs WHERE is_active`);
  const locs = new Set(await sitemapLocs());
  const sitemapIds = new Set([...locs].map((loc) => /\/empleos\/([0-9a-f-]{36})\//.exec(loc)?.[1]));
  for (const current of all.rows) {
    const readyNow = current.seo_ready && (!current.valid_through || new Date(current.valid_through) > new Date());
    assert.equal(sitemapIds.has(current.id), readyNow, `sitemap/readiness mismatch for ${current.id}`);
    if (!readyNow) {
      const queued = await pool.query(
        `SELECT 1 FROM indexing_queue WHERE job_id = $1 AND notification_type = 'URL_UPDATED' AND status = 'pending'`,
        [current.id]
      );
      assert.equal(queued.rowCount, 0, `non-ready job ${current.id} has a pending URL_UPDATED`);
    }
  }
  console.log(`✅ [sweep] ${all.rowCount} active jobs: sitemap membership and pending URL_UPDATED match readiness for every one.`);

  // --- 22. Recovery: classifier snapshot restores its mutable state ------------
  const classifierRestoreDry = await runScript("restore-job-seo-v2-state.ts", [`--from=${classifierSnapshot}`]);
  assert.equal(classifierRestoreDry.code, 0, classifierRestoreDry.output);
  const classifierRestore = await runScript("restore-job-seo-v2-state.ts", [`--from=${classifierSnapshot}`, "--apply"]);
  assert.equal(classifierRestore.code, 0, classifierRestore.output);
  const originalLegacyRich = classifierBackup.jobs.find((snapshotRow: Record<string, unknown>) => snapshotRow.id === legacyRichId)!;
  const restoredLegacyRich = (await pool.query(`SELECT detail_status, seo_ready, seo_reasons, content_hash FROM jobs WHERE id = $1`, [legacyRichId])).rows[0];
  assert.equal(restoredLegacyRich.detail_status, originalLegacyRich.detail_status, "classifier restore returns detail status to its snapshot value");
  assert.equal(restoredLegacyRich.seo_ready, originalLegacyRich.seo_ready, "classifier restore returns readiness to its snapshot value");
  assert.deepEqual(restoredLegacyRich.seo_reasons, originalLegacyRich.seo_reasons, "classifier restore returns reason codes to their snapshot value");
  assert.equal(restoredLegacyRich.content_hash, originalLegacyRich.content_hash, "classifier restore returns hash to its snapshot value");
  console.log("✅ [recovery] classifier and queue-cleanup snapshots both restore their captured mutable state.");
} finally {
  server.kill("SIGTERM");
  await pool.end();
}
