import { randomUUID } from "node:crypto";
import type http from "node:http";
import { z } from "zod";
import { resumeFactsSchema } from "../../lib/resume-studio.js";
import { COMPATIBILITY_DISCLAIMER } from "../../lib/resume-tailor/score.js";
import type { GatewayFailure } from "../../resume-studio/ai/gateway.js";
import { resumeAiRuntime } from "../../resume-studio/ai/runtime.js";
import { extractCvFacts, proposeCard, startTailor, type CardRequest } from "../../resume-studio/ai/tailor-service.js";

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
  .object({ facts: resumeFactsSchema, job: z.object({ title: z.string().min(1).max(200), description: z.string().min(1).max(20_000) }).strict() })
  .strict();
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
    const adaptationId = randomUUID();
    await ledger.startAdaptation(userId, adaptationId);
    const start = await startTailor(gateway, { userId, adaptationId }, { facts: parsed.data.facts, ...parsed.data.job });
    return json(res, 200, {
      adaptationId,
      ...start,
      aiMessage: start.aiNotice ? FAILURE_MESSAGES[start.aiNotice] : null,
      disclaimer: COMPATIBILITY_DISCLAIMER
    });
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
