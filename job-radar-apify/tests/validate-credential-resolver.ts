// Fase 5 de docs/RESUME-STUDIO-PLAN.md — CredentialResolver contra
// Postgres real, con usuarios reales (la FK de user_ai_credentials.user_id
// lo exige). BYOK_ENCRYPTION_KEY efímera en memoria, igual que Fase 3
// (tests/validate-credential-crypto.ts) — nunca depende del .env real.
import crypto from "node:crypto";
import dotenv from "dotenv";
dotenv.config();

process.env.BYOK_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

const { pool } = await import("../src/db/client.js");
const { getOrCreateUser } = await import("../src/db/job-repository.js");
const { CredentialResolver } = await import("../src/ai-gateway/credential-resolver.js");

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) {
    console.log(`✅ [PASSED] ${label}`);
  } else {
    console.error(`❌ [FAILED] ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};

async function makeUser(label: string): Promise<string> {
  const id = crypto.randomUUID();
  await getOrCreateUser(id, `cred-resolver-${label}-${Date.now()}@example-test.com`);
  return id;
}

async function cleanup(userIds: string[]) {
  await pool.query(`DELETE FROM user_ai_credentials WHERE user_id = ANY($1)`, [userIds]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [userIds]);
}

async function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN — CredentialResolver (Fase 5, Postgres real)`);
  console.log(`==================================================\n`);

  const userIds: string[] = [];
  const resolver = new CredentialResolver(pool);

  try {
    console.log(`🔍 [Test 1] Sin credencial guardada y sin fallback del operador (proveedor no-google) → null...`);
    {
      const userId = await makeUser("no-cred");
      userIds.push(userId);
      const resolved = await resolver.resolve(userId, "anthropic");
      check("resolve() devuelve null (nada que resolver)", resolved === null, JSON.stringify(resolved));
    }

    console.log(`\n🔍 [Test 2] save() → resolve() round-trip real contra Postgres...`);
    {
      const userId = await makeUser("round-trip");
      userIds.push(userId);
      const { last4 } = await resolver.save(userId, "anthropic", "sk-ant-fake-1234567890abcd", "Mi cuenta personal");
      check('last4 son los últimos 4 caracteres reales ("abcd")', last4 === "abcd");

      const resolved = await resolver.resolve(userId, "anthropic");
      check("resolve() encuentra la credencial guardada", resolved !== null);
      check('source = "user_byok"', resolved?.source === "user_byok");
      check("La apiKey descifrada es idéntica a la guardada", resolved?.apiKey === "sk-ant-fake-1234567890abcd", resolved?.apiKey);
    }

    console.log(`\n🔍 [Test 3] Reconectar el MISMO proveedor reemplaza la key anterior (UPSERT), no acumula filas...`);
    {
      const userId = await makeUser("upsert");
      userIds.push(userId);
      await resolver.save(userId, "openai", "sk-primera-key-aaaa");
      await resolver.save(userId, "openai", "sk-segunda-key-bbbb");

      const { rows } = await pool.query(`SELECT COUNT(*) FROM user_ai_credentials WHERE user_id = $1 AND provider_id = $2`, [userId, "openai"]);
      check("Sigue habiendo exactamente 1 fila (no 2)", Number(rows[0].count) === 1, rows[0].count);

      const resolved = await resolver.resolve(userId, "openai");
      check("resolve() devuelve la SEGUNDA key, no la primera", resolved?.apiKey === "sk-segunda-key-bbbb", resolved?.apiKey);
    }

    console.log(`\n🔍 [Test 4] remove() borra la fila — resolve() posterior vuelve a null (o cae al fallback si aplica)...`);
    {
      const userId = await makeUser("remove");
      userIds.push(userId);
      await resolver.save(userId, "anthropic", "sk-a-borrar");
      const removed = await resolver.remove(userId, "anthropic");
      check("remove() devuelve true (sí había algo que borrar)", removed === true);

      const removedAgain = await resolver.remove(userId, "anthropic");
      check("remove() de nuevo (ya no hay nada) devuelve false", removedAgain === false);

      const resolved = await resolver.resolve(userId, "anthropic");
      check("resolve() tras remove() vuelve a null (anthropic no tiene fallback de operador)", resolved === null);
    }

    console.log(`\n🔍 [Test 5] listConnected() nunca expone ciphertext/iv/auth_tag, solo metadata segura...`);
    {
      const userId = await makeUser("list-connected");
      userIds.push(userId);
      await resolver.save(userId, "google", "sk-google-fake-9999", "Cuenta laboral");
      await resolver.save(userId, "anthropic", "sk-anthropic-fake-8888");

      const connected = await resolver.listConnected(userId);
      check("2 proveedores conectados", connected.size === 2, `size=${connected.size}`);
      check("google trae el label guardado", connected.get("google")?.label === "Cuenta laboral");
      check("google trae last4 correcto", connected.get("google")?.last4 === "9999");
      check("anthropic sin label (nunca se pasó) queda null, no undefined ni string vacío", connected.get("anthropic")?.label === null);
      // TypeScript ya impide que el Map exponga ciphertext/iv/auth_tag (el
      // tipo de retorno de listConnected() no los declara) — esta
      // aserción confirma que el objeto real en runtime tampoco los trae,
      // no solo que el tipo los esconde.
      const rawValue = connected.get("google") as unknown as Record<string, unknown>;
      check("El objeto real en runtime NO trae ciphertext/iv/auth_tag", !("ciphertext" in rawValue) && !("iv" in rawValue) && !("auth_tag" in rawValue));
    }

    console.log(`\n🔍 [Test 6] Fallback del operador: SOLO "google" cae a GEMINI_API_KEY si no hay credencial propia...`);
    {
      const userId = await makeUser("fallback");
      userIds.push(userId);
      const hasRealGeminiKey = !!process.env.GEMINI_API_KEY;
      const resolvedGoogle = await resolver.resolve(userId, "google");
      if (hasRealGeminiKey) {
        check('Sin credencial propia, "google" cae al fallback del operador (GEMINI_API_KEY real está seteada)', resolvedGoogle?.source === "operator_fallback");
        check("La apiKey del fallback es la GEMINI_API_KEY real del entorno", resolvedGoogle?.apiKey === process.env.GEMINI_API_KEY);
      } else {
        check("Sin GEMINI_API_KEY en este entorno, google también devuelve null (honesto, no inventa un fallback)", resolvedGoogle === null);
      }

      const resolvedOther = await resolver.resolve(userId, "openrouter");
      check('"openrouter" NUNCA cae a un fallback de operador (no existe cuenta operador-financiada para ese proveedor)', resolvedOther === null);
    }
  } finally {
    await cleanup(userIds);
    await pool.end();
  }

  if (failed > 0) {
    console.error(`\n❌ [TEST SUITE FAILED] ${failed} caso(s) fallaron.`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] CredentialResolver verificado contra Postgres real.`);
  console.log(`==================================================\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ [FAILED] Error inesperado en la suite:", err);
  process.exit(1);
});
