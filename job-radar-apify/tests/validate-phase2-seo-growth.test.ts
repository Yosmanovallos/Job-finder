import assert from "node:assert/strict";
import test from "node:test";
import { COUNTRIES } from "../src/countries/index.js";
import { CITY_OPTIONS } from "../src/lib/job-filters.js";
import { INTENT_PAGE_CACHE_ENTRIES, listIntentCategories } from "../src/lib/intent-pages.js";
import {
  GUARDED_CITY_HUBS,
  SITE_URL,
  buildCategoryMeta,
  buildCategoryPath,
  buildJobTitleTag,
  isGuardedCityHub,
  listGuardedCityHubs,
  resolveCategorySlug,
  slugify,
  type SeoJob
} from "../src/lib/job-seo.js";
import {
  PACED_FALLBACK_MS,
  PACED_FALLBACK_MS_VE,
  decidePacing,
  pacedFallbackMsFor
} from "../src/queue/source-pacing.js";
import { boundedGet } from "../src/direct/http.js";
import {
  WORKDAY_POD_429_COOLDOWN_MS,
  WORKDAY_POD_MAX_CONSECUTIVE_429,
  WORKDAY_POD_PAUSE_MS,
  interleaveSourcesByHost,
  runDirectTick,
  workdayPodOf,
  type TickDeps
} from "../src/direct/tick.js";
import type { EmployerSourceRow } from "../src/db/direct-repository.js";
import type { HttpGet, HttpRequestInit } from "../src/direct/types.js";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-11-27T12:00:00Z");

function makeSource(
  slug: string,
  atsType: EmployerSourceRow["atsType"],
  atsRef: string
): EmployerSourceRow {
  return {
    id: `src-${slug}`,
    employerId: `emp-${slug}`,
    employerSlug: slug,
    atsType,
    atsRef,
    lastBoardTotal: null,
    lastColombiaTotal: null,
    consecutiveSuspect: 0
  };
}

test("Phase 2 (2A): VE pacing restores 4.5 h fallback without lowering CO's 7 h floor", () => {
  assert.equal(PACED_FALLBACK_MS, 7 * HOUR);
  assert.equal(PACED_FALLBACK_MS_VE, 4.5 * HOUR);
  assert.equal(pacedFallbackMsFor("CO"), 7 * HOUR);
  assert.equal(pacedFallbackMsFor("VE"), 4.5 * HOUR);

  assert.equal(
    decidePacing({ country: "VE", trigger: "workflow_dispatch", lastParticipationMs: NOW - 4.4 * HOUR, nowMs: NOW }).allowed,
    false
  );
  assert.deepEqual(
    decidePacing({ country: "VE", trigger: "workflow_dispatch", lastParticipationMs: NOW - 4.5 * HOUR, nowMs: NOW }),
    { allowed: true, reason: "fallback_gap", sources: ["LinkedIn-VE", "Computrabajo-VE"] }
  );
  assert.equal(
    decidePacing({ country: "CO", trigger: "workflow_dispatch", lastParticipationMs: NOW - 6.9 * HOUR, nowMs: NOW }).allowed,
    false
  );
  assert.equal(
    decidePacing({ country: "CO", trigger: "workflow_dispatch", lastParticipationMs: NOW - 7 * HOUR, nowMs: NOW }).allowed,
    true
  );
});

test("Phase 2 (2B-1): workdayPodOf and interleaveSourcesByHost spread Workday pods cleanly", () => {
  assert.equal(workdayPodOf(makeSource("bancolombia", "workday", "bancolombia/wd5/Bancolombia")), "wd5");
  assert.equal(workdayPodOf(makeSource("rappi", "workday", "rappi/wd12/Rappi_jobs")), "wd12");
  assert.equal(workdayPodOf(makeSource("accenture", "workday", "accenture/WD103/Careers")), "wd103");
  assert.equal(workdayPodOf(makeSource("sezzle", "greenhouse", "sezzle")), null);

  const clustered = [
    makeSource("w5-1", "workday", "w51/wd5/Site"),
    makeSource("w5-2", "workday", "w52/wd5/Site"),
    makeSource("w5-3", "workday", "w53/wd5/Site"),
    makeSource("w12-1", "workday", "w121/wd12/Site"),
    makeSource("gh-1", "greenhouse", "sezzle")
  ];
  const ordered = interleaveSourcesByHost(clustered).map((s) => s.employerSlug);
  assert.deepEqual(ordered, ["w5-1", "w12-1", "gh-1", "w5-2", "w5-3"]);
});

