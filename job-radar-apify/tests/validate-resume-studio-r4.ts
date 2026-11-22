import "./require-isolated-database.js";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { VerifiedSession } from "../src/auth/verify-session.js";
import { pool } from "../src/db/client.js";
import { createPendingTransaction } from "../src/db/job-repository.js";
import { PgUsageLedger } from "../src/db/resume-studio-ai-repository.js";
import { consumeAdaptation, createPendingPassTransaction, getActiveEntitlement } from "../src/db/resume-studio-pass-repository.js";
import { CONSENT_ITEMS, RESUME_POLICY_VERSION, emptyResumeFacts } from "../src/lib/resume-studio.js";
import { computeWompiChecksum } from "../src/payments/wompi-signature.js";
import { handleWompiWebhook, type WompiEventPayload } from "../src/payments/webhook.js";
import { parseResumeAiConfig } from "../src/resume-studio/ai/config.js";
import { createGateway } from "../src/resume-studio/ai/gateway.js";
import { mockTransport } from "../src/resume-studio/ai/mock.js";
import { setResumeAiRuntimeForTests } from "../src/resume-studio/ai/runtime.js";
import { RESUME_FREE_ADAPTATIONS } from "../src/resume-studio/payments/passes.js";
import { handleResumeRoute } from "../src/server/routes/resume.js";
import { adaptationIdFor, clearStartMemoForTests } from "../src/server/routes/resume-ai.js";
import { setWompiFetchForTests } from "../src/server/routes/resume-pass.js";
import { SYNTHETIC_CVS, SYNTHETIC_JOBS } from "./fixtures/resume-tailor-synthetic.js";

// AI Resume Studio R4 against the disposable PostgreSQL (ADR 0017 §5–6).
// T-PAY-1..5 (approved, declined, duplicate, altered amount, bad signature)
// with FIXTURE events signed by the runner's synthetic WOMPI_EVENTS_SECRET:
// no Wompi account, no sandbox keys, no real money. Plus: the subscription
// flow behaves as before (now with H2), passes stack, the adaptation quota
// is atomic and survives «borrar todo», checkout/confirm/docx over HTTP
// (flag, IDOR, the return URL never unlocks), and the Wompi API answer goes
// through the same H2 check.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TEST_HTTP_PORT);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = process.env.WOMPI_EVENTS_SECRET!;
const USER_A = "4e540000-0000-4000-8000-00000000000a";
const USER_B = "4e540000-0000-4000-8000-00000000000b";
const USER_S = "4e540000-0000-4000-8000-00000000000c";
const USER_Q = "4e540000-0000-4000-8000-00000000000d";
const TOKENS: Record<string, string> = { "token-a": USER_A, "token-b": USER_B, "token-q": USER_Q };
const PROPS = ["transaction.id", "transaction.status", "transaction.amount_in_cents"];
let seq = 0;

function event(reference: string, status: string, amountInCents: number, opts: { tamper?: boolean; id?: string; currency?: string } = {}): WompiEventPayload {
  const id = opts.id ?? `t4-${Date.now()}-${++seq}`;
  const payload: WompiEventPayload = {
    event: "transaction.updated",
    data: { transaction: { id, status, reference, amount_in_cents: amountInCents, ...(opts.currency ? { currency: opts.currency } : {}) } },
    signature: { properties: PROPS, checksum: "" },
    timestamp: Math.floor(Date.now() / 1000),
    environment: "test"
  };
  const checksum = computeWompiChecksum(payload, SECRET)!;
  payload.signature.checksum = opts.tamper ? `${checksum.slice(0, 63)}${checksum.endsWith("0") ? "1" : "0"}` : checksum;
  return payload;
}

async function row(reference: string) {
  return (await pool.query(`SELECT status, product, plan, amount_in_cents, wompi_transaction_id FROM transactions WHERE reference = $1`, [reference])).rows[0];
}
async function entitlements(userId: string) {
  return (await pool.query(`SELECT * FROM rs_entitlements WHERE user_id = $1 ORDER BY starts_at`, [userId])).rows;
}
async function tier(userId: string) {
  return (await pool.query(`SELECT subscription_tier, subscription_end FROM users WHERE id = $1`, [userId])).rows[0];
}

