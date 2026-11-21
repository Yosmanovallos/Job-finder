import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { costMicros, parseResumeAiConfig, usBaseUrl } from "../src/resume-studio/ai/config.js";
import { createGateway, parseJsonObject, type Transport, type TransportRequest } from "../src/resume-studio/ai/gateway.js";
import { colombiaWindows, MemoryLedger } from "../src/resume-studio/ai/ledger.js";
import { PROMPTS, type PromptSpec } from "../src/resume-studio/ai/prompts.js";
import { buildQwenBody, qwenTransport } from "../src/resume-studio/ai/qwen.js";

// AI Resume Studio R3 — gateway (ADR 0017 §4): provider switch, prices,
// hard caps checked BEFORE the call, content-free ledger, in-memory cache,
// one retry on invalid JSON, Qwen request shape (no thinking, JSON mode, no
// tools). Offline: every transport is a fake.

const USER = "a0000000-0000-4000-8000-000000000001";
const ADAPT = "b0000000-0000-4000-8000-000000000001";

const SPEC: PromptSpec<{ q: string }, { answer: string }> = {
  id: "card_headline",
  version: 1,
  alias: "fast",
  maxInputTokens: 500,
  maxOutputTokens: 100,
  schema: z.object({ answer: z.string() }).strict(),
  render: ({ q }) => ({ system: "Responde en JSON.", user: `<<<CV>>>\n${q}\n<<<FIN_CV>>>` })
};

function fakeTransport(replies: string[]): Transport & { calls: TransportRequest[] } {
  const calls: TransportRequest[] = [];
  const t = async (request: TransportRequest) => {
    calls.push(request);
    const content = replies[Math.min(calls.length - 1, replies.length - 1)];
    return { content, usage: { promptTokens: 50, completionTokens: 10, cachedTokens: 0 } };
  };
  return Object.assign(t, { calls });
}

const mockConfig = (extra: Record<string, string> = {}) => parseResumeAiConfig({ RESUME_AI_PROVIDER: "mock", ...extra });
const ctx = { userId: USER, adaptationId: ADAPT, purpose: "card_headline" };

test("RS3-AI-CFG none by default; qwen fails closed without workspace, key or price; no host injection", () => {
  assert.equal(parseResumeAiConfig({}).provider, "none");
  assert.equal(parseResumeAiConfig({ RESUME_AI_PROVIDER: "gpt" }).provider, "none");
  const noKey = parseResumeAiConfig({ RESUME_AI_PROVIDER: "qwen", RESUME_AI_WORKSPACE_ID: "ws-123" });
  assert.equal(noKey.provider, "none");
  assert.match(noKey.disabledReason ?? "", /API_KEY/);
  const evil = parseResumeAiConfig({ RESUME_AI_PROVIDER: "qwen", RESUME_AI_WORKSPACE_ID: "evil.com/x?", RESUME_AI_API_KEY: "k" });
  assert.equal(evil.provider, "none");
  assert.throws(() => usBaseUrl("a.evil.com#"));
  const unknownModel = parseResumeAiConfig({ RESUME_AI_PROVIDER: "qwen", RESUME_AI_WORKSPACE_ID: "ws-123", RESUME_AI_API_KEY: "k", RESUME_AI_MODEL_FAST: "qwen9-mystery" });
  assert.equal(unknownModel.provider, "none", "no price → no calls");
  const ok = parseResumeAiConfig({ RESUME_AI_PROVIDER: "qwen", RESUME_AI_WORKSPACE_ID: "ws-123", RESUME_AI_API_KEY: "k" });
  assert.equal(ok.provider, "qwen");
  assert.equal(ok.baseUrl, "https://ws-123.us-east-1.maas.aliyuncs.com/compatible-mode/v1");
  assert.deepEqual(ok.models, { fast: "qwen3.7-flash", rewrite: "qwen3.7-plus" });
  assert.deepEqual(ok.prices.fast, { input: 0.03, output: 0.13 });
  const fallback = parseResumeAiConfig({ RESUME_AI_PROVIDER: "qwen", RESUME_AI_WORKSPACE_ID: "ws-123", RESUME_AI_API_KEY: "k", RESUME_AI_MODEL_FAST: "qwen3.8-flash" });
  assert.deepEqual(fallback.prices.fast, { input: 0.15, output: 0.47 });
  assert.equal(costMicros({ input: 0.15, output: 0.47 }, 1_000_000, 0), 150_000);
});

