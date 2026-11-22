import { randomUUID } from "node:crypto";
import type http from "node:http";
import { z } from "zod";
import { resumeFactsSchema } from "../../lib/resume-studio.js";
import { COMPATIBILITY_DISCLAIMER } from "../../lib/resume-tailor/score.js";
import type { GatewayFailure } from "../../resume-studio/ai/gateway.js";
import { resumeAiRuntime } from "../../resume-studio/ai/runtime.js";
import { adaptationIdFor } from "../../resume-studio/ai/start-key.js";
export { adaptationIdFor };
import { extractCvFacts, proposeCard, startTailor, type CardRequest } from "../../resume-studio/ai/tailor-service.js";
import { consumeAdaptation, releaseAdaptation, type QuotaGrant } from "../../db/resume-studio-pass-repository.js";

// AI Resume Studio R3 — /api/resume/extract, /tailor/start, /tailor/card.
// Loaded lazily by resume.ts after session, rate limit and the two required
// authorizations were checked. Stateless: the adaptation lives in the
// browser; the server only issues the adaptation id (a «start» row in
// rs_ai_usage tied to the user) and enforces the caps from the ledger.
// Nothing here is stored and no CV or vacancy text is logged.

type Json = (res: http.ServerResponse, status: number, body?: unknown, extra?: Record<string, string>) => void;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (max: number) => z.string().max(max);

const extractBody = z.object({ text: z.string().min(40).max(30_000) }).strict();
const startBody = z
  .object({
    facts: resumeFactsSchema,
    job: z.object({ title: z.string().min(1).max(200), description: z.string().min(1).max(20_000) }).strict(),
    // R4c: idempotency key made by the browser at click time. The same key
    // always answers the same adaptation and consumes the quota once.
    clientKey: z.string().regex(UUID).optional()
  })
  .strict();

// In-flight and recent /tailor/start answers by (user, adaptation id): a
// double click or a React double effect gets the SAME answer from the same
// work. Single instance (Render Starter); across restarts the unique «start»
// row (claimAdaptation) still keeps the quota from being consumed twice.
type StartAnswer = { status: number; body: unknown };
const START_TTL_MS = 15 * 60_000;
const startMemo = new Map<string, { at: number; answer: Promise<StartAnswer> }>();
function memoStart(key: string, run: () => Promise<StartAnswer>): Promise<StartAnswer> {
  const now = Date.now();
  for (const [k, v] of startMemo) if (now - v.at > START_TTL_MS) startMemo.delete(k);
  const hit = startMemo.get(key);
  if (hit) return hit.answer;
  const answer = run();
  startMemo.set(key, { at: now, answer });
  while (startMemo.size > 500) startMemo.delete(startMemo.keys().next().value as string);
  // A crash is not memoized: the next try runs again.
  answer.catch(() => startMemo.delete(key));
  return answer;
}

/** Tests only. */
export function clearStartMemoForTests(): void {
  startMemo.clear();
}
const cardBody = z.discriminatedUnion("card", [
  z.object({ adaptationId: z.string().regex(UUID), card: z.literal("headline"), jobTitle: text(200), facts: resumeFactsSchema }).strict(),
  z.object({ adaptationId: z.string().regex(UUID), card: z.literal("summary"), jobTitle: text(200), tasks: z.array(text(220)).max(12), facts: resumeFactsSchema }).strict(),
  z
    .object({
      adaptationId: z.string().regex(UUID),
      card: z.literal("rewrite"),
      requirement: text(220),
      facts: resumeFactsSchema,
      experienceId: z.string().max(60).nullable(),
      answer: z.string().min(3).max(600)
    })
    .strict(),
  z
    .object({
      adaptationId: z.string().regex(UUID),
      card: z.literal("chat"),
      cardType: z.enum(["headline", "summary", "rewrite"]),
      current: z.string().min(1).max(1200),
      instruction: z.string().min(1).max(300),
      facts: resumeFactsSchema,
      experienceId: z.string().max(60).nullable(),
      answer: z.string().max(600)
    })
    .strict()
]);

const FAILURE_MESSAGES: Record<GatewayFailure, string> = {
  ai_off: "La IA está apagada por ahora. Puedes seguir editando a mano.",
  too_long: "El texto es demasiado largo para procesarlo. Recórtalo un poco.",
  invalid_output: "La IA no respondió bien dos veces. Escríbelo a mano o inténtalo más tarde.",
  provider_error: "El proveedor de IA no respondió. Inténtalo en unos minutos o escríbelo a mano.",
  adaptation: "Esta adaptación llegó a su tope de IA. Puedes terminarla a mano.",
  user_daily: "Llegaste al tope de IA de hoy. Puedes seguir editando a mano.",
  global_daily: "Hoy se agotó el cupo de IA del sitio. Puedes seguir editando a mano.",
  global_monthly: "Este mes se agotó el cupo de IA del sitio. Puedes seguir editando a mano.",
  chat_turns: "Ya usaste los 8 ajustes por chat de esta adaptación."
};

