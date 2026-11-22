import assert from "node:assert/strict";
import test from "node:test";
import { copOf, runTailorEval } from "./fixtures/resume-tailor-eval.js";

// AI Resume Studio R3 — eval gate in CI (doc 09 §4, R3 exit criterion):
// 20 synthetic CVs × 10 vacancies with the adversarial mock. Pass only with
// 0 invented facts accepted (in extraction and in every card), 0 sensitive
// leaks, the validator actually exercised (fabrications caught, invalid
// JSON retried, a chat instruction to add «500 millones» obeyed by the mock
// and discarded), and the
// measured cost per adaptation ≤ COP 150 at the configured prices.
// The single run against real Qwen needs the owner's approval and key:
//   RESUME_AI_EVAL_LIVE=1 npx tsx scripts/eval-resume-tailor.ts --live

test("RS3-EVAL 20 CV × 10 vacancies: 0 invented facts accepted, cost ≤ COP 150", async () => {
  const report = await runTailorEval();
  assert.equal(report.pairs, 200);
  assert.equal(report.extractions, 20);
  assert.deepEqual(report.inventedAccepted, [], "invented facts accepted in a card");
  assert.deepEqual(report.extractionInvented, [], "invented facts accepted in extraction");
  assert.equal(report.sensitiveLeaks, 0);
  // The defence was really tested.
  assert.ok(report.mock && report.mock.fabricated > 50, `fabricated ${report.mock?.fabricated}`);
  assert.ok(report.mock && report.mock.invalidJson > 0, "invalid JSON exercised the retry");
  // Injections in V4 and P20 are stripped before the model (T-INJ covers the obedient path).
  assert.ok(report.discarded + report.questions > 50, `rejections ${report.discarded + report.questions}`);
  assert.ok(report.proposalsShown > 100, `shown ${report.proposalsShown}`);
  assert.ok(report.scoreAfter >= report.scoreBefore);
  const maxCop = copOf(report.costMicrosPerAdaptation.max, report.copPerUsd);
  assert.ok(maxCop <= 150, `max COP ${maxCop}`);
});

test("RS3-EVAL-FULL every requirement card answered: full mapping → rewrite flow, still 0 invented", async () => {
  const report = await runTailorEval({ answerAll: true });
  assert.deepEqual(report.inventedAccepted, []);
  assert.deepEqual(report.extractionInvented, []);
  assert.ok((report.shownByCard.rewrite ?? 0) > 200, `rewrites ${report.shownByCard.rewrite}`);
  assert.ok(report.questions > 0, "missing data surfaces as questions");
  assert.ok(report.scoreAfter >= report.scoreBefore + 20, `${report.scoreBefore} → ${report.scoreAfter}`);
  assert.ok(copOf(report.costMicrosPerAdaptation.max, report.copPerUsd) <= 150);
});
