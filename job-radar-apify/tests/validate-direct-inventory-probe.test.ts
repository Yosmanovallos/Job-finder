import assert from "node:assert/strict";
import test from "node:test";
import {
  conflictOf,
  failureStatus,
  judgeBoard,
  nextProbeDays,
  readBoard,
  runInventoryProbe,
  type BoardRead,
  type EnablementContext,
  type InventoryBoard,
  type ProbeRunDeps,
  type RecordedProbe
} from "../src/direct/discovery/inventory-probe.js";
import type { HttpGet } from "../src/direct/types.js";

/**
 * ATS inventory probe and automatic enablement, phase I2
 * (openspec/changes/ats-inventory-co-2026-11, INV-010…INV-014) — offline.
 * Every ATS answer is a fixture; nothing here reaches the network or a
 * database.
 */

const NOW = new Date("2026-10-27T12:00:00Z");
const RECENT = "Mon, 26 Oct 2026 15:43:03 -0500";
const AGENCIES = new Set(["adecco", "manpower"]);

function routes(map: Record<string, { status: number; body: string } | (() => never)>): HttpGet & { calls: string[] } {
  const calls: string[] = [];
  const http = (async (url: string) => {
    calls.push(url);
    const entry = map[url];
    if (typeof entry === "function") entry();
    return entry ?? { status: 404, body: "" };
  }) as HttpGet & { calls: string[] };
  http.calls = calls;
  return http;
}

function teamtailorFeed(company: string, items: { id: number; title: string; country: string }[]): string {
  const body = items
    .map(
      (item) =>
        `<item><title>${item.title}</title><link>https://acme.teamtailor.com/jobs/${item.id}-x</link><pubDate>${RECENT}</pubDate>` +
        `<tt:locations><tt:location><tt:country>${item.country}</tt:country></tt:location></tt:locations></item>`
    )
    .join("");
  return `<rss version="2.0"><channel><title>${company}</title>${body}</channel></rss>`;
}

const ttUrl = (ref: string) => `https://${ref}.teamtailor.com/jobs.rss?per_page=100&offset=0`;
const board = (atsType: InventoryBoard["atsType"], atsRef: string, id = `${atsType}:${atsRef}`): InventoryBoard => ({ id, atsType, atsRef, probeAttempts: 0 });

const BOGOTA = [
  { id: 1, title: "Analista de Datos", country: "Colombia" },
  { id: 2, title: "Contador", country: "Colombia" },
  { id: 3, title: "Ingeniero", country: "Colombia" },
  { id: 4, title: "Sales Rep", country: "Mexico" }
];

test("INV-010 scenario: a board declaring 'Acme Colombia SAS' with 3 Colombian postings is eligible", async () => {
  const http = routes({ [ttUrl("acme")]: { status: 200, body: teamtailorFeed("Acme Colombia SAS", BOGOTA) } });
  const read = await readBoard(board("teamtailor", "acme"), http, NOW);
  assert.deepEqual(read, { kind: "listed", totalCount: 4, colombiaCount: 3, deferred: 0, declaredNames: ["Acme Colombia SAS"] });
  const verdict = judgeBoard("teamtailor", read, AGENCIES);
  assert.equal(verdict.status, "eligible");
  assert.equal(verdict.status === "eligible" && verdict.companyKey, "acme");
  assert.equal(verdict.declaredName, "Acme Colombia SAS");
});

test("INV-010: the same board named 'Adecco' is an agency; a name that declares itself one too", async () => {
  for (const name of ["Adecco", "Servicios Temporales del Norte"]) {
    const http = routes({ [ttUrl("acme")]: { status: 200, body: teamtailorFeed(name, BOGOTA) } });
    const verdict = judgeBoard("teamtailor", await readBoard(board("teamtailor", "acme"), http, NOW), AGENCIES);
    assert.equal(verdict.status, "agency", name);
  }
});

test("INV-012: an ATS that declares no name is ambiguous, never enabled", async () => {
  const lever = JSON.stringify([
    { id: "a1", text: "Backend", hostedUrl: "https://jobs.lever.co/acme/a1", country: "CO", createdAt: NOW.getTime() - 86_400_000, categories: { location: "Bogotá" } }
  ]);
  const http = routes({ "https://api.lever.co/v0/postings/acme?mode=json": { status: 200, body: lever } });
  const verdict = judgeBoard("lever", await readBoard(board("lever", "acme"), http, NOW), AGENCIES);
  assert.equal(verdict.status, "ambiguous");
  assert.match(verdict.reason, /no declara el nombre/);
});

