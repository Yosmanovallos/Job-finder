import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { matchColombia, normalizeCountryCode, workplaceFromText } from "../src/direct/colombia-location.js";
import { isValidRef, listBoard, portalUrl } from "../src/direct/connectors.js";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";
import { isSuspectDrop, isTestPosting, selectColombianPostings } from "../src/direct/ingest.js";
import { parseEmployerSeed } from "../src/direct/seed.js";
import { runDirectTick } from "../src/direct/tick.js";
import type { HttpGet, RawAtsPosting } from "../src/direct/types.js";

/**
 * Official employer vacancies (docs/adr/0006-direct-employers.md) — offline
 * contract tests. Payload fixtures keep the real field shapes captured from
 * each public API on 2026-10-19, trimmed to what the connectors read.
 */

const NOW = new Date("2026-10-19T12:00:00Z");
const DAYS = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function fakeHttp(pages: Record<string, { status: number; body: unknown }>): HttpGet & { calls: string[] } {
  const calls: string[] = [];
  const http = (async (url: string) => {
    calls.push(url);
    const page = pages[url];
    if (!page) return { status: 404, body: "" };
    return { status: page.status, body: typeof page.body === "string" ? page.body : JSON.stringify(page.body) };
  }) as HttpGet & { calls: string[] };
  http.calls = calls;
  return http;
}

const loc = (locationTexts: string[], countryCodes: string[] = [], structuredCity: string | null = null) =>
  matchColombia({ locationTexts, countryCodes, structuredCity });

test("Colombia filter: explicit country or an unambiguous Colombian city, never LATAM or worldwide", () => {
  assert.equal(loc(["San Francisco, California"]), null, "cali ≠ California");
  assert.deepEqual(loc(["Cali, Valle del Cauca, Colombia"]), { locationRaw: "Cali, Valle del Cauca, Colombia", city: "Cali" });
  assert.equal(loc(["LATAM"]), null);
  assert.equal(loc(["Remote - Americas"]), null);
  assert.equal(loc(["Remote"]), null);
  assert.equal(loc(["Armenia"]), null, "Armenia alone is the country");
  assert.equal(loc(["Armenia, Quindío, Colombia"])?.city, "Armenia");
  assert.equal(loc(["Cartagena, Murcia, Spain"]), null);
  assert.equal(loc(["Medellin, Antioquia"])?.city, "Medellín");
  assert.equal(loc(["Bogota D.C."])?.city, "Bogotá");
  assert.equal(loc(["Remote - Colombia"])?.city, null);
});

test("Colombia filter: multi-location strings are read per segment and repeats collapse", () => {
  assert.equal(loc(["Remote - Brazil; Remote - Colombia"])?.locationRaw, "Remote - Colombia");
  assert.equal(loc(["Remote - Colombia", "Remote - Colombia"])?.locationRaw, "Remote - Colombia");
  assert.equal(loc(["Mexico City / CDMX / Mexico"]), null);
});

test("Colombia filter: a structured country wins over the text", () => {
  assert.equal(loc(["Bogotá"], ["US"]), null, "structured US vetoes");
  assert.deepEqual(loc(["Zarzal, Valle del Cauca, Colombia"], ["CO"], "Zarzal"), {
    locationRaw: "Zarzal, Valle del Cauca, Colombia",
    city: "Zarzal"
  });
  assert.deepEqual(loc([], ["CO"], "Guayabal"), { locationRaw: "Colombia", city: "Guayabal" });
});

test("Colombia filter: structured country as alpha-3 or a name still means Colombia; other countries still veto", () => {
  assert.equal(normalizeCountryCode("COL"), "CO");
  assert.equal(normalizeCountryCode(" Colombia "), "CO");
  assert.equal(normalizeCountryCode("co"), "CO");
  assert.equal(normalizeCountryCode("USA"), "USA");
  assert.deepEqual(loc(["Medellín"], ["COL"]), { locationRaw: "Medellín", city: "Medellín" });
  assert.deepEqual(loc(["Planta Tocancipá"], ["Colombia"], "Tocancipá"), { locationRaw: "Planta Tocancipá", city: "Tocancipá" });
  assert.equal(loc(["Bogotá Street, Houston"], ["USA"]), null);
  assert.equal(loc(["Lima"], ["PER"]), null);
});

test("tick deadline: once it passes no new board starts; the rest stay due", async () => {
  const sources = ["a", "b"].map((id) => ({
    id,
    employerId: id,
    employerSlug: id,
    atsType: "lever" as const,
    atsRef: id,
    lastBoardTotal: null,
    lastColombiaTotal: null,
    consecutiveSuspect: 0
  }));
  const deps = {
    http: fakeHttp({}),
    saveListing: async () => ({ inserted: 0, updated: 0, closed: 0, markedMissing: 0, missingIds: [] }),
    recordOutcome: async () => {},
    closeConfirmed: async () => 0
  };
  assert.equal((await runDirectTick(sources, deps, NOW, Date.now() - 1)).length, 0);
  assert.equal((await runDirectTick(sources, deps, NOW)).length, 2);
});