function session(id: string): VerifiedSession {
  return { id, email: `${id}@example.test`, name: null, tier: "free", subscriptionEnd: null, preferredRoles: null, authCreatedAt: null };
}

async function call(method: string, url: string, token?: string, body?: unknown) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const type = res.headers.get("content-type") || "";
  if (type.includes("wordprocessingml")) return { status: res.status, data: null, bytes: Buffer.from(await res.arrayBuffer()), type };
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, bytes: null, type };
}

async function main() {
  console.log("\n🧪 SUITE: Resume Studio R4 (pases Wompi, webhook H1/H2, rs_entitlements, cupos)\n");
  assert.ok(SECRET && SECRET.startsWith("p0-synthetic"), "solo el secreto sintético del runner");
  for (const role of ["anon", "authenticated"]) {
    await pool.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  }
  const schema = await readFile(path.join(__dirname, "..", "src", "db", "schema.sql"), "utf8");
  const users = /CREATE TABLE IF NOT EXISTS users \([\s\S]*?\n\);/.exec(schema)?.[0];
  const transactions = /CREATE TABLE IF NOT EXISTS transactions \([\s\S]*?\n\);/.exec(schema)?.[0];
  const planColumn = /ALTER TABLE transactions ADD COLUMN IF NOT EXISTS plan [^;]+;/.exec(schema)?.[0];
  const block = /-- BEGIN resume-studio\r?\n([\s\S]*?)-- END resume-studio/.exec(schema)?.[1];
  assert.ok(users && transactions && planColumn && block);
  await pool.query(users);
  await pool.query(transactions);
  await pool.query(planColumn);
  // A subscription row written BEFORE the R4 column exists keeps its meaning.
  for (const id of [USER_A, USER_B, USER_S, USER_Q]) {
    await pool.query(`INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [id, `${id}@example.test`]);
  }
  await createPendingTransaction({ userId: USER_S, reference: "jobradar_pro_legacy_1", amountInCents: 1490000, currency: "COP", plan: "pro" });
  await pool.query(block);
  await pool.query(block);
  assert.equal((await row("jobradar_pro_legacy_1")).product, "subscription");

  // 0. Table shape: RLS on, nothing for anon/authenticated, no CV content.
  for (const table of ["rs_entitlements", "rs_adaptation_quota"]) {
    const rls = await pool.query(`SELECT relrowsecurity FROM pg_class WHERE relname = $1`, [table]);
    assert.equal(rls.rows[0]?.relrowsecurity, true, table);
    const grants = await pool.query(`SELECT 1 FROM information_schema.role_table_grants WHERE table_name = $1 AND grantee IN ('anon', 'authenticated')`, [table]);
    assert.equal(grants.rowCount, 0, table);
  }
  await assert.rejects(pool.query(`UPDATE transactions SET product = 'otra' WHERE reference = 'jobradar_pro_legacy_1'`), /transactions_product_check/);
  console.log("✅ [PASSED] Esquema R4: bloque idempotente, transactions.product aditivo ('subscription' por defecto), RLS y 0 permisos públicos.");

  const before = await tier(USER_A);

  // T-PAY-1: approved → one pass, subscription tier untouched.
  const p1 = await createPendingPassTransaction(USER_A, "pass_1m");
  assert.match(p1.reference, new RegExp(`^rs_pass_pass_1m_${USER_A}_\\d+_[0-9a-f]{12}$`));
  const r1 = await row(p1.reference);
  assert.deepEqual([r1.status, r1.product, r1.plan, Number(r1.amount_in_cents)], ["pending", "resume_pass", "pass_1m", 1490000]);
  const approved = event(p1.reference, "APPROVED", 1490000, { currency: "COP" });
  assert.deepEqual(await handleWompiWebhook(approved), { verified: true, outcome: "approved" });
  assert.equal((await row(p1.reference)).status, "approved");
  let ents = await entitlements(USER_A);
  assert.equal(ents.length, 1);
  assert.equal(ents[0].pass_id, "pass_1m");
  assert.equal(Number(ents[0].adaptations_per_period), 30);
  assert.equal(Math.round((new Date(ents[0].expires_at).getTime() - new Date(ents[0].starts_at).getTime()) / 86400000), 30);
  assert.deepEqual(await tier(USER_A), before, "un pase nunca toca subscription_tier/subscription_end");
  console.log("✅ [PASSED] T-PAY-1 aprobado: transacción approved, un rs_entitlements de 30 días y 30 adaptaciones; subscription_tier intacto.");

  // T-PAY-2: declined → closed, nothing unlocked.
  const p2 = await createPendingPassTransaction(USER_B, "pass_7d");
  assert.deepEqual(await handleWompiWebhook(event(p2.reference, "DECLINED", 690000)), { verified: true, outcome: "closed" });
  assert.equal((await row(p2.reference)).status, "declined");
  assert.equal((await entitlements(USER_B)).length, 0);
  assert.equal(await getActiveEntitlement(USER_B), null);
  // ERROR (and VOIDED) close a pending pass row too.
  const p2b = await createPendingPassTransaction(USER_B, "pass_7d");
  assert.equal((await handleWompiWebhook(event(p2b.reference, "ERROR", 690000))).outcome, "closed");
  assert.equal((await row(p2b.reference)).status, "error");
  // Subscriptions keep the old behaviour: a declined event is a no-op.
  await createPendingTransaction({ userId: USER_S, reference: "jobradar_pro_declined_1", amountInCents: 1490000, currency: "COP", plan: "pro" });
  assert.equal((await handleWompiWebhook(event("jobradar_pro_declined_1", "DECLINED", 1490000))).outcome, "ignored");
  assert.equal((await row("jobradar_pro_declined_1")).status, "pending");
  console.log("✅ [PASSED] T-PAY-2 rechazado: la fila del pase queda declined/error, sin pase; la suscripción sigue como antes (no-op).");

  // T-PAY-3: duplicate deliveries (sequential and concurrent) → exactly one pass.
  const firstExpiry = new Date(ents[0].expires_at).toISOString();
  assert.equal((await handleWompiWebhook(approved)).outcome, "already_approved");
  const burst = await Promise.all(Array.from({ length: 6 }, () => handleWompiWebhook(approved)));
  assert.ok(burst.every((r) => r.verified && r.outcome === "already_approved"));
  const p3 = await createPendingPassTransaction(USER_B, "pass_1m");
  const e3 = event(p3.reference, "APPROVED", 1490000);
  const race = await Promise.all(Array.from({ length: 8 }, () => handleWompiWebhook(e3)));
  assert.equal(race.filter((r) => r.outcome === "approved").length, 1, JSON.stringify(race));
  assert.equal(race.filter((r) => r.outcome === "already_approved").length, 7);
  ents = await entitlements(USER_A);
  assert.equal(ents.length, 1);
  assert.equal(new Date(ents[0].expires_at).toISOString(), firstExpiry);
  assert.equal((await entitlements(USER_B)).length, 1);
  console.log("✅ [PASSED] T-PAY-3 duplicado: reintentos y 8 entregas concurrentes crean exactamente un pase; la vigencia no cambia.");

  // T-PAY-4: altered amount (validly signed) → nothing approved, nothing unlocked.
  const p4 = await createPendingPassTransaction(USER_Q, "pass_3m");
  for (const bad of [
    event(p4.reference, "APPROVED", 100),
    event(p4.reference, "APPROVED", 2970000 - 1),
    event(p4.reference, "APPROVED", 2970000 * 2),
    event(p4.reference, "APPROVED", 2970000, { currency: "USD" })
  ]) {
    assert.deepEqual(await handleWompiWebhook(bad), { verified: true, outcome: "amount_mismatch" });
  }
  assert.equal((await row(p4.reference)).status, "pending");
  assert.equal((await row(p4.reference)).wompi_transaction_id, null);
  assert.equal((await entitlements(USER_Q)).length, 0);
  // H2 also protects subscriptions now: an altered amount never upgrades.
  await createPendingTransaction({ userId: USER_S, reference: "jobradar_pro_max_cheap", amountInCents: 2990000, currency: "COP", plan: "pro_max" });
  assert.equal((await handleWompiWebhook(event("jobradar_pro_max_cheap", "APPROVED", 100))).outcome, "amount_mismatch");
  assert.equal((await tier(USER_S)).subscription_tier, "free");
  console.log("✅ [PASSED] T-PAY-4 monto alterado (firma válida): 4 variantes rechazadas por H2; ni pase ni tier.");

  // T-PAY-5: invalid signature → rejected before reading anything.
  const p5 = await createPendingPassTransaction(USER_Q, "pass_7d");
  const forged = [
    event(p5.reference, "APPROVED", 690000, { tamper: true }),
    { ...event(p5.reference, "APPROVED", 690000), signature: { properties: PROPS, checksum: "deadbeef" } },
    { ...event(p5.reference, "APPROVED", 690000), signature: { properties: [], checksum: "" } }
  ];
  // Re-signed with another secret: still invalid.
  const other = event(p5.reference, "APPROVED", 690000);
  other.signature.checksum = computeWompiChecksum(other, "not-the-secret")!;
  forged.push(other);
  for (const f of forged) assert.deepEqual(await handleWompiWebhook(f as WompiEventPayload), { verified: false, outcome: "invalid_signature" });
  assert.equal((await row(p5.reference)).status, "pending");
  assert.equal((await entitlements(USER_Q)).length, 0);
  // Same for a subscription row (parity with tests/validate-payment-flow.ts).
  assert.equal((await handleWompiWebhook(event("jobradar_pro_legacy_1", "APPROVED", 1490000, { tamper: true }))).verified, false);
  assert.equal((await row("jobradar_pro_legacy_1")).status, "pending");
  assert.equal((await tier(USER_S)).subscription_tier, "free");
  console.log("✅ [PASSED] T-PAY-5 firma inválida (alterada, corta, vacía, otro secreto): rechazada, la fila sigue pending.");

  // Subscription flow unchanged (happy path + legacy row + unknown reference).
  assert.equal((await handleWompiWebhook(event("jobradar_pro_legacy_1", "APPROVED", 1490000))).outcome, "approved");
  let s = await tier(USER_S);
  assert.equal(s.subscription_tier, "pro");
  assert.ok(Math.abs(new Date(s.subscription_end).getTime() - Date.now() - 30 * 86400000) < 60000);
  await createPendingTransaction({ userId: USER_S, reference: "jobradar_pro_max_ok", amountInCents: 2990000, currency: "COP", plan: "pro_max" });
  assert.equal((await handleWompiWebhook(event("jobradar_pro_max_ok", "APPROVED", 2990000))).outcome, "approved");
  s = await tier(USER_S);
  assert.equal(s.subscription_tier, "pro_max");
  assert.equal((await handleWompiWebhook(event("jobradar_pro_max_ok", "APPROVED", 2990000))).outcome, "already_approved");
  assert.equal((await handleWompiWebhook(event("no_such_reference", "APPROVED", 1))).outcome, "unknown_reference");
  assert.equal((await entitlements(USER_S)).length, 0, "una suscripción nunca crea pases");
  console.log("✅ [PASSED] Suscripción: pro y pro_max suben el tier 30 días como antes, idempotentes; una suscripción no crea pases.");

  // Passes stack: the second starts when the first ends.
  const p6 = await createPendingPassTransaction(USER_A, "pass_7d");
  assert.equal((await handleWompiWebhook(event(p6.reference, "APPROVED", 690000))).outcome, "approved");
  ents = await entitlements(USER_A);
  assert.equal(ents.length, 2);
  assert.equal(new Date(ents[1].starts_at).toISOString(), firstExpiry);
  assert.equal((await getActiveEntitlement(USER_A))?.passId, "pass_1m");
  console.log("✅ [PASSED] Pases acumulables: el segundo empieza cuando vence el primero.");

  // Quota: atomic under concurrency, pass first then free.
  const quotaUser = USER_Q;
  const pq = await createPendingPassTransaction(quotaUser, "pass_7d");
  assert.equal((await handleWompiWebhook(event(pq.reference, "APPROVED", 690000))).outcome, "approved");
  const grabs = await Promise.all(Array.from({ length: 20 }, () => consumeAdaptation(quotaUser)));
  assert.equal(grabs.filter((g) => g.ok && g.source === "pass").length, 10);
  assert.equal(grabs.filter((g) => g.ok && g.source === "free").length, RESUME_FREE_ADAPTATIONS);
  assert.equal(grabs.filter((g) => !g.ok).length, 20 - 10 - RESUME_FREE_ADAPTATIONS);
  console.log(`✅ [PASSED] Cupo atómico: 20 consumos concurrentes → 10 del pase + ${RESUME_FREE_ADAPTATIONS} gratis, el resto negado.`);

  // HTTP: checkout, confirm, docx, quota on /tailor/start.
  const config = parseResumeAiConfig({ RESUME_AI_PROVIDER: "mock" });
  const ledger = new PgUsageLedger();
  setResumeAiRuntimeForTests({ gateway: createGateway({ config, ledger, transport: mockTransport({ fabricationRate: 0, invalidJsonRate: 0 }) }), ledger });
  let wompiAnswer: Record<string, unknown> | null = null;
  setWompiFetchForTests(async () => ({ ok: wompiAnswer !== null, status: wompiAnswer ? 200 : 404, text: async () => JSON.stringify({ data: wompiAnswer }) }));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", BASE);
    void handleResumeRoute(req, res, url.pathname, req.method || "GET", {
      getSession: async (r) => {
        const token = /^Bearer (.+)$/.exec(String(r.headers.authorization || ""))?.[1];
        const id = token ? TOKENS[token] : undefined;
        return id ? session(id) : null;
      },
      loadIndexHtml: async () => "<!doctype html><title>shell</title>"
    }).catch((error) => {
      res.writeHead(599);
      res.end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  const env = { payments: process.env.RESUME_STUDIO_PAYMENTS, pub: process.env.WOMPI_PUBLIC_KEY };
  try {
    assert.equal((await call("GET", "/api/resume/pass")).status, 401);
    // Flag off (default): checkout and confirm are 404; status still readable.
    delete process.env.RESUME_STUDIO_PAYMENTS;
    let res = await call("POST", "/api/resume/checkout", "token-b", { passId: "pass_1m" });
    assert.equal(res.status, 404);
    assert.equal((await call("POST", "/api/resume/checkout/confirm", "token-b", { transactionId: "1-2-3" })).status, 404);
    res = await call("GET", "/api/resume/pass", "token-b");
    assert.equal(res.status, 200);
    assert.equal(res.data.paymentsEnabled, false);
    assert.deepEqual(res.data.passes.map((p: { priceCop: number }) => p.priceCop), [6900, 14900, 29700]);

    process.env.RESUME_STUDIO_PAYMENTS = "true";
    process.env.WOMPI_PUBLIC_KEY = "pub_test_p0synthetic";
    res = await call("POST", "/api/resume/checkout", "token-b", { passId: "pass_1m" });
    assert.equal(res.data.code, "consent_required");
    for (const token of ["token-a", "token-b", "token-q"]) {
      const consent = await call("POST", "/api/resume/consent", token, {
        policyVersion: RESUME_POLICY_VERSION,
        decisions: Object.fromEntries(CONSENT_ITEMS.map((item) => [item.purpose, item.purpose !== "cloud_storage"]))
      });
      assert.equal(consent.status, 201);
    }
    for (const passId of ["pro", "pro_max", "", null, 14900, "pass_1m; DROP"]) {
      assert.equal((await call("POST", "/api/resume/checkout", "token-b", { passId })).status, 400, String(passId));
    }
    res = await call("POST", "/api/resume/checkout", "token-b", { passId: "pass_3m", amountInCents: 100 });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.amountInCents, 2970000, "el monto sale del catálogo, nunca del cliente");
    assert.equal(res.data.currency, "COP");
    assert.equal(res.data.publicKey, "pub_test_p0synthetic");
    assert.match(res.data.signatureIntegrity, /^[0-9a-f]{64}$/);
    const checkoutRef: string = res.data.reference;
    assert.equal((await row(checkoutRef)).product, "resume_pass");
    process.env.WOMPI_PUBLIC_KEY = "pub_prod_live";
    assert.equal((await call("POST", "/api/resume/checkout", "token-b", { passId: "pass_7d" })).status, 503, "llaves de producción bloqueadas hasta R5");
    process.env.WOMPI_PUBLIC_KEY = "pub_test_p0synthetic";

    // Coming back from the checkout: the URL id only says what to ask Wompi.
    const activeBefore = await getActiveEntitlement(USER_B);
    wompiAnswer = { id: "77-1-1", status: "PENDING", reference: checkoutRef, amount_in_cents: 2970000, currency: "COP" };
    res = await call("POST", "/api/resume/checkout/confirm", "token-b", { transactionId: "77-1-1" });
    assert.equal(res.data.status, "pending");
    assert.equal((await row(checkoutRef)).status, "pending", "volver de Wompi no desbloquea nada");
    // IDOR: someone else's approved payment → 404, nothing for A.
    wompiAnswer = { id: "77-1-1", status: "APPROVED", reference: checkoutRef, amount_in_cents: 2970000, currency: "COP" };
    res = await call("POST", "/api/resume/checkout/confirm", "token-a", { transactionId: "77-1-1" });
    assert.equal(res.status, 404);
    // Wompi says approved but with another amount → H2.
    wompiAnswer = { id: "77-1-1", status: "APPROVED", reference: checkoutRef, amount_in_cents: 100, currency: "COP" };
    res = await call("POST", "/api/resume/checkout/confirm", "token-b", { transactionId: "77-1-1" });
    assert.equal(res.status, 409);
    assert.equal((await row(checkoutRef)).status, "pending");
    // Wompi unreachable / unknown id.
    wompiAnswer = null;
    assert.equal((await call("POST", "/api/resume/checkout/confirm", "token-b", { transactionId: "77-1-1" })).status, 502);
    assert.equal((await call("POST", "/api/resume/checkout/confirm", "token-b", { transactionId: "../../x" })).status, 400);
    // The real answer.
    wompiAnswer = { id: "77-1-1", status: "APPROVED", reference: checkoutRef, amount_in_cents: 2970000, currency: "COP" };
    res = await call("POST", "/api/resume/checkout/confirm", "token-b", { transactionId: "77-1-1" });
    assert.equal(res.data.status, "approved");
    assert.equal((await row(checkoutRef)).status, "approved");
    assert.equal((await entitlements(USER_B)).length, 2);
    assert.ok(activeBefore, "B ya tenía un pase de T-PAY-3; el nuevo se acumula");
    // The webhook arriving after the API confirm is a no-op.
    assert.equal((await handleWompiWebhook(event(checkoutRef, "APPROVED", 2970000, { id: "77-1-1" }))).outcome, "already_approved");
    assert.equal((await entitlements(USER_B)).length, 2);
    console.log("✅ [PASSED] Checkout (bandera, pase en lista blanca, monto del catálogo, solo sandbox) y confirmación por API (IDOR 404, H2 409, retorno sin desbloqueo).");

    // DOCX: 402 without an active pass, a Word file with one.
    const facts = emptyResumeFacts();
    facts.basics.fullName = "Persona Sintética";
    const userFree = "token-q";
    await pool.query(`UPDATE rs_entitlements SET starts_at = NOW() - interval '8 days', expires_at = NOW() - interval '1 day' WHERE user_id = $1`, [USER_Q]);
    res = await call("POST", "/api/resume/download/docx", userFree, { facts, templateId: "clasica" });
    assert.equal(res.status, 402);
    assert.equal(res.data.code, "pass_required");
    res = await call("POST", "/api/resume/download/docx", "token-b", { facts, templateId: "moderna" });
    assert.equal(res.status, 200);
    assert.ok(res.bytes && res.bytes.readUInt32LE(0) === 0x04034b50 && res.bytes.includes(Buffer.from("Persona Sintética")));
    assert.equal((await call("POST", "/api/resume/download/docx", "token-b", { facts: { nope: 1 }, templateId: "moderna" })).status, 400);
    console.log("✅ [PASSED] DOCX: 402 pass_required sin pase vigente; archivo Word válido con pase.");

    // Quota on /tailor/start (mock AI on): A has a pass; Q has none and its free allowance was used above.
    const cv = SYNTHETIC_CVS[0];
    const job = SYNTHETIC_JOBS[0];
    const cvFacts = emptyResumeFacts();
    cvFacts.basics.fullName = cv.id;
    res = await call("POST", "/api/resume/tailor/start", "token-q", { facts: cvFacts, job: { title: job.title, description: job.description } });
    assert.equal(res.status, 402);
    assert.equal(res.data.code, "quota_exhausted");
    assert.equal(res.data.source, "free");
    res = await call("POST", "/api/resume/tailor/start", "token-a", { facts: cvFacts, job: { title: job.title, description: job.description } });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual(res.data.quota, { source: "pass", used: 1, limit: 30 });
    // R4c: 5 concurrent starts with the SAME client key (double click, React
    // double effect) → one adaptation id, quota consumed once; a later retry
    // with that key answers the same id and still consumes nothing.
    const clientKey = "c0000000-0000-4000-8000-0000000000c4";
    const startBody = { facts: cvFacts, job: { title: job.title, description: job.description }, clientKey };
    const quotaNow = async () => Number((await pool.query(`SELECT SUM(used) AS n FROM rs_adaptation_quota`)).rows[0].n);
    const q0 = await quotaNow();
    const burst = await Promise.all(Array.from({ length: 5 }, () => call("POST", "/api/resume/tailor/start", "token-a", startBody)));
    assert.deepEqual(burst.map((r) => r.status), [200, 200, 200, 200, 200]);
    assert.equal(new Set(burst.map((r) => r.data.adaptationId)).size, 1);
    assert.equal(await quotaNow(), q0 + 1);
    clearStartMemoForTests(); // as after a restart: the unique «start» row still guards the quota
    const again = await call("POST", "/api/resume/tailor/start", "token-a", startBody);
    assert.equal(again.status, 200);
    assert.equal(again.data.adaptationId, burst[0].data.adaptationId);
    assert.equal(await quotaNow(), q0 + 1);
    // Another user with the same key gets a different id (the key is per user).
    assert.notEqual(adaptationIdFor(USER_Q, clientKey), adaptationIdFor(USER_A, clientKey));
    assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM rs_ai_usage WHERE adaptation_id = $1 AND status = 'start'`, [again.data.adaptationId])).rows[0].n), 1);
    console.log("✅ [PASSED] R4c: 5 inicios simultáneos con la misma clave = una adaptación y un solo cupo; reintento tras reinicio sin cobro.");
    // Cards never consume.
    const usedBefore = Number((await pool.query(`SELECT SUM(used) AS n FROM rs_adaptation_quota`)).rows[0].n);
    await call("POST", "/api/resume/tailor/card", "token-a", { adaptationId: res.data.adaptationId, card: "headline", jobTitle: job.title, facts: cvFacts });
    assert.equal(Number((await pool.query(`SELECT SUM(used) AS n FROM rs_adaptation_quota`)).rows[0].n), usedBefore);
    // «Borrar todo» and «revocar» keep purchases and the quota count.
    assert.equal((await call("DELETE", "/api/resume/data", "token-a")).status, 200);
    assert.equal((await call("POST", "/api/resume/consent", "token-q", { policyVersion: RESUME_POLICY_VERSION, revoke: true })).status, 201);
    assert.equal((await entitlements(USER_A)).length, 2);
    assert.ok(Number((await pool.query(`SELECT used FROM rs_adaptation_quota WHERE bucket = $1`, [`free:${USER_Q}`])).rows[0].used) === RESUME_FREE_ADAPTATIONS);
    // With the AI off, an adaptation costs no quota.
    const offConfig = parseResumeAiConfig({ RESUME_AI_PROVIDER: "none" });
    setResumeAiRuntimeForTests({ gateway: createGateway({ config: offConfig, ledger, transport: null }), ledger });
    const consent = await call("POST", "/api/resume/consent", "token-q", {
      policyVersion: RESUME_POLICY_VERSION,
      decisions: Object.fromEntries(CONSENT_ITEMS.map((item) => [item.purpose, item.purpose !== "cloud_storage"]))
    });
    assert.equal(consent.status, 201);
    res = await call("POST", "/api/resume/tailor/start", "token-q", { facts: cvFacts, job: { title: job.title, description: job.description } });
    assert.equal(res.status, 200);
    assert.equal(res.data.quota, null);
    console.log("✅ [PASSED] Cupo en /tailor/start: 402 sin cupo, el pase se consume primero, tarjetas no consumen, borrar/revocar no lo reinician, IA apagada no consume.");
  } finally {
    if (env.payments === undefined) delete process.env.RESUME_STUDIO_PAYMENTS;
    else process.env.RESUME_STUDIO_PAYMENTS = env.payments;
    if (env.pub === undefined) delete process.env.WOMPI_PUBLIC_KEY;
    else process.env.WOMPI_PUBLIC_KEY = env.pub;
    setWompiFetchForTests(null);
    setResumeAiRuntimeForTests(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

main().catch((error) => {
  console.error("❌ [FAILED]", error);
  process.exit(1);
});
