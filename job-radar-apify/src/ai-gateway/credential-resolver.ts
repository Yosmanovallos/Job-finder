import type { Pool } from "pg";
import { decryptCredential, encryptCredential, last4Of } from "./credential-crypto.js";
import type { ProviderId } from "./types.js";

/**
 * Fase 5 de docs/RESUME-STUDIO-PLAN.md (§3.2) — el ÚNICO lugar del
 * proyecto que descifra una credencial BYOK (además de `credential-
 * crypto.ts` mismo, que hace el trabajo criptográfico real pero no toca
 * Postgres). `ModelGateway` nunca importa esto directamente — quien arma
 * un `RunContext` con `apiKey` (un route handler, más adelante en el
 * pipeline) es quien llama `resolve()` primero y pasa el resultado ya
 * descifrado.
 */

export interface ResolvedCredential {
  apiKey: string;
  source: "user_byok" | "operator_fallback";
}

interface CredentialRow {
  ciphertext: Buffer;
  iv: Buffer;
  auth_tag: Buffer;
}

export class CredentialResolver {
  constructor(private readonly pool: Pool) {}

  /**
   * Prioridad: (1) la key propia del usuario para ese proveedor, si la
   * conectó; (2) para `"google"` específicamente, `GEMINI_API_KEY` como
   * fallback del operador (§12 punto 9 de CV-GENERATION-PLAN.md, el único
   * proveedor con cuenta operador-financiada real hoy — nunca se inventa
   * un fallback para un proveedor que no lo tiene); (3) `null` si ninguna
   * de las dos existe — el caller decide si eso es un 402/409 o qué.
   */
  async resolve(userId: string, providerId: ProviderId): Promise<ResolvedCredential | null> {
    const { rows } = await this.pool.query<CredentialRow>(
      `SELECT ciphertext, iv, auth_tag FROM user_ai_credentials WHERE user_id = $1 AND provider_id = $2`,
      [userId, providerId]
    );
    const row = rows[0];
    if (row) {
      const apiKey = decryptCredential({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, userId, providerId);
      return { apiKey, source: "user_byok" };
    }
    if (providerId === "google" && process.env.GEMINI_API_KEY) {
      return { apiKey: process.env.GEMINI_API_KEY, source: "operator_fallback" };
    }
    return null;
  }

  /** Cifra y guarda/reemplaza la credencial de un usuario para un
   * proveedor — `UPSERT` sobre `UNIQUE (user_id, provider_id)`, así que
   * reconectar el mismo proveedor reemplaza la key anterior en vez de
   * acumular filas. Devuelve `last4` para que el caller pueda responder
   * sin volver a tocar el texto plano. */
  async save(userId: string, providerId: ProviderId, apiKey: string, label?: string): Promise<{ last4: string }> {
    const encrypted = encryptCredential(apiKey, userId, providerId);
    const last4 = last4Of(apiKey);
    await this.pool.query(
      `INSERT INTO user_ai_credentials (user_id, provider_id, label, last4, ciphertext, iv, auth_tag, validated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (user_id, provider_id) DO UPDATE SET
         label = EXCLUDED.label,
         last4 = EXCLUDED.last4,
         ciphertext = EXCLUDED.ciphertext,
         iv = EXCLUDED.iv,
         auth_tag = EXCLUDED.auth_tag,
         validated_at = NOW(),
         updated_at = NOW()`,
      [userId, providerId, label ?? null, last4, encrypted.ciphertext, encrypted.iv, encrypted.authTag]
    );
    return { last4 };
  }

  async remove(userId: string, providerId: ProviderId): Promise<boolean> {
    const result = await this.pool.query(`DELETE FROM user_ai_credentials WHERE user_id = $1 AND provider_id = $2`, [
      userId,
      providerId
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  /** Para `GET /api/ai/providers` (§9.5-equivalente de esta fase) — nunca
   * expone `ciphertext`/`iv`/`auth_tag`, solo lo que el plan aprobado
   * autoriza mostrar (§3.1, `ProviderConnectionStatus`). */
  async listConnected(userId: string): Promise<Map<ProviderId, { label: string | null; last4: string; validatedAt: string | null }>> {
    const { rows } = await this.pool.query<{ provider_id: string; label: string | null; last4: string; validated_at: string | null }>(
      `SELECT provider_id, label, last4, validated_at FROM user_ai_credentials WHERE user_id = $1`,
      [userId]
    );
    const byProvider = new Map<ProviderId, { label: string | null; last4: string; validatedAt: string | null }>();
    for (const row of rows) {
      byProvider.set(row.provider_id, { label: row.label, last4: row.last4, validatedAt: row.validated_at });
    }
    return byProvider;
  }
}