test("a complete listing without Colombia is no_colombia, with its counts", async () => {
  const http = routes({ "https://api.lever.co/v0/postings/acme?mode=json": { status: 200, body: JSON.stringify([{ id: "a1", text: "Backend", hostedUrl: "https://jobs.lever.co/acme/a1", country: "US", categories: { location: "Austin" } }]) } });
  const verdict = judgeBoard("lever", await readBoard(board("lever", "acme"), http, NOW), AGENCIES);
  assert.deepEqual(
    { status: verdict.status, colombia: verdict.colombiaCount, total: verdict.totalCount },
    { status: "no_colombia", colombia: 0, total: 1 }
  );
});

test("INV-010: an incomplete listing is never no_colombia", async () => {
  const page = (offset: number) => `https://api.smartrecruiters.com/v1/companies/Acme/postings?country=co&limit=100&offset=${offset}`;
  const first = JSON.stringify({
    totalFound: 150,
    content: Array.from({ length: 100 }, (_, index) => ({ id: `x${index}`, name: "Analista", company: { name: "Acme" }, location: { country: "us", city: "Austin" } }))
  });
  const http = routes({ [page(0)]: { status: 200, body: first }, [page(100)]: { status: 500, body: "" } });
  const verdict = judgeBoard("smartrecruiters", await readBoard(board("smartrecruiters", "Acme"), http, NOW), AGENCIES);
  assert.equal(verdict.status, "error");

  // Workday with postings whose detail was not read: no Colombian match proves nothing.
  const deferred: BoardRead = { kind: "listed", totalCount: 12, colombiaCount: 0, deferred: 7, declaredNames: [] };
  assert.equal(judgeBoard("workday", deferred, AGENCIES).status, "error");
  const read: BoardRead = { kind: "listed", totalCount: 12, colombiaCount: 0, deferred: 0, declaredNames: [] };
  assert.equal(judgeBoard("workday", read, AGENCIES).status, "no_colombia");
});

test("INV-014: a block, a 429 or robots.txt is blocked; other failures are error — never no_colombia", async () => {
  assert.equal(failureStatus("HTTP 403"), "blocked");
  assert.equal(failureStatus("HTTP 429 en la página 2"), "blocked");
  assert.equal(failureStatus("HTTP 401"), "blocked");
  assert.equal(failureStatus("robots.txt no permite este site"), "blocked");
  assert.equal(failureStatus("robots.txt solo abre otros sites de este tenant"), "blocked");
  assert.equal(failureStatus("HTTP 503"), "error");
  assert.equal(failureStatus("respuesta con forma inesperada"), "error");
  assert.equal(failureStatus("The operation was aborted due to timeout"), "error");

  const forbidden = routes({ "https://api.lever.co/v0/postings/acme?mode=json": { status: 403, body: "" } });
  assert.equal(judgeBoard("lever", await readBoard(board("lever", "acme"), forbidden, NOW), AGENCIES).status, "blocked");
  const throttled = routes({ "https://api.ashbyhq.com/posting-api/job-board/acme": { status: 429, body: "" } });
  assert.equal(judgeBoard("ashby", await readBoard(board("ashby", "acme"), throttled, NOW), AGENCIES).status, "blocked");

  const robots = routes({ "https://acme.wd3.myworkdayjobs.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /" } });
  const workday = await readBoard(board("workday", "acme/wd3/External"), robots, NOW);
  assert.equal(judgeBoard("workday", workday, AGENCIES).status, "blocked");
  assert.ok(robots.calls.every((url) => url.endsWith("/robots.txt")), "nothing read past robots.txt");

  const gone = await readBoard(board("lever", "nobody"), routes({}), NOW);
  const verdict = judgeBoard("lever", gone, AGENCIES);
  assert.equal(verdict.status, "error");
  assert.equal(verdict.status === "error" && verdict.notFound, true);
});