test("RS3-AI-PROMPTS every prompt is versioned, budgeted, says JSON and declares data as data", () => {
  const ids = new Set<string>();
  for (const spec of PROMPTS) {
    assert.ok(!ids.has(spec.id), spec.id);
    ids.add(spec.id);
    assert.ok(spec.version >= 1 && spec.maxInputTokens > 0 && spec.maxOutputTokens > 0 && spec.maxOutputTokens <= 2500);
    assert.ok(["fast", "rewrite"].includes(spec.alias));
  }
  assert.equal(PROMPTS.length, 7);
});

test("RS3-AI-QWEN body: no thinking, JSON mode, no tools; transport parses usage and ignores tool_calls", async () => {
  const req: TransportRequest = { promptId: "card_headline", model: "qwen3.7-flash", system: "S JSON", user: "U", maxTokens: 100, timeoutMs: 1000 };
  const body = buildQwenBody(req);
  assert.equal(body.enable_thinking, false);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.max_tokens, 100);
  assert.equal("tools" in body, false);
  assert.equal("promptId" in body, false, "internal fields are not sent");

  let seen: { url: string; init: RequestInit } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"answer":"x"}', tool_calls: [{ function: { name: "fetch", arguments: "{}" } }] } }],
        usage: { prompt_tokens: 40, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 30 } }
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;
  const t = qwenTransport({ baseUrl: "https://ws-1.us-east-1.maas.aliyuncs.com/compatible-mode/v1", apiKey: "sk-test", fetchImpl });
  const out = await t(req);
  assert.deepEqual(out, { content: '{"answer":"x"}', usage: { promptTokens: 40, completionTokens: 5, cachedTokens: 30 } });
  assert.equal(seen!.url, "https://ws-1.us-east-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions");
  assert.equal(seen!.init.redirect, "error");

  const failing = qwenTransport({ baseUrl: "https://ws-1.us-east-1.maas.aliyuncs.com/compatible-mode/v1", apiKey: "sk-test", fetchImpl: (async () => new Response("{\"error\":\"prompt echo: secreto\"}", { status: 401 })) as unknown as typeof fetch });
  await assert.rejects(failing(req), (e: Error) => e.message === "proveedor IA: http 401" && !e.message.includes("secreto"));
  const huge = qwenTransport({ baseUrl: "https://x-1.us-east-1.maas.aliyuncs.com/compatible-mode/v1", apiKey: "k", fetchImpl: (async () => new Response("x".repeat(300 * 1024), { status: 200 })) as unknown as typeof fetch });
  await assert.rejects(huge(req), /too_large/);
});

test("RS3-AI-OFF provider none never calls anything", async () => {
  const transport = fakeTransport(['{"answer":"x"}']);
  const ledger = new MemoryLedger();
  const g = createGateway({ config: parseResumeAiConfig({}), ledger, transport });
  assert.equal(g.enabled, false);
  assert.deepEqual(await g.complete(SPEC, { q: "hola" }, ctx), { ok: false, code: "ai_off" });
  assert.equal(transport.calls.length, 0);
  assert.equal(ledger.rows.length, 0);
});

test("RS3-AI-RETRY one retry on invalid JSON, then invalid_output; each attempt reserved and costed", async () => {
  const ledger = new MemoryLedger();
  const t1 = fakeTransport(["no es json", '{"answer":"bien"}']);
  const g1 = createGateway({ config: mockConfig(), ledger, transport: t1 });
  const ok = await g1.complete(SPEC, { q: "uno" }, ctx);
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.attempts, 2);
  assert.deepEqual(ledger.rows.map((r) => r.status), ["invalid_json", "ok"]);

  const t2 = fakeTransport(['{"answer": 5}', '{"otra":"cosa"}', '{"answer":"tarde"}']);
  const g2 = createGateway({ config: mockConfig(), ledger: new MemoryLedger(), transport: t2 });
  assert.deepEqual(await g2.complete(SPEC, { q: "dos" }, ctx), { ok: false, code: "invalid_output" });
  assert.equal(t2.calls.length, 2, "never a third attempt");
  assert.equal(parseJsonObject("```json\n{\"a\":1}\n```") !== undefined, true);
  assert.equal(parseJsonObject("[1,2]"), undefined);
});

test("RS3-AI-CACHE same input is served from memory at zero cost; input over budget never leaves", async () => {
  const ledger = new MemoryLedger();
  const t = fakeTransport(['{"answer":"x"}']);
  const g = createGateway({ config: mockConfig(), ledger, transport: t });
  await g.complete(SPEC, { q: "repetida" }, ctx);
  const again = await g.complete(SPEC, { q: "repetida" }, ctx);
  assert.equal(again.ok && again.cached, true);
  assert.equal(t.calls.length, 1);
  assert.equal(ledger.rows.at(-1)?.status, "cache_hit");
  assert.equal(ledger.rows.at(-1)?.costMicros, 0);
  assert.deepEqual(await g.complete(SPEC, { q: "x".repeat(5000) }, ctx), { ok: false, code: "too_long" });
  assert.equal(t.calls.length, 1);
});

