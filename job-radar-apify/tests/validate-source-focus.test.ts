import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FOCUS_PRESETS, focusFromArgs, isDueInQueue, parseFocusSources, summarizeSourceCensus } from "../src/direct/discovery/source-focus.js";
import type { SourceCoverageRow } from "../src/db/direct-discovery-repository.js";

test("focus sources are validated, de-duplicated and never free text", () => {
  assert.deepEqual(parseFocusSources(" Indeed,Glassdoor,Indeed "), ["Indeed", "Glassdoor"]);
  assert.throws(() => parseFocusSources("Indeed,Glasdoor"), /desconocida: Glasdoor/);
  assert.throws(() => parseFocusSources("Indeed'; DROP TABLE jobs;--"), /desconocida/);
  assert.throws(() => parseFocusSources(" , "), /vacío/);
  assert.deepEqual(FOCUS_PRESETS["browser-boards"], ["Indeed", "Glassdoor"]);
});

test("the two focus flags are exclusive and both need the live directory", () => {
  assert.equal(focusFromArgs(["--limit", "10"]), null, "no flag = all job boards (today's behavior)");
  assert.deepEqual(focusFromArgs(["--focus-computrabajo"]), ["Computrabajo"], "the legacy flag keeps its meaning");
  assert.deepEqual(focusFromArgs(["--focus-sources", "Indeed,Glassdoor", "--dry-run"]), ["Indeed", "Glassdoor"]);
  assert.throws(() => focusFromArgs(["--focus-computrabajo", "--focus-sources", "Indeed"]), /excluyentes/);
  assert.throws(() => focusFromArgs(["--focus-sources", "Indeed", "--candidates-file", "x.json"]), /directorio vivo/);
  assert.throws(() => focusFromArgs(["--focus-computrabajo", "--candidates-file", "x.json"]), /directorio vivo/);
  assert.throws(() => focusFromArgs(["--focus-sources", "--dry-run"]), /requiere una lista/);
  assert.throws(() => focusFromArgs(["--focus-sources"]), /requiere una lista/);
});

function row(companyKey: string, directoryCount: number, extra: Partial<SourceCoverageRow> = {}): SourceCoverageRow {
  return { companyKey, companyName: companyKey, directoryCount, decision: null, websiteDomain: null, enabledBoards: 0, liveOfficialJobs: 0, probeDue: null, ...extra };
}

test("the census separates boards, agencies, Computrabajo overlap, due rows and backoff", () => {
  const census = summarizeSourceCensus({
    sources: ["Indeed", "Glassdoor"],
    co: [
      row("covered", 9, { decision: "known", enabledBoards: 1, liveOfficialJobs: 4 }),
      row("adecco", 7),
      row("backoff", 5, { decision: "not_found", probeDue: false }),
      row("dueonct", 4, { decision: "pending", probeDue: true }),
      row("duenew", 3, { decision: "unsupported_ats", probeDue: true }),
      row("unsynced", 2),
      row("review", 1, { decision: "needs_review", probeDue: false })
    ],
    veCompanies: 6,
    noCountryCompanies: 1,
    agencies: new Set(["adecco"]),
    computrabajoKeys: new Set(["dueonct", "covered"])
  });
  assert.deepEqual(census.companies, { CO: 7, VE: 6, none: 1 });
  assert.equal(census.vacancies, 31);
  assert.equal(census.agencies, 1);
  assert.equal(census.withBoard, 1);
  assert.equal(census.withLiveOfficialJobs, 1);
  assert.equal(census.targets, 5);
  assert.equal(census.alsoOnComputrabajo, 1, "only targets count; a covered company is not overlap work");
  assert.deepEqual(census.byDecision, { not_found: 1, pending: 1, unsupported_ats: 1, sin_fila: 1, needs_review: 1 });
  assert.equal(census.dueNow, 3, "an unsynced company enters as pending; needs_review is human work, not the queue");
  assert.equal(census.inBackoff, 1);
  assert.equal(census.newDueNotOnComputrabajo, 2, "the Computrabajo focus already reaches the overlapping company");
});

test("the scheduled discovery keeps the Computrabajo focus; browser-boards is manual only", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/direct-employers-discovery.yml", import.meta.url), "utf8");
  assert.match(workflow, /FOCUS: \$\{\{ github\.event_name == 'schedule' && 'computrabajo' \|\| inputs\.focus \}\}/);
  assert.match(workflow, /- browser-boards\r?\n/);
  assert.match(workflow, /focus_arg="--focus-sources Indeed,Glassdoor"/);
  const tick = readFileSync(new URL("../../.github/workflows/direct-employers-tick.yml", import.meta.url), "utf8");
  assert.match(tick, /browser-boards-coverage\) cmd="npx tsx scripts\/direct-source-coverage\.ts --sources Indeed,Glassdoor --allow-remote-db"/);
  assert.doesNotMatch(tick, /direct-source-coverage\.ts[^\n]*--execute/);
});

test("a focused dry-run probes only what the execute queue would pick", () => {
  assert.equal(isDueInQueue({ decision: null, probeDue: null }), true, "not synced yet: enters as pending");
  assert.equal(isDueInQueue({ decision: "pending", probeDue: true }), true);
  assert.equal(isDueInQueue({ decision: "not_found", probeDue: false }), false, "backoff is respected");
  for (const sticky of ["known", "verified", "rejected", "needs_review"]) {
    assert.equal(isDueInQueue({ decision: sticky, probeDue: false }), false, `${sticky} is never re-probed`);
  }
  const script = readFileSync(new URL("../scripts/discover-direct-employers.ts", import.meta.url), "utf8");
  assert.match(script, /focusRows\.filter\(\(row\) => !dryRun \|\| isDueInQueue\(row\)\)/);
});
