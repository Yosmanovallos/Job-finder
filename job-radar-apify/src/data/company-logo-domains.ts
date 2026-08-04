// Hand-verified `jobs.company` (exact raw string) -> employer's own domain,
// for the small curated subset of companies BuscoTrabajo already trusts a
// real identity for: scripts/seed-merco-aliases.ts (Merco Talento) and
// scripts/seed-gptw-aliases.ts (Great Place to Work), see
// docs/COMPANY-REPUTATION-PLAN.md. This is NOT the same list/purpose as
// those aliases — it exists only to resolve a real employer logo, never to
// add reputation data — but it reuses their rigor: every domain below was
// individually confirmed against the company's own official site, the same
// "no fuzzy/guessed match" bar as the alias tables (regla 5 de AGENTS.md —
// prefer omitted over an unsupported inference).
//
// Deliberately partial, for two independent reasons — both just leave a
// company on the plain-initial avatar, never a guess:
// 1. Domain itself couldn't be confirmed with confidence (small BPOs/
//    regional firms with ambiguous web presence: DOXA Talent, NEXA BPO,
//    Nextant, Compañía Mundial de Seguros, Fundación Amanecer, SII Group
//    Colombia, Centro Comercial Santafé, Corredor Empresarial, Cámara de
//    Comercio de Bucaramanga, Grupo Bios, Alianza Team).
// 2. Domain is confirmed real but has no favicon our logo source (see
//    getCompanyLogoUrl below) can resolve — verified by fetching every
//    entry's icon and diffing against DuckDuckGo's own generic-fallback
//    image (md5 ab1fb25b83d4b333ea661a84bd298b2e), which several confirmed
//    domains returned instead of a real icon: amarilo.com.co,
//    bancodebogota.com, bancodeoccidente.com.co, belcorp.com,
//    casaluker.com, clinicadelcountry.com, colmedica.com, compensar.com,
//    conconcreto.com, cuerosvelez.com, davibank.com, fsfb.org.co,
//    grupocoomeva.com, quala.com.co, sacyr.com, skandia.co, solla.com,
//    tecnoquimicas.com. Re-check with the same diff before ever re-adding
//    one of these — a generic fallback icon rendered as this company's
//    "logo" is worse than no logo (this is exactly what caused the
//    all-companies-blank bug this list once shipped with, see git log).
//
// Keys match `company_reputation_alias.raw_company_name` byte-for-byte,
// including its messy free-text quirks (trailing space on "TERPEL ",
// mixed case, legal suffixes) — this is looked up against the exact same
// `jobs.company` values, so it must never be normalized/trimmed here.
export const COMPANY_LOGO_DOMAINS: Record<string, string> = {
  // scripts/seed-merco-aliases.ts
  Bancolombia: "bancolombia.com",
  Alpina: "alpina.com",
  "Bavaria - Colombia": "bavaria.co",
  "Sura Colombia": "sura.co",
  "Mercado Libre": "mercadolibre.com.co",
  Nestlé: "nestle.com",
  avianca: "avianca.com",
  "COLOMBINA S.A.": "colombina.com",
  "Pontificia Universidad Javeriana": "javeriana.edu.co",
  Postobon: "postobon.com",
  "POSTOBON S.A": "postobon.com",
  "POSTOBON S.A.": "postobon.com",
  "Grupo Éxito": "grupoexito.com.co",
  Google: "google.com",
  Alquería: "alqueria.com.co",
  Comfama: "comfama.com",
  COLSUBSIDIO: "colsubsidio.com",
  "TERPEL ": "terpel.com",
  Protección: "proteccion.com",
  "HOSPITAL PABLO TOBÓN URIBE": "hptu.org.co",
  "Nu Colombia": "nu.com.co",
  BBVA: "bbva.com.co",
  "Claro Colombia": "claro.com.co",
  "CLARO COLOMBIA": "claro.com.co",
  "Fundación Valle del Lili": "valledellili.org",
  Falabella: "falabella.com.co",
  Rappi: "rappi.com",
  CAFAM: "cafam.com.co",
  "CONSTRUCTORA BOLIVAR S.A.": "constructorabolivar.com",
  "Constructora Bolívar S.A.": "constructorabolivar.com",
  "Grupo Vanti": "grupovanti.com",
  "Allianz Colombia": "allianz.co",
  IBM: "ibm.com",
  "Smurfit Westrock": "smurfitwestrock.com",
  Diageo: "diageo.com",
  PepsiCo: "pepsico.com",
  Amazon: "amazon.com",
  Cemex: "cemex.com",
  "Cine Colombia S.A.S": "cinecolombia.com",
  "Enel Colombia": "enel.com.co",
  "D1 S.A.S": "tiendasd1.com",
  "FRISBY S.A": "frisby.com.co",
  Cencosud: "cencosud.com",
  Roche: "roche.com",
  "Mondelēz International": "mondelezinternational.com",
  adidas: "adidas.com",
  Netflix: "netflix.com",
  "L'Oréal": "loreal.com",
  Oracle: "oracle.com",
  SAP: "sap.com",
  "Samsung Electronics": "samsung.com",
  Pfizer: "pfizer.com",
  "Holcim Colombia": "holcim.com.co",
  Globant: "globant.com",
  Mastercard: "mastercard.com",
  "Clínica Imbanaco": "imbanaco.com",
  "FARMATODO COLOMBIA S.A": "farmatodo.com.co",
  Accenture: "accenture.com",
  "Accenture Colombia": "accenture.com",
  "Accenture Ltda": "accenture.com",
  "Accenture LTDA": "accenture.com",
  Siemens: "siemens.com",
  Sanofi: "sanofi.com",
  "MARVAL S.A.": "marval.com.co",
  Deloitte: "deloitte.com",

  // scripts/seed-gptw-aliases.ts (Accenture/Deloitte already above)
  TP: "tp.com",
  "GFT Technologies": "gft.com",
  Capgemini: "capgemini.com",
  "Siemens Healthineers": "siemens-healthineers.com",
  Salesforce: "salesforce.com",
  Cargill: "cargill.com",
  Intellias: "intellias.com",
  Cisco: "cisco.com",
  Cognizant: "cognizant.com",
  Amadeus: "amadeus.com",
  "Banco Santander Colombia": "santander.com.co",
  "BANCO SANTANDER COLOMBIA SA": "santander.com.co",
  Equinix: "equinix.com",
  Galderma: "galderma.com",
  "Encora Inc.": "encora.com",
  TransUnion: "transunion.com",
  "Kuehne+Nagel": "kuehne-nagel.com"
};

// DuckDuckGo's icon service — a single direct hop (no redirect chain), no
// auth, no cost, no stored copy on our side. Switched from Google's
// `s2/favicons` (used at first) after it turned out to 301-redirect to a
// sharded `t0-t3.gstatic.com` host that was unreliable under this page's
// concurrent-logo-grid load AND silently serves a generic placeholder
// instead of failing for domains it has no icon for — both produced
// blank-looking cards with no error the client could react to. Deliberately
// NOT downloading/caching these into public/ (a stored copy of a
// third-party mark is the version of this that raises a trademark
// question; hotlinking the employer's own domain to fetch their own public
// favicon does not, see docs/COMPANY-REPUTATION-PLAN.md's logo reasoning).
// Callers MUST still render their existing initial-avatar as a fallback
// (onError / no-match) — this only guarantees a request for a domain KNOWN
// to have a real icon as of this file's last verification, not a live
// guarantee.
export function getCompanyLogoUrl(rawCompanyName: string | null | undefined): string | null {
  if (!rawCompanyName) return null;
  const domain = COMPANY_LOGO_DOMAINS[rawCompanyName];
  if (!domain) return null;
  return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;
}
