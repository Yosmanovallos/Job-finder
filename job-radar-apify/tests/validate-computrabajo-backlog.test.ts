import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildComputrabajoBacklog, parseOfficialReviews } from "../src/direct/discovery/computrabajo-backlog.js";

const reviews = parseOfficialReviews(JSON.parse(readFileSync(new URL("../data/computrabajo-official-reviews.json", import.meta.url), "utf8")));

test("manual review ledger has distinct company keys and cited HTTPS evidence", () => {
  assert.ok(reviews.size >= 7);
  assert.equal(reviews.get("smurfitwestrock")?.status, "official_incomplete");
  assert.equal(reviews.get("nexabpo")?.status, "blocked");
  assert.equal(reviews.get("frisby")?.status, "blocked");
  assert.throws(() => parseOfficialReviews({ reviews: [
    { company: "Grupo Éxito", status: "form_only", evidenceUrl: "https://example.com", reviewedAt: "2026-10-25" },
    { company: "GRUPO EXITO S.A.", status: "form_only", evidenceUrl: "https://example.com", reviewedAt: "2026-10-25" }
  ] }), /duplicada/);
  assert.throws(() => parseOfficialReviews({ reviews: [
    { company: "Otro", status: "official_board", evidenceUrl: "http://example.com", reviewedAt: "2026-10-25" }
  ] }));
});

test("a linked board, a manual review and an automated name probe remain distinct", () => {
  const rows = [
    { companyKey: "smurfitwestrock", companyName: "Smurfit Westrock", directoryCount: 3, decision: "unsupported_ats", websiteDomain: "smurfitwestrock.com", enabledBoards: 0, liveOfficialJobs: 0 },
    { companyKey: "otraprueba", companyName: "Otra Prueba", directoryCount: 2, decision: "not_found", websiteDomain: null, enabledBoards: 0, liveOfficialJobs: 0 },
    { companyKey: "grupoexito", companyName: "Grupo Éxito", directoryCount: 1, decision: "known", websiteDomain: null, enabledBoards: 1, liveOfficialJobs: 0 }
  ];
  const backlog = buildComputrabajoBacklog(rows, new Set(["otraprueba"]), reviews);
  assert.equal(backlog[0].status, "official_incomplete");
  assert.equal(backlog[0].decision, "unsupported_ats");
  assert.equal(backlog[1].status, "pending_review", "an ATS name probe is not a manual official-site review");
  assert.equal(backlog[1].isAgency, true);
  assert.equal(backlog[2].status, "official_board", "a live enabled board supersedes an older review status");
});
