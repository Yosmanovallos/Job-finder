import { PgUsageLedger } from "../../db/resume-studio-ai-repository.js";
import { parseResumeAiConfig } from "./config.js";
import { createGateway, type ResumeAiGateway } from "./gateway.js";
import type { UsageLedger } from "./ledger.js";
import { mockTransport } from "./mock.js";
import { qwenTransport } from "./qwen.js";

// AI Resume Studio R3 — the process-wide gateway, built once from the
// environment (RESUME_AI_*). Only the lazy /api/resume route imports this.

let instance: { gateway: ResumeAiGateway; ledger: UsageLedger } | null = null;

export function resumeAiRuntime(): { gateway: ResumeAiGateway; ledger: UsageLedger } {
  if (instance) return instance;
  const config = parseResumeAiConfig(process.env);
  if (config.disabledReason) console.warn(`[resume-ai] IA apagada: ${config.disabledReason}.`);
  const ledger = new PgUsageLedger();
  const transport =
    config.provider === "qwen" && config.baseUrl && config.apiKey
      ? qwenTransport({ baseUrl: config.baseUrl, apiKey: config.apiKey })
      : config.provider === "mock"
        ? mockTransport()
        : null;
  instance = {
    gateway: createGateway({
      config,
      ledger,
      transport,
      // R4c diagnostics: one JSON line per call with sizes and codes only —
      // never prompt, CV, vacancy or answer text (doc 08 §5).
      onCall: (info) => {
        const line = `[resume-ai] call ${JSON.stringify(info)}`;
        if (info.outcome === "ok") console.log(line);
        else console.warn(line);
      }
    }),
    ledger
  };
  return instance;
}

/** Tests only. */
export function setResumeAiRuntimeForTests(value: { gateway: ResumeAiGateway; ledger: UsageLedger } | null): void {
  instance = value;
}
