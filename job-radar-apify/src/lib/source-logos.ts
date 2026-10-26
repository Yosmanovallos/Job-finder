// Job-portal name (exactly as SOURCES_BY_COUNTRY lists it) -> the portal's
// own public domain, used only to show its favicon in the landing's
// "portales" marquee. Same rule as company-logo-domains.ts: hotlinked from
// DuckDuckGo's icon service, never a stored copy in public/, and the
// caller always keeps a colored-initial fallback (onError) — a few portals
// only publish a 16px favicon, which looks soft at this size.
const SOURCE_LOGO_DOMAINS: Record<string, string> = {
  "LinkedIn Jobs": "linkedin.com",
  Computrabajo: "computrabajo.com",
  Elempleo: "elempleo.com",
  Magneto: "magneto365.com",
  Torre: "torre.ai",
  GetOnBoard: "getonbrd.com",
  RemoteOK: "remoteok.com",
  Remotive: "remotive.com",
  Workana: "workana.com",
  WeRemoto: "weremoto.com"
};

export function getSourceLogoUrl(source: string): string | null {
  const domain = SOURCE_LOGO_DOMAINS[source];
  return domain ? `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico` : null;
}