test("registry: every ATS validates its own ref and builds an https portal", async () => {
  assert.equal(isValidRef({ atsType: "greenhouse", atsRef: "sezzle" }), true);
  assert.equal(isValidRef({ atsType: "greenhouse", atsRef: "../etc" }), false);
  assert.equal(portalUrl({ atsType: "lever", atsRef: "addi" }), "https://jobs.lever.co/addi");
  const unknown = await listBoard({ atsType: "nope" as never, atsRef: "x" }, fakeHttp({}));
  assert.deepEqual(unknown, { kind: "error", detail: "ATS sin conector: nope" });
});

test("workplace only when the text states it", () => {
  assert.equal(workplaceFromText(["Remote - Colombia"]), "remote");
  assert.equal(workplaceFromText(["Bogotá (Híbrido)"]), "hybrid");
  assert.equal(workplaceFromText(["Bogotá"]), null, "never assumed onsite");
});

test("Greenhouse: entity-encoded HTML to text, office names count as locations, dates as stated", async () => {
  const http = fakeHttp({
    "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true": {
      status: 200,
      body: {
        jobs: [
          {
            id: 111,
            title: "Customer Success Senior",
            absolute_url: "https://job-boards.greenhouse.io/acme/jobs/111",
            location: { name: "Remote - Colombia" },
            offices: [{ name: "Remote - Colombia" }],
            departments: [{ name: "Operations" }],
            first_published: "2026-10-08T10:00:00-05:00",
            application_deadline: null,
            content: "&lt;p&gt;Buscamos &lt;strong&gt;líder&lt;/strong&gt; &amp;amp; mentor&lt;/p&gt;",
            company_name: "Acme"
          },
          { id: 112, title: "Account Executive", absolute_url: "https://job-boards.greenhouse.io/acme/jobs/112", location: { name: "Mexico City" } }
        ],
        meta: { total: 2 }
      }
    }
  });
  const listing = await listBoard({ atsType: "greenhouse", atsRef: "acme" }, http);
  assert.equal(listing.kind, "complete");
  if (listing.kind !== "complete") return;
  assert.equal(listing.boardTotal, 2);
  const first = listing.postings[0];
  assert.equal(first.descriptionText, "Buscamos líder & mentor");
  assert.equal(first.publishedAt, "2026-10-08T15:00:00.000Z");
  assert.equal(first.workplace, null, "Greenhouse has no workplace field");
  assert.equal(listing.postings[1].publishedAt, null, "absent date stays null");
  const { postings } = selectColombianPostings(listing.postings, NOW);
  assert.deepEqual(postings.map((posting) => [posting.externalId, posting.workplace]), [["111", "remote"]]);
});

test("Lever: the primary-only country never vetoes a secondary Colombian location", async () => {
  const http = fakeHttp({
    "https://api.lever.co/v0/postings/acme?mode=json": {
      status: 200,
      body: [
        {
          id: "a1",
          text: "Solutions Engineer",
          hostedUrl: "https://jobs.lever.co/acme/a1",
          country: "BR",
          workplaceType: "remote",
          createdAt: Date.parse(DAYS(3)),
          descriptionPlain: "Plain body",
          categories: { location: "São Paulo", allLocations: ["São Paulo", "Bogotá"], commitment: "Full-time", department: "Sales" }
        },
        {
          id: "a2",
          text: "SDR Europe",
          hostedUrl: "https://jobs.lever.co/acme/a2",
          country: "ES",
          workplaceType: "remote",
          createdAt: Date.parse(DAYS(3)),
          categories: { location: "Madrid", allLocations: ["Madrid"] }
        }
      ]
    }
  });
  const listing = await listBoard({ atsType: "lever", atsRef: "acme" }, http);
  assert.equal(listing.kind, "complete");
  if (listing.kind !== "complete") return;
  const { postings } = selectColombianPostings(listing.postings, NOW);
  assert.equal(postings.length, 1);
  assert.equal(postings[0].city, "Bogotá");
  assert.equal(postings[0].workplace, "remote");
  assert.equal(postings[0].employmentType, "Full-time");
});

