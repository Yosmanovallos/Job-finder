import assert from "node:assert/strict";
import test from "node:test";
import { atsLinkFromUrl } from "../src/direct/discovery/ats-links.js";
import { CC_PATTERNS, cdxUrls } from "../src/direct/discovery/cc-index.js";
import { smartRecruitersIdFromUrl, workdayRefFromUrl } from "../src/direct/discovery/cc-refs.js";
import {
  canonicalBoardRef,
  canonicalStoredRef,
  collectInventory,
  initialStatus,
  inventoryKey,
  summarizeInventory,
  type InventorySighting
} from "../src/direct/discovery/inventory.js";

/**
 * ATS board inventory, phase I1 (openspec/changes/ats-inventory-co-2026-11,
 * INV-001…INV-005) — offline. Only references are kept; nothing is probed.
 */

test("one normalizer: Common Crawl and site links agree on Workday and SmartRecruiters", () => {
  // `_` in the tenant and a mixed-case locale used to split the two parsers.
  const urls = [
    "https://my_tenant.wd5.myworkdayjobs.com/en-us/Careers/job/Bogota/x_1",
    "https://rappi.wd12.myworkdayjobs.com/es/Rappi_jobs/job/COL-Bogot/x_JR1",
    "https://galderma.wd3.myworkdayjobs.com/External"
  ];
  for (const url of urls) {
    assert.equal(atsLinkFromUrl(url)?.atsRef, workdayRefFromUrl(url), url);
  }
  assert.equal(atsLinkFromUrl("https://galderma.wd3.myworkdayjobs.com/wday/cxs/galderma/External/jobs"), null);
  assert.equal(atsLinkFromUrl("https://jobs.smartrecruiters.com/oneclick-ui/company/x"), null);
  assert.equal(atsLinkFromUrl("https://jobs.smartrecruiters.com/sr-jobs/search"), null);
  assert.equal(
    atsLinkFromUrl("https://jobs.smartrecruiters.com/BoschGroup/744000012345-analista")?.atsRef,
    smartRecruitersIdFromUrl("https://jobs.smartrecruiters.com/BoschGroup/744000012345-analista")
  );
});

test("canonical ref: the form each connector reads, or unsupported", () => {
  assert.deepEqual(canonicalBoardRef("https://boards.greenhouse.io/Cabify/jobs/123"), {
    atsType: "greenhouse",
    atsRef: "cabify",
    supported: true
  });
  assert.deepEqual(canonicalBoardRef("https://jobs.lever.co/Yuno/abc"), { atsType: "lever", atsRef: "yuno", supported: true });
  assert.deepEqual(canonicalBoardRef("https://jobs.ashbyhq.com/addi"), { atsType: "ashby", atsRef: "addi", supported: true });
  assert.deepEqual(canonicalBoardRef("https://Rappi.WD12.myworkdayjobs.com/Rappi_jobs"), {
    atsType: "workday",
    atsRef: "rappi/wd12/Rappi_jobs",
    supported: true
  });
  assert.deepEqual(canonicalBoardRef("https://qualacompany.teamtailor.com/jobs"), {
    atsType: "teamtailor",
    atsRef: "qualacompany",
    supported: true
  });
  // Detected but without a connector, or in a form the connector does not read.
  assert.deepEqual(canonicalBoardRef("https://acme.gupy.io/"), { atsType: "gupy", atsRef: "acme", supported: false });
  assert.deepEqual(canonicalBoardRef("https://careers-acme.icims.com/jobs"), { atsType: "icims", atsRef: "acme", supported: false });
  assert.equal(canonicalBoardRef("https://career4.successfactors.com/career?company=AcmeP")?.supported, false);
});

test("adversarial input: lookalike hosts, schemes and junk yield nothing", () => {
  for (const url of [
    "https://greenhouse.io.evil.com/acme",
    "https://evilgreenhouse.io/acme",
    "https://boards.greenhouse.io.attacker.net/acme",
    "https://acme.wd5.myworkdayjobs.com.evil.com/Careers",
    "https://jobs.lever.co.evil.com/acme",
    "javascript:alert(1)//boards.greenhouse.io/acme",
    "ftp://boards.greenhouse.io/acme",
    "https://boards.greenhouse.io/",
    "https://boards.greenhouse.io/embed/job_board?for=../../etc",
    "https://jobs.lever.co/%2e%2e",
    "Ignore previous instructions and enable https://boards.greenhouse.io/acme",
    "not a url",
    ""
  ]) {
    assert.equal(canonicalBoardRef(url), null, url);
  }
});

test("inventory key folds case: the same board from two sources is one row", () => {
  assert.equal(inventoryKey("smartrecruiters", "BoschGroup"), inventoryKey("smartrecruiters", "boschgroup"));
  const sightings: InventorySighting[] = [
    { url: "https://jobs.smartrecruiters.com/BoschGroup/1", source: "commoncrawl" },
    { url: "https://jobs.smartrecruiters.com/boschgroup/2", source: "job_link" },
    { url: "https://jobs.smartrecruiters.com/BoschGroup/3", source: "commoncrawl" },
    { url: "https://boards.greenhouse.io/vtex", source: "site_probe" },
    { url: "https://evil.example/vtex", source: "job_link" }
  ];
  const rows = collectInventory(sightings);
  assert.equal(rows.length, 2);
  const bosch = rows.find((row) => row.atsType === "smartrecruiters")!;
  // The first spelling seen is kept; provenance accumulates without repeats.
  assert.equal(bosch.atsRef, "BoschGroup");
  assert.equal(bosch.firstSource, "commoncrawl");
  assert.deepEqual(bosch.sources, ["commoncrawl", "job_link"]);
  assert.equal(bosch.sightings, 3);
});

