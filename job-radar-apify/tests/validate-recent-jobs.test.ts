/**
 * SEO Fase B — «Nuevas hoy» and IndexNow (pure, offline; test:unit blocks TCP).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  NEW_TODAY_LIMIT,
  buildNewTodayBlock,
  calendarDay,
  hubMatcher,
  hubTimeZone,
  type RecentReadyJob
} from "../src/lib/recent-jobs.js";
import { buildJobPath, resolveCategorySlug, type ResolvedCategory } from "../src/lib/job-seo.js";
import { jobMatchesRole } from "../src/lib/job-filters.js";
import {
  INDEXNOW_HOST,
  INDEXNOW_KEY,
  INDEXNOW_KEY_LOCATION,
  INDEXNOW_MAX_URLS,
  buildIndexNowPayload,
  submitIndexNow
} from "../src/lib/indexnow.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 2026-11-06 15:00 in Bogotá (UTC-5) and 16:00 in Caracas (UTC-4).
const NOW = new Date("2026-11-06T20:00:00Z");

function job(overrides: Partial<RecentReadyJob> & { jobId: string }): RecentReadyJob {
  return {
    title: "Asesor comercial",
    company: "Empresa Real SAS",
    location: "Bogotá, Bogotá D.C.",
    url: "https://example.com/oferta",
    country: "CO",
    publishedAt: "2026-11-06T14:00:00Z",
    isLocked: false,
    contentUpdatedAt: "2026-11-06T14:05:00Z",
    ...overrides
  };
}

const bogota = resolveCategorySlug("bogota", "CO") as ResolvedCategory;
const caracas = resolveCategorySlug("caracas", "VE") as ResolvedCategory;

test("hub time zones and calendar day use the hub's country, not UTC", () => {
  assert.equal(hubTimeZone("CO"), "America/Bogota");
  assert.equal(hubTimeZone("VE"), "America/Caracas");
  // 03:30 UTC on Nov 6 is still Nov 5 in Bogotá.
  assert.equal(calendarDay(new Date("2026-11-06T03:30:00Z"), "America/Bogota"), "2026-11-05");
  assert.equal(calendarDay(new Date("2026-11-06T05:30:00Z"), "America/Bogota"), "2026-11-06");
});

test("city matcher mirrors the hub SQL: folded substring, any city, country IS NULL OR = hub", () => {
  assert.ok(bogota && caracas);
  const matches = hubMatcher(bogota);
  assert.equal(matches({ title: "x", location: "Bogota, D.C., Capital District, Colombia", country: "CO" }), true);
  assert.equal(matches({ title: "x", location: "Fontibón, Bogotá D.C., Soacha", country: "CO" }), true);
  assert.equal(matches({ title: "x", location: "Bogotá", country: null }), true);
  assert.equal(matches({ title: "x", location: "Bogotá", country: "VE" }), false);
  assert.equal(matches({ title: "x", location: "Medellín, Antioquia", country: "CO" }), false);
  assert.equal(hubMatcher(caracas)({ title: "x", location: "Caracas, Venezuela", country: "VE" }), true);
});

test("role matcher uses the same word plan as jobMatchesRole (rolePredicate's twin)", () => {
  const role = resolveCategorySlug("asesor-comercial", "CO");
  assert.ok(role && role.kind === "rol");
  const matches = hubMatcher(role);
  for (const title of ["Asesor Comercial Senior", "Asesora de ventas", "Ingeniero civil", "Comercial externo"]) {
    assert.equal(matches({ title, location: "Cali", country: "CO" }), jobMatchesRole(role.label, { title }), title);
  }
  assert.equal(matches({ title: "Asesor Comercial", location: "Cali", country: "VE" }), false);
});

test("«Nuevas hoy» lists only today's jobs of the hub, newest first, real links", () => {
  const recent = [
    job({ jobId: "a", publishedAt: "2026-11-06T13:00:00Z" }),
    job({ jobId: "b", publishedAt: "2026-11-06T16:00:00Z", title: "Auxiliar contable" }),
    job({ jobId: "yesterday", publishedAt: "2026-11-06T04:00:00Z" }), // Nov 5, 23:00 in Bogotá
    job({ jobId: "future", publishedAt: "2026-11-06T21:00:00Z" }),
    job({ jobId: "medellin", location: "Medellín, Antioquia" }),
    job({ jobId: "locked", isLocked: true }),
    job({ jobId: "no-company", company: null }),
    job({ jobId: "no-url", url: null })
  ];
  const block = buildNewTodayBlock(bogota, recent, NOW);
  assert.ok(block);
  assert.equal(block.heading, `Nuevas hoy en ${bogota.label}`);
  assert.deepEqual(
    block.links.map((link) => link.path),
    [
      buildJobPath({ jobId: "b", title: "Auxiliar contable", location: "Bogotá, Bogotá D.C." }),
      buildJobPath({ jobId: "a", title: "Asesor comercial", location: "Bogotá, Bogotá D.C." })
    ]
  );
  assert.equal(block.links[0].company, "Empresa Real SAS");
});

test("«Nuevas hoy» is omitted (never padded) when nothing qualifies, capped otherwise", () => {
  assert.equal(buildNewTodayBlock(bogota, undefined, NOW), null);
  assert.equal(buildNewTodayBlock(bogota, [], NOW), null);
  assert.equal(buildNewTodayBlock(bogota, [job({ jobId: "old", publishedAt: "2026-11-05T15:00:00Z" })], NOW), null);
  const many = Array.from({ length: 25 }, (_, i) =>
    job({
      jobId: `j${String(i).padStart(2, "0")}`,
      publishedAt: new Date(Date.parse("2026-11-06T06:00:00Z") + i * 60_000).toISOString()
    })
  );
  const block = buildNewTodayBlock(bogota, many, NOW);
  assert.equal(block?.links.length, NEW_TODAY_LIMIT);
  assert.ok(block?.links[0].path.includes("/j24/"));
});

test("role hub heading and VE calendar day", () => {
  const role = resolveCategorySlug("project-manager", "VE");
  assert.ok(role);
  // 04:30 UTC Nov 6 is 00:30 Nov 6 in Caracas (UTC-4): same day as NOW there.
  const block = buildNewTodayBlock(
    role,
    [job({ jobId: "pm", title: "Project Manager", location: "Caracas", country: "VE", publishedAt: "2026-11-06T04:30:00Z" })],
    NOW
  );
  assert.equal(block?.heading, `Vacantes de ${role.label} nuevas hoy`);
  assert.equal(block?.links.length, 1);
});

test("IndexNow key file is served from static/ and matches the constant", () => {
  assert.match(INDEXNOW_KEY, /^[a-zA-Z0-9-]{8,128}$/);
  const file = path.join(__dirname, "..", "static", `${INDEXNOW_KEY}.txt`);
  assert.equal(fs.readFileSync(file, "utf8").trim(), INDEXNOW_KEY);
  assert.equal(INDEXNOW_KEY_LOCATION, `https://buscotrabajo.co/${INDEXNOW_KEY}.txt`);
});

test("IndexNow payload keeps only https URLs of this host, deduplicated and capped", () => {
  const payload = buildIndexNowPayload([
    "https://buscotrabajo.co/empleos/1/a",
    "https://buscotrabajo.co/empleos/1/a",
    "http://buscotrabajo.co/empleos/2/b",
    "https://evil.example/empleos/3/c",
    "not a url",
    "https://buscotrabajo.co/empleos/4/d"
  ]);
  assert.equal(payload.host, INDEXNOW_HOST);
  assert.equal(payload.key, INDEXNOW_KEY);
  assert.deepEqual(payload.urlList, ["https://buscotrabajo.co/empleos/1/a", "https://buscotrabajo.co/empleos/4/d"]);
  const big = buildIndexNowPayload(
    Array.from({ length: INDEXNOW_MAX_URLS + 50 }, (_, i) => `https://buscotrabajo.co/empleos/${i}/x`)
  );
  assert.equal(big.urlList.length, INDEXNOW_MAX_URLS);
});

test("IndexNow dry-run never calls fetch; an empty batch is skipped", async () => {
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    return { status: 200 };
  };
  const payload = buildIndexNowPayload(["https://buscotrabajo.co/empleos/1/a"]);
  assert.deepEqual(await submitIndexNow(payload, { execute: false, fetch: fakeFetch }), { status: "dry-run", urlCount: 1 });
  assert.deepEqual(await submitIndexNow(buildIndexNowPayload([]), { execute: true, fetch: fakeFetch }), {
    status: "skipped",
    reason: "no-urls"
  });
  assert.equal(calls, 0);
});

test("IndexNow execute: one POST with the payload; retries 429/5xx, stops on permanent errors", async () => {
  const payload = buildIndexNowPayload(["https://buscotrabajo.co/empleos/1/a"]);
  const noSleep = async () => {};
  const bodies: string[] = [];
  const ok = await submitIndexNow(payload, {
    execute: true,
    sleep: noSleep,
    fetch: async (url, init) => {
      assert.equal(url, "https://api.indexnow.org/indexnow");
      assert.equal(init.method, "POST");
      bodies.push(init.body);
      return { status: 202 };
    }
  });
  assert.deepEqual(ok, { status: "sent", httpStatus: 202, attempts: 1, urlCount: 1 });
  assert.deepEqual(JSON.parse(bodies[0]), payload);

  const statuses = [429, 503, 200];
  const retried = await submitIndexNow(payload, {
    execute: true,
    sleep: noSleep,
    fetch: async () => ({ status: statuses.shift() as number })
  });
  assert.deepEqual(retried, { status: "sent", httpStatus: 200, attempts: 3, urlCount: 1 });

  let permanentCalls = 0;
  const permanent = await submitIndexNow(payload, {
    execute: true,
    sleep: noSleep,
    fetch: async () => {
      permanentCalls += 1;
      return { status: 403 };
    }
  });
  assert.equal(permanentCalls, 1);
  assert.equal(permanent.status, "failed");

  let failingCalls = 0;
  const exhausted = await submitIndexNow(payload, {
    execute: true,
    sleep: noSleep,
    fetch: async () => {
      failingCalls += 1;
      return { status: 500 };
    }
  });
  assert.equal(failingCalls, 3);
  assert.equal(exhausted.status, "failed");
});