test("Phase 2 (2B-1): runDirectTick serializes same-pod Workday reads and stops pod after 3 consecutive 429s", async () => {
  assert.equal(WORKDAY_POD_PAUSE_MS, 2_500);
  assert.equal(WORKDAY_POD_429_COOLDOWN_MS, 10_000);
  assert.equal(WORKDAY_POD_MAX_CONSECUTIVE_429, 3);

  const emptyWorkday = JSON.stringify({ total: 0, jobPostings: [] });
  const emptyLever = JSON.stringify([]);
  const activeOnWd5 = { count: 0, max: 0 };
  const sleeps: number[] = [];
  const recorded: Array<{ id: string; status: string }> = [];

  const fourHundredTwentyNineHosts = new Set([
    "p1.wd5.myworkdayjobs.com",
    "p2.wd5.myworkdayjobs.com",
    "p3.wd5.myworkdayjobs.com",
    "p4.wd5.myworkdayjobs.com"
  ]);

  const http: HttpGet = async (url, init?: HttpRequestInit) => {
    const parsed = new URL(url);
    const onWd5 = parsed.hostname.endsWith(".wd5.myworkdayjobs.com");
    if (onWd5) {
      activeOnWd5.count++;
      if (activeOnWd5.count > activeOnWd5.max) activeOnWd5.max = activeOnWd5.count;
    }
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (parsed.pathname.endsWith("/robots.txt")) return { status: 200, body: "User-agent: *\nAllow: /\n" };
      if (parsed.hostname === "api.lever.co") return { status: 200, body: emptyLever };
      if (init?.json && fourHundredTwentyNineHosts.has(parsed.hostname)) {
        return { status: 429, body: "{}" };
      }
      if (init?.json) return { status: 200, body: emptyWorkday };
      return { status: 404, body: "" };
    } finally {
      if (onWd5) activeOnWd5.count--;
    }
  };

  const deps: TickDeps = {
    http,
    saveListing: async () => ({ inserted: 0, updated: 0, closed: 0, markedMissing: 0, missingIds: [] }),
    recordOutcome: async (sourceId, outcome) => {
      recorded.push({ id: sourceId, status: outcome.status });
    },
    closeConfirmed: async () => 0
  };

  // First prove same-pod serialization on healthy boards (no 429 wait).
  const healthySources = [
    makeSource("ok1", "workday", "ok1/wd5/Careers"),
    makeSource("ok2", "workday", "ok2/wd5/Careers"),
    makeSource("ok3", "workday", "ok3/wd5/Careers"),
    makeSource("w12", "workday", "w12/wd12/Careers"),
    makeSource("lv1", "lever", "addi")
  ];
  const healthyReports = await runDirectTick(healthySources, deps, new Date(NOW), Number.POSITIVE_INFINITY, {
    sleep: async (ms) => {
      sleeps.push(ms);
    }
  });
  assert.equal(healthyReports.length, 5);
  assert.equal(activeOnWd5.max, 1, "same Workday pod must never run concurrently across workers");
  assert.ok(
    sleeps.filter((ms) => ms > 0 && ms <= WORKDAY_POD_PAUSE_MS).length >= 2,
    `expected normal per-pod pauses, got ${JSON.stringify(sleeps)}`
  );

  // Now prove 429 cooldown + circuit break after 3 consecutive 429s on wd5 without blocking wd12 or lever.
  const pod429Sleeps: number[] = [];
  recorded.length = 0;
  const tripSources = [
    makeSource("p1", "workday", "p1/wd5/Careers"),
    makeSource("p2", "workday", "p2/wd5/Careers"),
    makeSource("p3", "workday", "p3/wd5/Careers"),
    makeSource("p4", "workday", "p4/wd5/Careers"),
    makeSource("w12b", "workday", "ok12/wd12/Careers"),
    makeSource("lv2", "lever", "addi2")
  ];
  const tripReports = await runDirectTick(tripSources, deps, new Date(NOW), Number.POSITIVE_INFINITY, {
    sleep: async (ms) => {
      pod429Sleeps.push(ms);
    }
  });
  // p1, p2, p3 hit 429 (tripping wd5); p4 is skipped without recordOutcome; w12b & lv2 still complete ok.
  assert.equal(recorded.some((r) => r.id === "src-p4"), false, "4th wd5 board must be skipped without error penalty");
  assert.equal(tripReports.find((r) => r.employer === "p4"), undefined);
  assert.equal(tripReports.find((r) => r.employer === "w12b")?.status, "ok");
  assert.equal(tripReports.find((r) => r.employer === "lv2")?.status, "ok");
  assert.ok(
    pod429Sleeps.filter((ms) => ms > WORKDAY_POD_PAUSE_MS && ms <= WORKDAY_POD_429_COOLDOWN_MS).length >= 2,
    `expected 429 cooldown sleeps, got ${JSON.stringify(pod429Sleeps)}`
  );
});

