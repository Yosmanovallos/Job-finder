/**
 * AI Resume Studio R3 — eval report (doc 09 §4): synthetic CVs × vacancies
 * through extraction and every card.
 *
 *   npx tsx scripts/eval-resume-tailor.ts                     (adversarial mock, offline, 20 × 10)
 *   RESUME_AI_EVAL_LIVE=1 npx tsx scripts/eval-resume-tailor.ts --live --smoke
 *   RESUME_AI_EVAL_LIVE=1 npx tsx scripts/eval-resume-tailor.ts --live --cvs P2,P3 --jobs V1,V2
 *   … --answer-all   the persona answers every requirement card (full mapping → rewrite flow)
 *
 * --live calls the real Qwen endpoint (Virginia, «United States» scope) with
 * the RESUME_AI_* variables of the process. It costs money and sends the
 * SYNTHETIC CVs to Alibaba: ONLY with the owner's explicit approval. The
 * whole run is hard-capped at USD 1 (global caps forced below), never reads
 * or prints secrets, needs no database and stores nothing.
 */
import { parseResumeAiConfig } from "../src/resume-studio/ai/config.js";
import { createGateway, type Transport } from "../src/resume-studio/ai/gateway.js";
import { MemoryLedger } from "../src/resume-studio/ai/ledger.js";
import { CARD_HEADLINE } from "../src/resume-studio/ai/prompts.js";
import { qwenTransport } from "../src/resume-studio/ai/qwen.js";
import { copOf, runTailorEval } from "../tests/fixtures/resume-tailor-eval.js";
import { SYNTHETIC_CVS, SYNTHETIC_JOBS } from "../tests/fixtures/resume-tailor-synthetic.js";

const RUN_CAP_USD = "1";

function arg(name: string): string[] | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].split(",").map((s) => s.trim()) : null;
}

async function main() {
  const live = process.argv.includes("--live");
  let transport: Transport | undefined;
  let env: Record<string, string> | undefined;
  if (live) {
    if (process.env.RESUME_AI_EVAL_LIVE !== "1") {
      throw new Error("--live necesita RESUME_AI_EVAL_LIVE=1 y la aprobación explícita del propietario.");
    }
    const picked = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k.startsWith("RESUME_AI_") && typeof v === "string")) as Record<string, string>;
    // Hard cap for the whole run, whatever the shell says.
    env = { ...picked, RESUME_AI_CAP_GLOBAL_DAILY_USD: RUN_CAP_USD, RESUME_AI_CAP_GLOBAL_MONTHLY_USD: RUN_CAP_USD, RESUME_AI_CAP_USER_DAILY_USD: RUN_CAP_USD };
    const config = parseResumeAiConfig(env);
    if (config.provider !== "qwen" || !config.baseUrl || !config.apiKey) {
      console.log(JSON.stringify({ smoke: "fail", disabledReason: config.disabledReason ?? "RESUME_AI_PROVIDER debe ser qwen" }));
      process.exit(1);
    }
    transport = qwenTransport({ baseUrl: config.baseUrl, apiKey: config.apiKey });

    if (process.argv.includes("--smoke")) {
      const ledger = new MemoryLedger();
      const gateway = createGateway({ config, ledger, transport });
      const r = await gateway.complete(
        CARD_HEADLINE,
        { jobTitle: "Analista de datos", facts: [{ factId: "e1", section: "experience", text: "Practicante de analítica · Banco Demo S.A.S." }], language: { lang: "es" } },
        { userId: "00000000-0000-4000-8000-000000000001", adaptationId: "00000000-0000-4000-8000-000000000002", purpose: "smoke" }
      );
      const row = ledger.rows.find((x) => x.status === "ok" || x.status === "invalid_json" || x.status === "error");
      console.log(
        JSON.stringify({
          smoke: r.ok ? "ok" : "fail",
          code: r.ok ? null : r.code,
          model: config.models.fast,
          latencyMs: row?.latencyMs ?? null,
          inputTokens: row?.inputTokens ?? null,
          outputTokens: row?.outputTokens ?? null,
          costUsd: row ? row.costMicros / 1e6 : null
        })
      );
      process.exit(r.ok ? 0 : 1);
    }
  }

  const cvIds = arg("--cvs");
  const jobIds = arg("--jobs");
  const started = Date.now();
  const report = await runTailorEval({
    transport,
    env,
    cvs: cvIds ? SYNTHETIC_CVS.filter((c) => cvIds.includes(c.id)) : undefined,
    jobs: jobIds ? SYNTHETIC_JOBS.filter((j) => jobIds.includes(j.id)) : undefined,
    answerAll: process.argv.includes("--answer-all")
  });
  const cop = (m: number) => copOf(m, report.copPerUsd);
  const usd = (m: number) => Math.round(m) / 1e6;
  const summary = {
    mode: live ? "qwen (real)" : "mock adversarial",
    answerAll: process.argv.includes("--answer-all"),
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
    calls: report.calls,
    invalidReasons: report.invalidReasons,
    latencyP50MsByPrompt: report.latencyP50ByPrompt,
    tokensPerAdaptation: report.tokensPerAdaptation,
    tokensPerExtraction: report.tokensPerExtraction,
    perAdaptation: {
      usdAvg: usd(report.costMicrosPerAdaptation.avg),
      usdMax: usd(report.costMicrosPerAdaptation.max),
      copAvg: cop(report.costMicrosPerAdaptation.avg),
      copMax: cop(report.costMicrosPerAdaptation.max)
    },
    perExtraction: { usdAvg: usd(report.costMicrosPerExtraction.avg), copAvg: cop(report.costMicrosPerExtraction.avg), copMax: cop(report.costMicrosPerExtraction.max) },
    totalRunUsd: usd(report.totalCostMicros),
    copPerUsd: report.copPerUsd,
    mock: report.mock,
    seconds: Math.round((Date.now() - started) / 1000)
  };
  console.log(JSON.stringify(summary, null, 2));
  if (report.inventedAccepted.length) console.log("Invented (first 10):", JSON.stringify(report.inventedAccepted.slice(0, 10), null, 2));
  const pass = report.inventedAccepted.length === 0 && report.extractionInvented.length === 0 && summary.perAdaptation.copMax <= 150;
  console.log(pass ? "PASS: 0 hechos inventados aceptados y costo ≤ COP 150." : "FAIL");
  if (!pass) process.exit(1);
}

main().catch((error) => {
  console.error("[eval-resume-tailor]", (error as Error).message);
  process.exit(1);
});