test("Greenhouse: the name is the board's own (/v1/boards/{token}), read only when Colombia is there", async () => {
  const jobs = JSON.stringify({
    jobs: [{ id: 1, title: "Analista", absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1", location: { name: "Bogotá, Colombia" }, first_published: "2026-10-25T00:00:00Z", company_name: "Ignored Inc" }]
  });
  const http = routes({
    "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true": { status: 200, body: jobs },
    "https://boards-api.greenhouse.io/v1/boards/acme": { status: 200, body: JSON.stringify({ name: "Acme Payments" }) }
  });
  const read = await readBoard(board("greenhouse", "acme"), http, NOW);
  assert.deepEqual(read.kind === "listed" && read.declaredNames, ["Acme Payments"]);

  const noName = routes({
    "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true": { status: 200, body: jobs },
    "https://boards-api.greenhouse.io/v1/boards/acme": { status: 502, body: "" }
  });
  assert.equal(judgeBoard("greenhouse", await readBoard(board("greenhouse", "acme"), noName, NOW), AGENCIES).status, "error");

  const abroad = routes({ "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true": { status: 200, body: JSON.stringify({ jobs: [] }) } });
  assert.equal(judgeBoard("greenhouse", await readBoard(board("greenhouse", "acme"), abroad, NOW), AGENCIES).status, "no_colombia");
  assert.equal(abroad.calls.length, 1, "no name request for a board without Colombia");
});

test("INV-010: short, generic, placeholder or several names are ambiguous; Magneto too", () => {
  const listed = (names: string[]): BoardRead => ({ kind: "listed", totalCount: 3, colombiaCount: 2, deferred: 0, declaredNames: names });
  for (const names of [["SGS"], ["Grupo"], ["Confidencial"], ["Acme Colombia", "Otra Empresa SAS"], [], ["Backblaze External Website"], ["Acme Careers"], ["Acme Jobs"], ["Extenteam Client Roles"]]) {
    assert.equal(judgeBoard("smartrecruiters", listed(names), AGENCIES).status, "ambiguous", names.join("|"));
  }
  // Two spellings of one company are one name.
  assert.equal(judgeBoard("smartrecruiters", listed(["Acme Colombia S.A.S.", "ACME"]), AGENCIES).status, "eligible");
  assert.equal(judgeBoard("magneto", listed(["Vanti"]), AGENCIES).status, "ambiguous");
  // Workday entity codes in front of the legal name (2026-10-27 dry run): not cut, not enabled.
  for (const name of ["1838 AIRBUS COLOMBIA SAS", "CO02 Gases Indust. Colombia SA", "C26902 Alfa Laval S.A. (Colombia)", "CO11192-ALCOLOM Air Liquide Colombia S.A.S."]) {
    const verdict = judgeBoard("workday", listed([name]), AGENCIES);
    assert.equal(verdict.status, "ambiguous", name);
    assert.match(verdict.reason, /código interno/, name);
  }
  // Digits inside a single-word name are part of it.
  for (const name of ["Exit83", "Blend360", "Brenntag Colombia S.A."]) assert.equal(judgeBoard("workday", listed([name]), AGENCIES).status, "eligible", name);
  // A staging board's postings are no evidence.
  for (const ref of ["thltestcareers", "acme-test", "test-acme", "acmetest"]) assert.equal(judgeBoard("greenhouse", listed(["Acme"]), AGENCIES, ref).status, "ambiguous", ref);
  for (const ref of ["acme", "contestgroup", "latestinc"]) assert.equal(judgeBoard("greenhouse", listed(["Acme"]), AGENCIES, ref).status, "eligible", ref);
});

const CLEAN: EnablementContext = { boardOwned: false, employerIds: [], sameAtsBoards: [], rejected: false, slugOwnerKey: null };

test("INV-012: ownership conflicts", () => {
  assert.equal(conflictOf(CLEAN, "acme", false), null);
  assert.equal(conflictOf({ ...CLEAN, employerIds: ["e1"] }, "acme", false), null, "an existing employer without this ATS gains the board");
  assert.equal(conflictOf({ ...CLEAN, slugOwnerKey: "acme" }, "acme", false), null);
  assert.equal(conflictOf({ ...CLEAN, boardOwned: true }, "acme", false)?.status, "owned");
  for (const context of [
    { ...CLEAN, employerIds: ["e1"], sameAtsBoards: ["acme-co"] },
    { ...CLEAN, employerIds: ["e1", "e2"] },
    { ...CLEAN, rejected: true },
    { ...CLEAN, slugOwnerKey: "acmeholding" }
  ]) {
    assert.equal(conflictOf(context, "acme", false)?.status, "ambiguous", JSON.stringify(context));
  }
  assert.equal(conflictOf(CLEAN, "acme", true)?.status, "ambiguous", "another board of the same ATS claimed this key in this run");
});

test("next probe: errors back off, no_colombia is re-checked, decisions are final", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map((attempts) => nextProbeDays("error", attempts, false)), [1, 2, 4, 8, 14, 14]);
  assert.equal(nextProbeDays("blocked", 0, false), 1);
  assert.equal(nextProbeDays("error", 0, true), 30);
  assert.equal(nextProbeDays("no_colombia", 5, false), 30);
  for (const status of ["enabled", "agency", "ambiguous", "owned"] as const) assert.equal(nextProbeDays(status, 0, false), null);
});

