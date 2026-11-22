/**
 * AI Resume Studio R3 — eval report (doc 09 §4): 20 synthetic CVs × 10
 * vacancies through extraction and every card.
 *
 *   npx tsx scripts/eval-resume-tailor.ts            (adversarial mock, offline)
 *   RESUME_AI_EVAL_LIVE=1 npx tsx scripts/eval-resume-tailor.ts --live
 *
 * --live calls the real Qwen endpoint (Virginia, «United States» scope) with
 * the RESUME_AI_* variables of the shell. It costs money and sends the
 * synthetic CVs to Alibaba: ONLY with the owner's explicit approval, once.
 * Synthetic data only; nothing is stored; the report has aggregates only.
 */
import { parseResumeAiConfig } from "../src/resume-studio/ai/config.js";
import { qwenTransport } from "../src/resume-studio/ai/qwen.js";
import { copOf, runTailorEval } from "../tests/fixtures/resume-tailor-eval.js";

async function main() {
  const live = process.argv.includes("--live");
  let transport;
  let env: Record<string, string> | undefined;
  if (live) {
    if (process.env.RESUME_AI_EVAL_LIVE !== "1") {
      throw new Error("--live necesita RESUME_AI_EVAL_LIVE=1 y la aprobación explícita del propietario.");
    }
    const config = parseResumeAiConfig(process.env);
    if (config.provider !== "qwen" || !config.baseUrl || !config.apiKey) {
      throw new Error(`Qwen no está configurado: ${config.disabledReason ?? "RESUME_AI_PROVIDER debe ser qwen"}.`);
    }
    transport = qwenTransport({ baseUrl: config.baseUrl, apiKey: config.apiKey });
    env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k.startsWith("RESUME_AI_") && typeof v === "string")) as Record<string, string>;
  }
  const started = Date.now();
  const report = await runTailorEval({ transport, env });
  const cop = (m: number) => copOf(m, report.copPerUsd);
  const summary = {
    mode: live ? "qwen (real)" : "mock adversarial",
    pairs: report.pairs,
    extractions: report.extractions,
    inventedAccepted: report.inventedAccepted.length,
    extractionInvented: report.extractionInvented.length,
    sensitiveLeaks: report.sensitiveLeaks,
    proposalsShown: report.proposalsShown,
    shownByCard: report.shownByCard,
    questions: report.questions,
    discarded: report.discarded,
    unavailable: report.unavailable,
    rejections: report.rejections,
    compatibilityAvg: `${report.scoreBefore} → ${report.scoreAfter}`,
    copPerAdaptation: { avg: cop(report.costMicrosPerAdaptation.avg), max: cop(report.costMicrosPerAdaptation.max) },
    copPerExtraction: { avg: cop(report.costMicrosPerExtraction.avg), max: cop(report.costMicrosPerExtraction.max) },
    copPerUsd: report.copPerUsd,
    mock: report.mock,
    seconds: Math.round((Date.now() - started) / 1000)
  };
  console.log(JSON.stringify(summary, null, 2));
  if (report.inventedAccepted.length) console.log("Invented (first 10):", JSON.stringify(report.inventedAccepted.slice(0, 10), null, 2));
  const pass = report.inventedAccepted.length === 0 && report.extractionInvented.length === 0 && summary.copPerAdaptation.max <= 150;
  console.log(pass ? "PASS: 0 hechos inventados aceptados y costo ≤ COP 150." : "FAIL");
  if (!pass) process.exit(1);
}

main().catch((error) => {
  console.error("[eval-resume-tailor]", (error as Error).message);
  process.exit(1);
});
