// Catches mistyped domains of the big webmail providers ("gmail.comv",
// "hotmial.com") before signup. A real signup on 2026-10-28 used
// "@gmail.comv": the confirmation email could never arrive, so the user
// hit "Email not confirmed" and then the resend rate limit. The result is
// only a suggestion shown to the user — never applied automatically.

const COMMON_DOMAINS = [
  "gmail.com",
  "hotmail.com",
  "hotmail.es",
  "outlook.com",
  "outlook.es",
  "yahoo.com",
  "yahoo.es",
  "icloud.com",
  "live.com"
];

// Real domains that sit one edit away from a common one ("mail.com" vs
// "gmail.com") and must never be "corrected".
const KNOWN_VALID_DOMAINS = new Set([
  ...COMMON_DOMAINS,
  "mail.com",
  "ymail.com",
  "email.com",
  "me.com",
  "msn.com",
  "aol.com",
  "gmx.com",
  "live.com.mx",
  "yahoo.com.co",
  "yahoo.com.mx",
  "hotmail.co.uk",
  "proton.me",
  "protonmail.com"
]);

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

export function suggestEmailCorrection(email: string): string | null {
  const at = email.trim().lastIndexOf("@");
  if (at < 1) return null;
  const local = email.trim().slice(0, at);
  const domain = email.trim().slice(at + 1).toLowerCase();
  if (!domain || KNOWN_VALID_DOMAINS.has(domain)) return null;

  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of COMMON_DOMAINS) {
    const distance = editDistance(domain, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  // Short domains allow one edit only: "ice.com" is two away from "live.com".
  const maxDistance = domain.length < 9 ? 1 : 2;
  return best && bestDistance <= maxDistance ? `${local}@${best}` : null;
}
