// Real DB + real webhook signature logic, no mocks — same philosophy as the
// other validate-*.ts scripts. Exercises the "a payment approval flips the
// tier" path end-to-end without needing a live browser, a real Wompi sandbox
// card, or an authenticated Supabase session: it drives handleWompiWebhook
// directly with hand-signed payloads, exactly like Wompi's real server would
// call our endpoint. Inserts and then deletes its own rows — never touches
// other users' data.
import crypto from "crypto";
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { getOrCreateUser, createPendingTransaction, getUserTier } from "../src/db/job-repository.js";
import { handleWompiWebhook, WompiEventPayload } from "../src/payments/webhook.js";
import { PRO_MONTHLY_PRICE_COP_CENTS } from "../src/config.js";

dotenv.config();

const WOMPI_EVENTS_SECRET = process.env.WOMPI_EVENTS_SECRET;
if (!WOMPI_EVENTS_SECRET) {
  console.error("❌ Falta WOMPI_EVENTS_SECRET en .env — no se puede validar el webhook.");
  process.exit(1);
}

const PROPERTIES = ["data.transaction.id", "data.transaction.status", "data.transaction.amount_in_cents"];

function buildPayload(
  wompiTransactionId: string,
  reference: string,
  status: string,
  amountInCents: number,
  opts: { tamperChecksum?: boolean } = {}
): WompiEventPayload {
  const timestamp = Date.now();
  const concatenated = [wompiTransactionId, status, String(amountInCents)].join("");
  let checksum = crypto
    .createHash("sha256")
    .update(`${concatenated}${timestamp}${WOMPI_EVENTS_SECRET}`)
    .digest("hex");
  if (opts.tamperChecksum) checksum = `tampered${checksum.slice(9)}`;

  return {
    event: "transaction.updated",
    data: { transaction: { id: wompiTransactionId, status, reference, amount_in_cents: amountInCents } },
    signature: { properties: PROPERTIES, checksum },
    timestamp,
    environment: "test"
  };
}

let failures = 0;
function report(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  console.log("==================================================");
  console.log("🧪 SUITE DE VALIDACIÓN — Webhook de pago Wompi → flip de tier (DB real)");
  console.log("==================================================\n");

  const testUserId = crypto.randomUUID();
  const testEmail = `e2e_webhook_${Date.now()}@mailinator.com`;
  const reference = `e2e_test_${Date.now()}`;
  const wompiTransactionId = `wompi_test_${Date.now()}`;
  const amountInCents = PRO_MONTHLY_PRICE_COP_CENTS;

  try {
    await getOrCreateUser(testUserId, testEmail);
    const initialTier = await getUserTier(testUserId);
    report("Usuario de prueba nace en tier 'free'", initialTier === "free", `tier=${initialTier}`);

    await createPendingTransaction({ userId: testUserId, reference, amountInCents, currency: "COP" });

    // 1. Firma alterada — debe rechazarse y NO tocar el tier.
    const tampered = buildPayload(wompiTransactionId, reference, "APPROVED", amountInCents, {
      tamperChecksum: true
    });
    const tamperedResult = await handleWompiWebhook(tampered);
    report("Payload con firma alterada es rechazado (verified: false)", tamperedResult.verified === false);
    const tierAfterTamper = await getUserTier(testUserId);
    report("Tier NO cambia tras una firma inválida", tierAfterTamper === "free", `tier=${tierAfterTamper}`);

    // 2. Firma correcta, transacción APPROVED — debe subir el tier a pro.
    const valid = buildPayload(wompiTransactionId, reference, "APPROVED", amountInCents);
    const validResult = await handleWompiWebhook(valid);
    report("Payload con firma correcta es aceptado (verified: true)", validResult.verified === true);
    const tierAfterApproval = await getUserTier(testUserId);
    report("Tier sube a 'pro' tras el pago aprobado", tierAfterApproval === "pro", `tier=${tierAfterApproval}`);

    // 3. Reenvío del mismo evento (Wompi reintenta hasta 3x) — debe ser un no-op idempotente.
    const retryResult = await handleWompiWebhook(valid);
    report("Reenviar el mismo evento no falla (idempotente)", retryResult.verified === true);
    const tierAfterRetry = await getUserTier(testUserId);
    report("Tier se mantiene 'pro' tras el reintento", tierAfterRetry === "pro", `tier=${tierAfterRetry}`);
  } finally {
    // Cleanup — solo las filas de este usuario de prueba, nunca datos reales.
    await pool.query("DELETE FROM transactions WHERE user_id = $1", [testUserId]);
    await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);
  }

  console.log("\n==================================================");
  if (failures === 0) {
    console.log("✅ TODO PASÓ");
  } else {
    console.log(`❌ ${failures} verificación(es) fallaron`);
  }
  console.log("==================================================");
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("❌ Error inesperado en la suite:", err);
  process.exit(1);
});
