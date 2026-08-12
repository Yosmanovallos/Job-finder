import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Fase 3 de docs/RESUME-STUDIO-PLAN.md (plan aprobado 2026-08-09, §3.2) —
 * cifrado/descifrado de credenciales BYOK (API keys de terceros que un
 * usuario conecta). Módulo inerte en esta fase: nada en el server real lo
 * importa todavía (eso llega en Fase 5, `credential-resolver.ts`). Solo
 * este archivo debe llamar a `createCipheriv`/`createDecipheriv` para
 * credenciales de usuario en todo el proyecto — cualquier otro lugar que
 * necesite descifrar una key debe pasar por aquí, nunca reimplementar esto.
 *
 * `node:crypto`, AES-256-GCM — cero dependencia nueva (Node ≥20 ya lo trae,
 * confirmado en la auditoría del plan aprobado: cero cifrado de dos vías
 * existía en todo el proyecto antes de esta fase).
 *
 * Decisiones de diseño (del plan aprobado, §3.2):
 * - IV aleatorio de 12 bytes por operación, nunca reusado.
 * - AAD = `${userId}:${providerId}` atado al tag GCM — una fila de
 *   ciphertext copiada a otro `user_id`/`provider_id` (por accidente o a
 *   propósito) falla al descifrar, no produce texto basura silenciosamente.
 * - `BYOK_ENCRYPTION_KEY` (32 bytes, base64) es la única master key hoy —
 *   `key_version` ya existe en el schema (Fase 3, `user_ai_credentials`)
 *   para cuando haga falta rotar, pero este módulo no implementa
 *   multi-key-version todavía porque no hay una segunda key que resolver
 *   contra qué versión — se agrega el día que exista una razón real
 *   (regla del proyecto: no diseñar para un requisito hipotético).
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const KEY_LENGTH_BYTES = 32;

export interface EncryptedCredential {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super("Falta BYOK_ENCRYPTION_KEY en el entorno — requerida para cifrar/descifrar credenciales BYOK.");
    this.name = "MissingEncryptionKeyError";
  }
}

export class InvalidEncryptionKeyError extends Error {
  constructor(actualLength: number) {
    super(
      `BYOK_ENCRYPTION_KEY debe decodificar (base64) a exactamente ${KEY_LENGTH_BYTES} bytes (AES-256) — decodificó a ${actualLength}. ` +
        `Generar una nueva: node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`
    );
    this.name = "InvalidEncryptionKeyError";
  }
}

/** Falla rápido y explícito ante una key ausente o con el largo
 * equivocado — nunca cifra/descifra silenciosamente con una key inválida.
 * Sin caché a propósito: `BYOK_ENCRYPTION_KEY` no cambia durante la vida
 * de un proceso, pero recalcularlo en cada llamada mantiene este módulo
 * sin estado global mutable, más fácil de testear en aislamiento. */
function loadMasterKey(): Buffer {
  const raw = process.env.BYOK_ENCRYPTION_KEY;
  if (!raw) {
    throw new MissingEncryptionKeyError();
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new InvalidEncryptionKeyError(key.length);
  }
  return key;
}

function buildAad(userId: string, providerId: string): Buffer {
  return Buffer.from(`${userId}:${providerId}`, "utf8");
}

/** Cifra `plaintext` (la API key en texto plano) atada a `userId`+`providerId`
 * vía AAD — el resultado solo descifra correctamente contra ESE par exacto. */
export function encryptCredential(plaintext: string, userId: string, providerId: string): EncryptedCredential {
  const key = loadMasterKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(buildAad(userId, providerId));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

/** Descifra — lanza si el AAD (userId/providerId) no coincide EXACTO con el
 * usado al cifrar, o si el auth_tag no valida (ciphertext alterado/
 * corrupto). Nunca devuelve texto parcial ni "probablemente correcto". */
export function decryptCredential(encrypted: EncryptedCredential, userId: string, providerId: string): string {
  const key = loadMasterKey();
  const decipher = createDecipheriv(ALGORITHM, key, encrypted.iv);
  decipher.setAAD(buildAad(userId, providerId));
  decipher.setAuthTag(encrypted.authTag);
  const plaintext = Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

/** Últimos 4 caracteres de la key en texto plano — lo único que se le
 * muestra al usuario después de guardarla (§3.2 del plan aprobado: "nunca
 * se re-muestra la key completa"). No es una operación criptográfica, solo
 * un helper para no reimplementar el slice en cada caller. */
export function last4Of(plaintext: string): string {
  return plaintext.slice(-4);
}