function harness(overrides: Partial<ProbeRunDeps> = {}) {
  const recorded: { id: string; outcome: RecordedProbe }[] = [];
  const promoted: string[] = [];
  const deps: ProbeRunDeps = {
    http: routes({
      [ttUrl("acme")]: { status: 200, body: teamtailorFeed("Acme Colombia SAS", BOGOTA) },
      [ttUrl("acme2")]: { status: 200, body: teamtailorFeed("ACME S.A.S.", BOGOTA) },
      [ttUrl("beta")]: { status: 200, body: teamtailorFeed("Beta Foods", BOGOTA) },
      [ttUrl("gamma")]: { status: 200, body: teamtailorFeed("Gamma Energy", BOGOTA) },
      [ttUrl("abroad")]: { status: 200, body: teamtailorFeed("Abroad Ltd", [{ id: 9, title: "x", country: "Spain" }]) }
    }),
    now: () => NOW,
    agencyKeys: AGENCIES,
    execute: true,
    maxEnable: 25,
    deadlineAt: Number.POSITIVE_INFINITY,
    concurrency: 3,
    isOwned: () => false,
    context: async () => CLEAN,
    promote: async (target) => {
      promoted.push(target.id);
      return { kind: "enabled" };
    },
    record: async (target, outcome) => {
      recorded.push({ id: target.id, outcome });
    },
    log: () => undefined,
    ...overrides
  };
  return { deps, recorded, promoted };
}

test("INV-013: at most --max-enable boards; the rest stay pending, untouched", async () => {
  const { deps, recorded, promoted } = harness({ maxEnable: 1, concurrency: 1 });
  const summary = await runInventoryProbe([board("teamtailor", "beta"), board("teamtailor", "gamma"), board("teamtailor", "abroad")], deps);
  assert.deepEqual(promoted, ["teamtailor:beta"]);
  assert.equal(summary.enabled, 1);
  assert.equal(summary.deferred, 1);
  assert.deepEqual(recorded.map((entry) => `${entry.id}=${entry.outcome.status}`), ["teamtailor:abroad=no_colombia"]);
  assert.equal(summary.byStatus.no_colombia, 1);
});

test("INV-012: two boards of one ATS declaring the same company in one run — the second is ambiguous", async () => {
  const { deps, promoted, recorded } = harness();
  const summary = await runInventoryProbe([board("teamtailor", "acme"), board("teamtailor", "acme2")], deps);
  assert.equal(promoted.length, 1);
  assert.equal(summary.byStatus.ambiguous, 1);
  assert.match(recorded.find((entry) => entry.outcome.status === "ambiguous")!.outcome.reason, /misma empresa/);
});

test("dry run: reads and simulates, writes nothing", async () => {
  const { deps, recorded, promoted } = harness({ execute: false });
  const summary = await runInventoryProbe([board("teamtailor", "acme"), board("teamtailor", "acme2"), board("teamtailor", "abroad")], deps);
  assert.deepEqual([recorded.length, promoted.length], [0, 0]);
  assert.deepEqual(summary.byStatus, { enabled: 1, ambiguous: 1, no_colombia: 1 });
});

test("owned boards are classified without HTTP; promotion conflicts are recorded; the deadline stops new boards", async () => {
  const { deps, recorded } = harness({
    isOwned: (target) => target.atsRef === "beta",
    promote: async () => ({ kind: "conflict", status: "owned", reason: "otra empresa habilitó el tablero" })
  });
  await runInventoryProbe([board("teamtailor", "beta"), board("teamtailor", "gamma")], deps);
  assert.deepEqual(recorded.map((entry) => `${entry.id}=${entry.outcome.status}`).sort(), ["teamtailor:beta=owned", "teamtailor:gamma=owned"]);
  assert.ok(!(deps.http as HttpGet & { calls: string[] }).calls.includes(ttUrl("beta")));

  const late = harness({ deadlineAt: NOW.getTime() - 1 });
  const summary = await runInventoryProbe([board("teamtailor", "beta")], late.deps);
  assert.deepEqual([summary.probed, summary.stoppedBy, late.recorded.length], [0, "deadline", 0]);
});

test("a probe that throws is an error, recorded with backoff", async () => {
  const { deps, recorded } = harness({ http: routes({ [ttUrl("acme")]: () => { throw new Error("boom"); } }) });
  await runInventoryProbe([board("teamtailor", "acme")], deps);
  assert.equal(recorded[0].outcome.status, "error");
  assert.equal(recorded[0].outcome.nextProbeDays, 1);
});