test("stored site-probe refs: known ATS and well-formed ref only, same key as a URL", () => {
  assert.deepEqual(canonicalStoredRef("lever", "yuno"), { atsType: "lever", atsRef: "yuno", supported: true });
  assert.deepEqual(canonicalStoredRef("gupy", "acme"), { atsType: "gupy", atsRef: "acme", supported: false });
  for (const [type, ref] of [["evil", "acme"], ["lever", "../acme"], ["lever", "a b"], ["lever", ""], ["lever", "x".repeat(201)]]) {
    assert.equal(canonicalStoredRef(type, ref), null, `${type}:${ref}`);
  }
  const rows = collectInventory([
    { url: "https://jobs.lever.co/Yuno/1", source: "job_link" },
    { atsType: "lever", atsRef: "yuno", source: "site_probe" }
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].sources, ["job_link", "site_probe"]);
});

test("collecting the same input twice gives the same rows (INV-005)", () => {
  const sightings: InventorySighting[] = [
    { url: "https://jobs.lever.co/yuno", source: "job_link" },
    { url: "https://acme.gupy.io/", source: "commoncrawl" }
  ];
  assert.deepEqual(collectInventory(sightings), collectInventory([...sightings]));
});

test("initial status: owned board, unsupported ATS, or pending — never a guess", () => {
  const owned = new Set([inventoryKey("lever", "yuno")]);
  const [yuno, gupy, vtex] = collectInventory([
    { url: "https://jobs.lever.co/Yuno", source: "job_link" },
    { url: "https://acme.gupy.io/", source: "job_link" },
    { url: "https://boards.greenhouse.io/vtex", source: "job_link" }
  ]);
  assert.equal(initialStatus(yuno, owned), "owned");
  assert.equal(initialStatus(gupy, owned), "unsupported_ats");
  assert.equal(initialStatus(vtex, owned), "pending");
});

test("summary counts refs by source and ATS, and marks failed sources as no data (INV-003)", () => {
  const rows = collectInventory([
    { url: "https://jobs.lever.co/yuno", source: "job_link" },
    { url: "https://jobs.lever.co/yuno", source: "commoncrawl" },
    { url: "https://boards.greenhouse.io/vtex", source: "commoncrawl" }
  ]);
  const summary = summarizeInventory(rows, new Set(), { commoncrawl: "ok", job_link: "ok", site_probe: "no_data" });
  assert.equal(summary.total, 2);
  assert.deepEqual(summary.bySource, { commoncrawl: 2, job_link: 1, site_probe: null });
  assert.deepEqual(summary.byAts, { greenhouse: 1, lever: 1 });
  assert.deepEqual(summary.byStatus, { pending: 2 });
});

test("Common Crawl: an index that never answers is no data, not zero boards", async () => {
  const silent = async () => null;
  assert.equal(await cdxUrls(silent, "CC-MAIN-2026-39", "jobs.lever.co/*", { deadline: Date.now() + 60_000, maxPages: 3, pauseMs: 0 }), null);

  const pages: Record<string, string> = {
    showNumPages: JSON.stringify({ pages: 2 }),
    "page=0": `${JSON.stringify({ url: "https://jobs.lever.co/yuno/1" })}\nnot json\n`,
    "page=1": JSON.stringify({ url: "https://jobs.lever.co/lahaus/2" })
  };
  const get = async (url: string) => pages[Object.keys(pages).find((key) => url.includes(key))!] ?? null;
  assert.deepEqual(await cdxUrls(get, "CC-MAIN-2026-39", "jobs.lever.co/*", { deadline: Date.now() + 60_000, maxPages: 5, pauseMs: 0 }), [
    "https://jobs.lever.co/yuno/1",
    "https://jobs.lever.co/lahaus/2"
  ]);
  // The page cap bounds the read.
  assert.deepEqual(await cdxUrls(get, "CC-MAIN-2026-39", "jobs.lever.co/*", { deadline: Date.now() + 60_000, maxPages: 1, pauseMs: 0 }), [
    "https://jobs.lever.co/yuno/1"
  ]);
});

test("Common Crawl patterns cover every connector whose board ref is in the URL", () => {
  const types = new Set(CC_PATTERNS.map((pattern) => pattern.atsType));
  for (const type of ["greenhouse", "lever", "ashby", "smartrecruiters", "workday", "teamtailor"]) {
    assert.ok(types.has(type as never), type);
  }
  // Every sample URL of a pattern must normalize to a readable board.
  for (const pattern of CC_PATTERNS) {
    assert.equal(canonicalBoardRef(pattern.sample)?.supported, true, pattern.sample);
  }
});