test("RS3-AI-CAPS each of the four caps blocks BEFORE the call (worst case reserved)", async () => {
  const caps: [string, Record<string, string>][] = [
    ["adaptation", { RESUME_AI_CAP_ADAPTATION_USD: "0.00001" }],
    ["user_daily", { RESUME_AI_CAP_USER_DAILY_USD: "0.00001" }],
    ["global_daily", { RESUME_AI_CAP_GLOBAL_DAILY_USD: "0.00001" }],
    ["global_monthly", { RESUME_AI_CAP_GLOBAL_MONTHLY_USD: "0.00001" }]
  ];
  for (const [code, env] of caps) {
    const t = fakeTransport(['{"answer":"x"}']);
    const g = createGateway({ config: mockConfig(env), ledger: new MemoryLedger(), transport: t });
    assert.deepEqual(await g.complete(SPEC, { q: code }, ctx), { ok: false, code }, code);
    assert.equal(t.calls.length, 0, `${code}: no call`);
  }
  // Spend accumulates: worst case ≈ 49 micro-USD, real ≈ 13: a 70 micro-USD cap allows 2 calls, never 3.
  const ledger = new MemoryLedger();
  const t = fakeTransport(['{"answer":"x"}']);
  const g = createGateway({ config: mockConfig({ RESUME_AI_CAP_ADAPTATION_USD: "0.00007", RESUME_AI_MODEL_FAST: "qwen3.8-flash" }), ledger, transport: t });
  const results = [];
  for (let i = 0; i < 3; i++) results.push(await g.complete(SPEC, { q: `n${i}` }, ctx));
  assert.deepEqual(results.map((r) => r.ok), [true, true, false]);
  assert.equal(results.at(-1)?.ok, false);
  const spent = ledger.rows.reduce((a, r) => a + r.costMicros, 0);
  assert.ok(spent <= 70, `spent ${spent} micro-USD`);
});

test("RS3-AI-TURNS the free chat stops at 8 turns per adaptation", async () => {
  const ledger = new MemoryLedger();
  const t = fakeTransport(['{"answer":"x"}']);
  const g = createGateway({ config: mockConfig(), ledger, transport: t });
  const chat = { ...ctx, purpose: "card_chat", maxTurns: 8 };
  for (let i = 0; i < 8; i++) assert.equal((await g.complete(SPEC, { q: `turno ${i}` }, chat)).ok, true);
  assert.deepEqual(await g.complete(SPEC, { q: "turno 9" }, chat), { ok: false, code: "chat_turns" });
  assert.equal(t.calls.length, 8);
  // Another adaptation has its own 8.
  assert.equal((await g.complete(SPEC, { q: "otra" }, { ...chat, adaptationId: "b0000000-0000-4000-8000-000000000002" })).ok, true);
});

test("RS3-AI-LEDGER rows hold no content (ids, model, tokens, cost, status only)", async () => {
  const ledger = new MemoryLedger();
  const g = createGateway({ config: mockConfig(), ledger, transport: fakeTransport(['{"answer":"respuesta privada"}']) });
  await ledger.startAdaptation(USER, ADAPT);
  await g.complete(SPEC, { q: "Laura Méndez, laura@ejemplo.test, 300 000 0000" }, ctx);
  const allowed = new Set(["id", "userId", "adaptationId", "purpose", "promptId", "promptVersion", "alias", "model", "attempt", "status", "inputTokens", "outputTokens", "cachedTokens", "costMicros", "cacheHit", "latencyMs", "createdAt"]);
  for (const row of ledger.rows) for (const key of Object.keys(row)) assert.ok(allowed.has(key), key);
  const dump = JSON.stringify(ledger.rows);
  for (const needle of ["Laura", "ejemplo.test", "300 000", "privada"]) assert.equal(dump.includes(needle), false, needle);
  assert.equal(await ledger.ownsAdaptation(USER, ADAPT), true);
  assert.equal(await ledger.ownsAdaptation("a0000000-0000-4000-8000-000000000009", ADAPT), false);
});

test("RS3-AI-WINDOWS Colombian day and month (UTC−5)", () => {
  const w = colombiaWindows(new Date("2026-12-01T03:00:00Z")); // 2026-11-30 22:00 in Bogotá
  assert.equal(w.dayStart.toISOString(), "2026-11-30T05:00:00.000Z");
  assert.equal(w.monthStart.toISOString(), "2026-11-01T05:00:00.000Z");
});
