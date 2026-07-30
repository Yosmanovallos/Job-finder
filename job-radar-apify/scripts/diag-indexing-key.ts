/**
 * TEMPORARY diagnostic — never prints key material, only structural facts
 * about GOOGLE_INDEXING_PRIVATE_KEY, to debug the
 * "error:1E08010C:DECODER routines::unsupported" failure without ever
 * exposing the secret. Delete once the formatting issue is found.
 */
import crypto from "crypto";

const raw = process.env.GOOGLE_INDEXING_PRIVATE_KEY;
const clientEmail = process.env.GOOGLE_INDEXING_CLIENT_EMAIL;

console.log("clientEmail set:", Boolean(clientEmail));
console.log(
  "clientEmail looks like an email:",
  /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clientEmail || "")
);

if (!raw) {
  console.log("GOOGLE_INDEXING_PRIVATE_KEY is NOT set.");
  process.exit(0);
}

console.log("raw length:", raw.length);
console.log("raw contains literal backslash-n (\\\\n):", raw.includes("\\n"));
console.log("raw contains real newline chars:", raw.includes("\n"));
console.log("raw starts with a quote char:", raw[0] === '"' || raw[0] === "'");
console.log(
  "raw ends with a quote char:",
  raw[raw.length - 1] === '"' || raw[raw.length - 1] === "'"
);
console.log("raw first char code:", raw.charCodeAt(0));

// Mirrors the exact stripping logic in google-indexing.ts's readCredentials()
const trimmed = raw.trim().replace(/^"(.*)"$/s, "$1");
const unescaped = trimmed.replace(/\\n/g, "\n");
console.log("unescaped length:", unescaped.length);
console.log(
  "unescaped starts with BEGIN marker:",
  /^-----BEGIN (RSA )?PRIVATE KEY-----/.test(unescaped.trim())
);
console.log(
  "unescaped ends with END marker:",
  /-----END (RSA )?PRIVATE KEY-----\s*$/.test(unescaped.trim())
);
console.log("unescaped line count:", unescaped.split("\n").length);

try {
  crypto.createPrivateKey(unescaped);
  console.log("✅ crypto.createPrivateKey() SUCCEEDED — the key parses fine on its own.");
} catch (err: any) {
  console.log("❌ crypto.createPrivateKey() FAILED:", err.code, "-", err.message);
}