test("Phase 2 (2B-1): boundedGet skips inner retry on 429 when noRetryOn429 is set", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response("{}", { status: 429, headers: { "retry-after": "0.01" } });
  }) as typeof fetch;

  try {
    const single = await boundedGet("https://example.test/wday/cxs/a/b/jobs", { json: {}, noRetryOn429: true });
    assert.equal(single.status, 429);
    assert.equal(calls, 1, "Workday passes noRetryOn429 to avoid stacking retries");

    calls = 0;
    const retried = await boundedGet("https://example.test/api/other", { json: {} });
    assert.equal(retried.status, 429);
    assert.equal(calls, 2, "default boundedGet keeps its single retry on 429");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Phase 2 (2B-2): directIndexingEnabled defaults on and disables on false/0/off", async () => {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = "postgresql://job_radar_test:offline@127.0.0.1:1/job_radar_test_offline";
  }
  const { directIndexingEnabled } = await import("../src/db/indexing-repository.js");
  assert.equal(directIndexingEnabled({}), true);
  assert.equal(directIndexingEnabled({ DIRECT_INDEXING_ENABLED: "true" }), true);
  for (const off of ["false", "0", "off", " FALSE "]) {
    assert.equal(directIndexingEnabled({ DIRECT_INDEXING_ENABLED: off }), false, off);
  }
});

test("Phase 2 (2C-1 + 2C-2): 4 verified guarded hubs active, Aburrá/puerto-ordaz deferred, city retained in long titles", () => {
  const expectedNew: Array<{ label: string; slug: string; country: "CO" | "VE" }> = [
    { label: "Chía", slug: "chia", country: "CO" },
    { label: "Sincelejo", slug: "sincelejo", country: "CO" },
    { label: "Anzoátegui", slug: "anzoategui", country: "VE" },
    { label: "San Cristóbal", slug: "san-cristobal", country: "VE" }
  ];
  for (const hub of expectedNew) {
    const resolved = resolveCategorySlug(hub.slug, "CO");
    assert.deepEqual(resolved, { kind: "ciudad", label: hub.label, country: hub.country });
    assert.equal(isGuardedCityHub(resolved!), true);
    assert.equal(buildCategoryPath(resolved!), `/empleos/${hub.slug}`);
    assert.equal(buildCategoryMeta(resolved!, 25).canonicalUrl, `${SITE_URL}/empleos/${hub.slug}`);
    assert.ok(!CITY_OPTIONS.includes(hub.label), hub.label);
    assert.ok(!COUNTRIES.CO.cities.includes(hub.label) && !COUNTRIES.VE.cities.includes(hub.label), hub.label);
  }

  for (const deferred of ["itagui", "envigado", "bello", "puerto-ordaz"]) {
    assert.equal(resolveCategorySlug(deferred, "CO"), null, deferred);
    assert.equal(resolveCategorySlug(deferred, "VE"), null, deferred);
  }

  assert.equal(
    INTENT_PAGE_CACHE_ENTRIES >= listIntentCategories().length + listGuardedCityHubs().length + 4,
    true
  );
  assert.ok(GUARDED_CITY_HUBS.length >= 16);

  const multiCityJob: SeoJob = {
    jobId: "11111111-1111-4111-8111-111111111111",
    title: "Gestor comercial de servicios financieros empresariales",
    company: "Banco Ejemplo",
    location: "Palmira, Valle del Cauca, Colombia",
    url: "https://example.com/job/1",
    dateText: "Hoy",
    source: "Magneto",
    country: "CO"
  };
  const titleTag = buildJobTitleTag(multiCityJob);
  assert.ok(titleTag.startsWith(multiCityJob.title));
  assert.ok(titleTag.endsWith(" en Palmira"), `expected city preserved in '${titleTag}'`);
});