function failure(res: http.ServerResponse, json: Json, code: GatewayFailure): void {
  const status = code === "ai_off" ? 503 : code === "too_long" ? 413 : code === "invalid_output" || code === "provider_error" ? 502 : 429;
  json(res, status, { error: FAILURE_MESSAGES[code], code });
}

export async function handleResumeAi(res: http.ServerResponse, route: string, userId: string, value: unknown, json: Json): Promise<void> {
  const { gateway, ledger } = resumeAiRuntime();

  if (route === "/extract") {
    const parsed = extractBody.safeParse(value);
    if (!parsed.success) return json(res, 400, { error: "Pega o sube el texto de tu hoja de vida (mínimo 40 caracteres)." });
    if (!gateway.enabled) return failure(res, json, "ai_off");
    const id = randomUUID();
    await ledger.startAdaptation(userId, id);
    const out = await extractCvFacts(gateway, { userId, adaptationId: id, purpose: "cv_extract" }, parsed.data.text);
    if (!out.ok) return failure(res, json, out.code);
    return json(res, 200, out.result);
  }

  if (route === "/tailor/start") {
    const parsed = startBody.safeParse(value);
    if (!parsed.success) return json(res, 400, { error: "Faltan tu hoja de vida o la vacante." });
    const { clientKey, facts, job } = parsed.data;
    const adaptationId = clientKey ? adaptationIdFor(userId, clientKey) : randomUUID();
    const answer = await memoStart(`${userId}:${adaptationId}`, async (): Promise<StartAnswer> => {
      // Claim the id first (atomic). Not new → a retry of a start that already
      // consumed its quota (e.g. after a restart): answer again, charge nothing.
      const claimed = await ledger.claimAdaptation(userId, adaptationId);
      if (!claimed && !(await ledger.ownsAdaptation(userId, adaptationId))) {
        return { status: 409, body: { error: "Vuelve a intentarlo.", code: "conflict" } };
      }
      // R4 quota (doc 06 §7): one adaptation per start, only when the AI can
      // actually help; the R3 cost caps still apply on top. Pass first, then
      // the monthly free allowance; nothing left → 402 pointing to the pass.
      let grant: QuotaGrant | null = null;
      if (claimed && gateway.enabled) {
        const quota = await consumeAdaptation(userId);
        if (!quota.ok) {
          await ledger.unclaimAdaptation(userId, adaptationId).catch(() => undefined);
          return {
            status: 402,
            body: {
              error:
                quota.source === "pass"
                  ? "Usaste las adaptaciones de tu pase en este periodo. Puedes seguir editando a mano."
                  : "Usaste tus adaptaciones gratis de este mes. Con un pase tienes más.",
              code: "quota_exhausted",
              source: quota.source,
              limit: quota.limit,
              resetsAt: quota.resetsAt.toISOString()
            }
          };
        }
        grant = quota;
      }
      let start;
      try {
        start = await startTailor(gateway, { userId, adaptationId }, { facts, ...job });
      } catch (error) {
        if (grant) await releaseAdaptation(grant).catch(() => undefined);
        throw error;
      }
      // A cost cap stopped the AI before it helped: give the adaptation back.
      if (grant && !start.aiAvailable) await releaseAdaptation(grant);
      return {
        status: 200,
        body: {
          adaptationId,
          ...start,
          quota: grant ? { source: grant.source, used: start.aiAvailable ? grant.used : grant.used - 1, limit: grant.limit } : null,
          aiMessage: start.aiNotice ? FAILURE_MESSAGES[start.aiNotice] : null,
          disclaimer: COMPATIBILITY_DISCLAIMER
        }
      };
    });
    return json(res, answer.status, answer.body);
  }

  const parsed = cardBody.safeParse(value);
  if (!parsed.success) return json(res, 400, { error: "Tarjeta no válida." });
  const { adaptationId, ...request } = parsed.data;
  // Someone else's (or an invented) adaptation id: 404, like any foreign id.
  if (!(await ledger.ownsAdaptation(userId, adaptationId))) return json(res, 404, { error: "Adaptación no encontrada." });
  const result = await proposeCard(gateway, { userId, adaptationId }, request as CardRequest);
  if (result.status === "unavailable") return failure(res, json, result.code);
  return json(res, 200, result);
}
