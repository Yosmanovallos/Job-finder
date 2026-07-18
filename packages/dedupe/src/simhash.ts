import { createHash } from "node:crypto";

/**
 * Deterministic 64-bit SimHash over description tokens. Near-duplicate layer
 * only — always guarded by company/title/location equality (review B2).
 */

export const SIMHASH_HAMMING_THRESHOLD = 6;
/** Below this many tokens, 64-bit simhash collides too easily — skip layer 5. */
export const SIMHASH_MIN_TOKENS = 50;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1);
}

function tokenHash64(token: string): bigint {
  const digest = createHash("sha256").update(token, "utf8").digest();
  return digest.readBigUInt64BE(0);
}

/** Returns null when the text is too short for a meaningful simhash. */
export function simhash64(text: string): bigint | null {
  const tokens = tokenize(text);
  if (tokens.length < SIMHASH_MIN_TOKENS) {
    return null;
  }
  const weights = new Array<number>(64).fill(0);
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  for (const [token, count] of counts) {
    const hash = tokenHash64(token);
    for (let bit = 0; bit < 64; bit += 1) {
      const isSet = (hash >> BigInt(bit)) & 1n;
      weights[bit]! += isSet === 1n ? count : -count;
    }
  }
  let result = 0n;
  for (let bit = 0; bit < 64; bit += 1) {
    if (weights[bit]! > 0) {
      result |= 1n << BigInt(bit);
    }
  }
  return result;
}

export function hammingDistance64(a: bigint, b: bigint): number {
  let x = (a ^ b) & 0xffffffffffffffffn;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** Postgres bigint is signed; store the unsigned hash reinterpreted. */
export function toSignedBigint(value: bigint): bigint {
  return BigInt.asIntN(64, value);
}

export function fromSignedBigint(value: bigint): bigint {
  return BigInt.asUintN(64, value);
}
