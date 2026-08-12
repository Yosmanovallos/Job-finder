// Fase 3 de docs/RESUME-STUDIO-PLAN.md — prueba el módulo de cifrado en
// aislamiento total: pura computación (`node:crypto`), sin Postgres, sin
// red. Genera su propia `BYOK_ENCRYPTION_KEY` temporal en memoria antes de
// importar nada del módulo bajo prueba — nunca toca ni depende del
// `.env` real (esa key de producción todavía no existe ahí; cuando exista,
// este test seguirá funcionando igual, la suya es efímera y propia).
import crypto from "node:crypto";

process.env.BYOK_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");

const {
  encryptCredential,
  decryptCredential,
  last4Of,
  MissingEncryptionKeyError,
  InvalidEncryptionKeyError
} = await import("../src/ai-gateway/credential-crypto.js");

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) {
    console.log(`✅ [PASSED] ${label}`);
  } else {
    console.error(`❌ [FAILED] ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};

function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN — Cifrado de credenciales BYOK (src/ai-gateway/credential-crypto.ts, sin red/DB)`);
  console.log(`==================================================\n`);

  const PLAINTEXT = "sk-real-looking-fake-api-key-1234567890abcdef";
  const USER_A = "user-aaa";
  const USER_B = "user-bbb";
  const PROVIDER_GOOGLE = "google";
  const PROVIDER_ANTHROPIC = "anthropic";

  console.log(`🔍 [Test 1] Round-trip cifrar → descifrar devuelve el texto original...`);
  {
    const enc = encryptCredential(PLAINTEXT, USER_A, PROVIDER_GOOGLE);
    const dec = decryptCredential(enc, USER_A, PROVIDER_GOOGLE);
    check("El texto descifrado es idéntico al original", dec === PLAINTEXT, dec);
    check("ciphertext/iv/authTag son Buffers reales, no strings", Buffer.isBuffer(enc.ciphertext) && Buffer.isBuffer(enc.iv) && Buffer.isBuffer(enc.authTag));
    check("El IV mide 12 bytes (AES-GCM estándar)", enc.iv.length === 12, `iv.length=${enc.iv.length}`);
    check("El ciphertext NUNCA contiene el texto plano en claro", !enc.ciphertext.toString("utf8").includes(PLAINTEXT));
  }

  console.log(`\n🔍 [Test 2] Cada cifrado usa un IV distinto — nunca reusado...`);
  {
    const enc1 = encryptCredential(PLAINTEXT, USER_A, PROVIDER_GOOGLE);
    const enc2 = encryptCredential(PLAINTEXT, USER_A, PROVIDER_GOOGLE);
    check("Dos cifrados del MISMO texto producen IVs distintos", !enc1.iv.equals(enc2.iv));
    check("Dos cifrados del MISMO texto producen ciphertexts distintos", !enc1.ciphertext.equals(enc2.ciphertext));
    // Ambos deben seguir descifrando correctamente pese a ser distintos.
    check("enc1 descifra bien", decryptCredential(enc1, USER_A, PROVIDER_GOOGLE) === PLAINTEXT);
    check("enc2 descifra bien", decryptCredential(enc2, USER_A, PROVIDER_GOOGLE) === PLAINTEXT);
  }

  console.log(`\n🔍 [Test 3] AAD incorrecto (userId o providerId distinto al usado para cifrar) falla — nunca descifra "casi bien"...`);
  {
    const enc = encryptCredential(PLAINTEXT, USER_A, PROVIDER_GOOGLE);

    let thrownWrongUser: unknown;
    try {
      decryptCredential(enc, USER_B, PROVIDER_GOOGLE);
    } catch (e) {
      thrownWrongUser = e;
    }
    check("userId incorrecto lanza (nunca descifra silenciosamente)", thrownWrongUser instanceof Error, String(thrownWrongUser));

    let thrownWrongProvider: unknown;
    try {
      decryptCredential(enc, USER_A, PROVIDER_ANTHROPIC);
    } catch (e) {
      thrownWrongProvider = e;
    }
    check(
      "providerId incorrecto lanza (una fila de A-google no descifra como A-anthropic)",
      thrownWrongProvider instanceof Error,
      String(thrownWrongProvider)
    );
  }

  console.log(`\n🔍 [Test 4] Ciphertext o auth_tag manipulados fallan (integridad de GCM, no solo confidencialidad)...`);
  {
    const enc = encryptCredential(PLAINTEXT, USER_A, PROVIDER_GOOGLE);

    const tamperedCiphertext = Buffer.from(enc.ciphertext);
    tamperedCiphertext[0] = tamperedCiphertext[0]! ^ 0xff; // flip un byte
    let thrownTamperedCipher: unknown;
    try {
      decryptCredential({ ...enc, ciphertext: tamperedCiphertext }, USER_A, PROVIDER_GOOGLE);
    } catch (e) {
      thrownTamperedCipher = e;
    }
    check("Ciphertext alterado un solo byte lanza (no produce texto basura silenciosamente)", thrownTamperedCipher instanceof Error);

    const tamperedTag = Buffer.from(enc.authTag);
    tamperedTag[0] = tamperedTag[0]! ^ 0xff;
    let thrownTamperedTag: unknown;
    try {
      decryptCredential({ ...enc, authTag: tamperedTag }, USER_A, PROVIDER_GOOGLE);
    } catch (e) {
      thrownTamperedTag = e;
    }
    check("auth_tag alterado lanza", thrownTamperedTag instanceof Error);
  }

  console.log(`\n🔍 [Test 5] Falla rápido y explícito ante configuración inválida de BYOK_ENCRYPTION_KEY...`);
  {
    const realKey = process.env.BYOK_ENCRYPTION_KEY;
    try {
      delete process.env.BYOK_ENCRYPTION_KEY;
      let thrownMissing: unknown;
      try {
        encryptCredential(PLAINTEXT, USER_A, PROVIDER_GOOGLE);
      } catch (e) {
        thrownMissing = e;
      }
      check("Sin BYOK_ENCRYPTION_KEY, lanza MissingEncryptionKeyError", thrownMissing instanceof MissingEncryptionKeyError, String(thrownMissing));

      process.env.BYOK_ENCRYPTION_KEY = Buffer.from("demasiado-corta").toString("base64");
      let thrownInvalid: unknown;
      try {
        encryptCredential(PLAINTEXT, USER_A, PROVIDER_GOOGLE);
      } catch (e) {
        thrownInvalid = e;
      }
      check(
        "Con una key de largo incorrecto (no 32 bytes), lanza InvalidEncryptionKeyError",
        thrownInvalid instanceof InvalidEncryptionKeyError,
        String(thrownInvalid)
      );
    } finally {
      process.env.BYOK_ENCRYPTION_KEY = realKey;
    }
  }

  console.log(`\n🔍 [Test 6] last4Of() nunca expone más de los últimos 4 caracteres...`);
  {
    check('last4Of("sk-real-looking-fake-api-key-1234567890abcdef") === "cdef"', last4Of(PLAINTEXT) === "cdef", last4Of(PLAINTEXT));
    check('last4Of("abc") con texto más corto que 4 devuelve el texto completo', last4Of("abc") === "abc");
  }

  if (failed > 0) {
    console.error(`\n❌ [TEST SUITE FAILED] ${failed} caso(s) fallaron.`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] Cifrado de credenciales BYOK verificado (AES-256-GCM, AAD, integridad, manejo de errores).`);
  console.log(`==================================================\n`);
  process.exit(0);
}

main();