test("Ashby: country written as a name, unlisted postings skipped", async () => {
  const http = fakeHttp({
    "https://api.ashbyhq.com/posting-api/job-board/acme": {
      status: 200,
      body: {
        apiVersion: "1",
        jobs: [
          {
            id: "j1",
            title: "Analytics Engineer",
            jobUrl: "https://jobs.ashbyhq.com/acme/j1",
            location: "Colombia",
            secondaryLocations: [],
            address: { postalAddress: { addressCountry: "Colombia", addressLocality: "Bogotá" } },
            isListed: true,
            isRemote: true,
            workplaceType: "Remote",
            publishedAt: DAYS(10),
            employmentType: "FullTime"
          },
          {
            id: "j2",
            title: "Hidden",
            jobUrl: "https://jobs.ashbyhq.com/acme/j2",
            location: "Colombia",
            isListed: false,
            publishedAt: DAYS(1)
          },
          {
            id: "j3",
            title: "Mexico role",
            jobUrl: "https://jobs.ashbyhq.com/acme/j3",
            location: "Bogotá",
            address: { postalAddress: { addressCountry: "Mexico" } },
            publishedAt: DAYS(1)
          }
        ]
      }
    }
  });
  const listing = await listBoard({ atsType: "ashby", atsRef: "acme" }, http);
  assert.equal(listing.kind, "complete");
  if (listing.kind !== "complete") return;
  assert.equal(listing.boardTotal, 2, "unlisted posting is not part of the public board");
  const { postings } = selectColombianPostings(listing.postings, NOW);
  assert.deepEqual(postings.map((posting) => [posting.externalId, posting.city, posting.workplace]), [["j1", "Bogotá", "remote"]]);
});

function srPage(ids: string[], totalFound: number) {
  return {
    offset: 0,
    limit: 100,
    totalFound,
    content: ids.map((id) => ({
      id,
      name: `Analista ${id}`,
      releasedDate: DAYS(2),
      company: { identifier: "Acme", name: "Acme" },
      location: { city: "Bogotá", country: "co", remote: false, hybrid: true, fullLocation: "Bogotá, Bogota, Colombia" },
      typeOfEmployment: { label: "Full-time" }
    }))
  };
}

test("SmartRecruiters: paginates to totalFound; a failed page makes the listing incomplete", async () => {
  const base = "https://api.smartrecruiters.com/v1/companies/Acme/postings?country=co&limit=100&offset=";
  const page1 = Array.from({ length: 100 }, (_, index) => `p${index}`);
  const ok = fakeHttp({
    [`${base}0`]: { status: 200, body: srPage(page1, 101) },
    [`${base}100`]: { status: 200, body: srPage(["p100"], 101) }
  });
  const listing = await listBoard({ atsType: "smartrecruiters", atsRef: "Acme" }, ok);
  assert.equal(listing.kind, "complete");
  if (listing.kind === "complete") {
    assert.equal(listing.postings.length, 101);
    assert.equal(listing.postings[0].applyUrl, "https://jobs.smartrecruiters.com/Acme/p0");
    assert.equal(listing.postings[0].workplace, "hybrid");
  }

  const broken = fakeHttp({
    [`${base}0`]: { status: 200, body: srPage(page1, 101) },
    [`${base}100`]: { status: 500, body: "" }
  });
  assert.equal((await listBoard({ atsType: "smartrecruiters", atsRef: "Acme" }, broken)).kind, "error");
});

test("listBoard: 404, bad shape and an unsafe ref never produce a complete listing", async () => {
  assert.equal((await listBoard({ atsType: "greenhouse", atsRef: "missing" }, fakeHttp({}))).kind, "not_found");
  const badShape = fakeHttp({ "https://api.lever.co/v0/postings/acme?mode=json": { status: 200, body: { ok: true } } });
  assert.equal((await listBoard({ atsType: "lever", atsRef: "acme" }, badShape)).kind, "error");
  const unsafe = fakeHttp({});
  assert.equal((await listBoard({ atsType: "ashby", atsRef: "../../evil" }, unsafe)).kind, "error");
  assert.equal(unsafe.calls.length, 0, "an unsafe ref never reaches the network");
});

function raw(overrides: Partial<RawAtsPosting>): RawAtsPosting {
  return {
    externalId: "x",
    title: "Analista",
    applyUrl: "https://example.com/x",
    locationTexts: ["Bogotá, Colombia"],
    countryCodes: [],
    structuredCity: null,
    workplace: null,
    descriptionText: null,
    department: null,
    employmentType: null,
    publishedAt: DAYS(1),
    validThrough: null,
    companyName: null,
    ...overrides
  };
}

