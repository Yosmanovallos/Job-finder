/**
 * Deterministic URL canonicalization (plan §11.2): lowercase host, drop known
 * tracking parameters, drop trailing slash, keep identifying parameters.
 */

const TRACKING_PARAMS = new Set([
  "ref",
  "source",
  "src",
  "oga",
  "gclid",
  "fbclid",
  "msclkid",
  "gh_src",
  "lever-origin",
  "lever-source",
  "lever-source%5b%5d"
]);

export function normalizeUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl.trim();
  }
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  const kept: [string, string][] = [];
  for (const [key, value] of url.searchParams.entries()) {
    const lower = key.toLowerCase();
    if (lower.startsWith("utm_") || TRACKING_PARAMS.has(lower)) {
      continue;
    }
    kept.push([key, value]);
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = "";
  for (const [key, value] of kept) {
    url.searchParams.append(key, value);
  }
  let text = url.toString();
  if (url.pathname !== "/" && url.pathname.endsWith("/") && !url.search) {
    text = text.replace(/\/$/, "");
  }
  return text;
}
