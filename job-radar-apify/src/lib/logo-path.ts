// Same-origin path for a curated logo domain. The server route
// (src/server/routes/logo-proxy.ts) only answers for domains listed in
// company-logo-domains.ts or source-logos.ts; anything else is a 404.
export function logoPathFor(domain: string): string {
  return `/logo/${encodeURIComponent(domain)}.ico`;
}
