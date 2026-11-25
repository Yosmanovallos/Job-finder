import type http from "node:http";
import { z } from "zod";
import { RESUME_TEMPLATE_IDS, resumeFactsSchema } from "../../lib/resume-studio.js";
import { approveWompiTransaction } from "../../payments/approve.js";
import {
  createPendingPassTransaction,
  findUserPassTransaction,
  getActiveEntitlement,
  getPassStatus,
  markResumePassClosed
} from "../../db/resume-studio-pass-repository.js";
import { PASS_IDS, RESUME_FREE_ADAPTATIONS, RESUME_PASSES, isPassId } from "../../resume-studio/payments/passes.js";
import { fetchWompiTransaction, integritySignature, readWompiKeys, WOMPI_TRANSACTION_ID, type FetchLike } from "../../resume-studio/payments/wompi.js";

// AI Resume Studio R4 — /api/resume/pass, /checkout, /checkout/confirm and
// /download/docx (ADR 0017 §5, doc 06 §7). Loaded lazily by resume.ts after
// the session and the write rate limit. Payments only exist with
// RESUME_STUDIO_PAYMENTS=true; PAYWALL_ENABLED and users.subscription_tier
// are never read or written here. Unlocking happens only in
// approveWompiTransaction (verified webhook or Wompi's own API answer).

type Json = (res: http.ServerResponse, status: number, body?: unknown, extra?: Record<string, string>) => void;

let fetchImpl: FetchLike = (url, init) => fetch(url, init);
export function setWompiFetchForTests(impl: FetchLike | null): void {
  fetchImpl = impl ?? ((url, init) => fetch(url, init));
}

export function resumePaymentsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.RESUME_STUDIO_PAYMENTS === "true";
}

const docxBody = z.object({ facts: resumeFactsSchema, templateId: z.enum(RESUME_TEMPLATE_IDS) }).strict();

const PAYMENTS_OFF = { error: "Los pagos de la hoja de vida aún no están disponibles.", code: "payments_off" };

export async function handleResumePass(
  res: http.ServerResponse,
  route: string,
  method: string,
  userId: string,
  readBody: () => Promise<{ ok: true; value: unknown } | null>,
  requireConsent: () => Promise<boolean>,
  json: Json
): Promise<void> {
  if (route === "/pass") {
    if (method !== "GET") return json(res, 405, { error: "Método no permitido" });
    return json(res, 200, {
      paymentsEnabled: resumePaymentsEnabled(),
      passes: PASS_IDS.map((id) => RESUME_PASSES[id]),
      freeAdaptations: RESUME_FREE_ADAPTATIONS,
      status: await getPassStatus(userId)
    });
  }

  if (route === "/checkout") {
    if (method !== "POST") return json(res, 405, { error: "Método no permitido" });
    if (!resumePaymentsEnabled()) return json(res, 404, PAYMENTS_OFF);
    const body = await readBody();
    if (!body) return;
    const passId = (body.value as { passId?: unknown } | null)?.passId;
    // Never a default pass: only the three exact ids map to an amount.
    if (!isPassId(passId)) return json(res, 400, { error: "Elige un pase válido." });
    if (!(await requireConsent())) return;
    const keys = readWompiKeys(process.env);
    if (!keys.ok) return json(res, 503, PAYMENTS_OFF);
    const { reference, amountInCents, currency } = await createPendingPassTransaction(userId, passId);
    return json(res, 200, {
      publicKey: keys.keys.publicKey,
      reference,
      amountInCents,
      currency,
      signatureIntegrity: integritySignature(reference, amountInCents, currency, keys.keys.integritySecret)
    });
  }

  if (route === "/checkout/confirm") {
    if (method !== "POST") return json(res, 405, { error: "Método no permitido" });
    if (!resumePaymentsEnabled()) return json(res, 404, PAYMENTS_OFF);
    const body = await readBody();
    if (!body) return;
    const id = (body.value as { transactionId?: unknown } | null)?.transactionId;
    if (typeof id !== "string" || !WOMPI_TRANSACTION_ID.test(id)) return json(res, 400, { error: "Transacción no válida." });
    const keys = readWompiKeys(process.env);
    if (!keys.ok) return json(res, 503, PAYMENTS_OFF);
    let tx;
    try {
      tx = await fetchWompiTransaction(id, keys.keys.publicKey, fetchImpl);
    } catch {
      tx = null;
    }
    if (!tx) return json(res, 502, { error: "No pudimos consultar el pago en Wompi. Intenta de nuevo en un momento.", code: "wompi_unavailable" });
    // Someone else's payment (or a subscription) looks like a missing one.
    const mine = await findUserPassTransaction(userId, tx.reference);
    if (!mine) return json(res, 404, { error: "Pago no encontrado." });
    if (tx.status === "APPROVED") {
      const result = await approveWompiTransaction({ reference: tx.reference, wompiTransactionId: tx.id, amountInCents: tx.amountInCents, currency: tx.currency });
      if (result.outcome === "amount_mismatch") {
        console.warn("[resume-pass] Monto en Wompi distinto del guardado — nada se desbloquea.");
        return json(res, 409, { status: "mismatch", error: "El monto del pago no coincide. Escríbenos para revisarlo.", code: "amount_mismatch" });
      }
      return json(res, 200, { status: "approved", pass: await getPassStatus(userId) });
    }
    if (tx.status === "DECLINED" || tx.status === "VOIDED" || tx.status === "ERROR") {
      await markResumePassClosed(tx.reference, tx.status);
      return json(res, 200, { status: "declined" });
    }
    return json(res, 200, { status: mine.status === "approved" ? "approved" : "pending" });
  }

  if (route === "/download/docx") {
    if (method !== "POST") return json(res, 405, { error: "Método no permitido" });
    const body = await readBody();
    if (!body) return;
    const parsed = docxBody.safeParse(body.value);
    if (!parsed.success) return json(res, 400, { error: "Revisa tu hoja de vida antes de descargarla." });
    if (!(await getActiveEntitlement(userId))) {
      return json(res, 402, { error: "La descarga en Word es parte del pase.", code: "pass_required" });
    }
    const { buildResumeDocx } = await import("../../resume-studio/docx.js");
    const file = buildResumeDocx(parsed.data.facts, parsed.data.templateId);
    res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": 'attachment; filename="hoja-de-vida-buscotrabajo.docx"',
      "Content-Length": String(file.length),
      "Cache-Control": "private, no-store"
    });
    res.end(file);
    return;
  }

  return json(res, 404, { error: "No encontrado" });
}