test("selection: 30-day window and validThrough by the ATS's own dates; unknown date kept; test postings out", () => {
  const { postings, stats } = selectColombianPostings(
    [
      raw({ externalId: "fresh" }),
      raw({ externalId: "old", publishedAt: DAYS(31) }),
      raw({ externalId: "expired", validThrough: DAYS(1) }),
      raw({ externalId: "undated", publishedAt: null }),
      raw({ externalId: "test", title: "Test 09222026 AI interview" }),
      raw({ externalId: "fresh", title: "Analista (repetida)" })
    ],
    NOW
  );
  assert.deepEqual(postings.map((posting) => posting.externalId).sort(), ["fresh", "undated"]);
  assert.equal(stats.stale, 2);
  assert.equal(stats.testPostings, 1);
  assert.equal(postings.find((posting) => posting.externalId === "undated")?.publishedAt, null, "never invented");
});

test("test-posting markers are explicit only", () => {
  assert.equal(isTestPosting("Test 09222026 AI interview"), true);
  assert.equal(isTestPosting("QA Engineer - DO NOT APPLY"), true);
  assert.equal(isTestPosting("CL_Template_Analista de Laboratorio"), false);
  assert.equal(isTestPosting("Test Automation Engineer"), false);
});

test("mass-drop guard", () => {
  assert.equal(isSuspectDrop(null, 0), false, "first run");
  assert.equal(isSuspectDrop(5, 0), true, "board emptied");
  assert.equal(isSuspectDrop(50, 9), true, "below a fifth");
  assert.equal(isSuspectDrop(50, 10), false);
  assert.equal(isSuspectDrop(5, 1), false, "small boards move a lot");
});

test("seed: references only, unique boards, https portals", () => {
  const seeds = parseEmployerSeed(JSON.parse(readFileSync(new URL("../data/direct-employers.seed.json", import.meta.url), "utf8")));
  assert.ok(seeds.length > 0);
  for (const seed of seeds) {
    for (const source of seed.sources) assert.match(source.portalUrl, /^https:\/\//);
  }
  const cemex = seeds.find((seed) => seed.slug === "cemex");
  assert.deepEqual(cemex?.aliases, []);
  assert.deepEqual(cemex?.sources.map((source) => `${source.atsType}:${source.atsRef}`), ["successfactors:jobs.cemex.com"]);
  const holcimAbs = seeds.find((seed) => seed.slug === "holcim-abs");
  assert.deepEqual(holcimAbs?.aliases, ["Holcim ABS"]);
  assert.deepEqual(holcimAbs?.sources.map((source) => `${source.atsType}:${source.atsRef}:${source.enabled}`), ["successfactors:careers.holcimgroup.com/Holcim_abs:true"]);
  assert.throws(() => parseEmployerSeed({ employers: [{ slug: "a", displayName: "A", websiteDomain: null, aliases: [], sources: [], directJobs: [] }] }));
});

test("schema block: additive, new tables only, no link to jobs", () => {
  const schema = readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const block = /-- BEGIN direct-employers\n([\s\S]*?)-- END direct-employers/.exec(schema)?.[1];
  assert.ok(block, "schema.sql no contiene el bloque direct-employers");
  const ddl = block.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(ddl, /\bDROP\b|\bTRUNCATE\b|\bDELETE FROM\b|ALTER TABLE jobs|REFERENCES jobs|ON jobs\b/i);
  for (const table of ["employers", "employer_aliases", "employer_sources", "direct_jobs"]) {
    assert.match(ddl, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`));
    assert.match(ddl, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`));
  }
  assert.match(ddl, /REVOKE ALL ON employers, employer_aliases, employer_sources, direct_jobs FROM anon, authenticated;/);
});

test("db guard: production URLs are refused unless explicitly allowed", () => {
  const prod = "postgresql://postgres:x@aws-0-us-west-1.pooler.supabase.com:5432/postgres";
  assert.throws(() => assertDirectDatabaseAllowed(prod, []), /Bloqueado/);
  assert.throws(() => assertDirectDatabaseAllowed(undefined, []), /Falta/);
  assert.doesNotThrow(() => assertDirectDatabaseAllowed("postgresql://u:p@127.0.0.1:55433/db", []));
  assert.doesNotThrow(() => assertDirectDatabaseAllowed(prod, ["--allow-remote-db"]));
});

test("the web server never imports the direct-employer module", () => {
  const root = fileURLToPath(new URL("../src/", import.meta.url));
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== "direct") walk(full);
      } else if (
        /\.(ts|tsx)$/.test(name) &&
        // The repositories of the module itself (scripts-only; tests/validate-direct-discovery.test.ts walks the server's import graph).
        ![
          path.join(root, "db", "direct-repository.ts"),
          path.join(root, "db", "direct-discovery-repository.ts"),
          path.join(root, "db", "direct-projection-repository.ts")
        ].includes(full)
      ) {
        if (/from ["'][^"']*(\/direct\/|direct-repository)/.test(readFileSync(full, "utf8"))) offenders.push(path.relative(root, full));
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
});
