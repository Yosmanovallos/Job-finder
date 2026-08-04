// Hand-verified `jobs.company` (exact raw string) -> employer's own domain,
// for the small curated subset of companies BuscoTrabajo already trusts a
// real identity for: scripts/seed-merco-aliases.ts (Merco Talento) and
// scripts/seed-gptw-aliases.ts (Great Place to Work), see
// docs/COMPANY-REPUTATION-PLAN.md. This is NOT the same list/purpose as
// those aliases — it exists only to resolve a real employer logo, never to
// add reputation data — but it reuses their rigor: every domain below was
// individually confirmed against the company's own official site this
// session, the same "no fuzzy/guessed match" bar as the alias tables
// (regla 5 de AGENTS.md — prefer omitted over an unsupported inference).
//
// Deliberately partial: several companies from those two seed files are
// NOT here because their domain couldn't be confirmed with confidence in
// one search pass (e.g. small BPOs/regional firms with ambiguous or
// unverifiable web presence: DOXA Talent, NEXA BPO, Nextant, Compañía
// Mundial de Seguros, Fundación Amanecer, SII Group Colombia, Centro
// Comercial Santafé, Corredor Empresarial, Cámara de Comercio de
// Bucaramanga, Grupo Bios, Alianza Team). Omitting them just means those
// companies keep the plain-initial avatar — never guess a domain to fill
// the gap (see JobCard.tsx's avatar comment for why that risks attaching
// the wrong brand's logo to the wrong company).
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
  Compensar: "compensar.com",
  Google: "google.com",
  Alquería: "alqueria.com.co",
  Comfama: "comfama.com",
  "BANCO DE BOGOTA": "bancodebogota.com",
  "Banco de Bogotá": "bancodebogota.com",
  COLSUBSIDIO: "colsubsidio.com",
  "TERPEL ": "terpel.com",
  Protección: "proteccion.com",
  "HOSPITAL PABLO TOBÓN URIBE": "hptu.org.co",
  "Nu Colombia": "nu.com.co",
  BBVA: "bbva.com.co",
  "TECNOQUIMICAS S.A.S": "tecnoquimicas.com",
  "Claro Colombia": "claro.com.co",
  "CLARO COLOMBIA": "claro.com.co",
  "Fundación Valle del Lili": "valledellili.org",
  "Banco de Occidente": "bancodeoccidente.com.co",
  Falabella: "falabella.com.co",
  DAVIbank: "davibank.com",
  Rappi: "rappi.com",
  AMARILO: "amarilo.com.co",
  CAFAM: "cafam.com.co",
  "CONSTRUCTORA BOLIVAR S.A.": "constructorabolivar.com",
  "Constructora Bolívar S.A.": "constructorabolivar.com",
  "Grupo Vanti": "grupovanti.com",
  "Allianz Colombia": "allianz.co",
  IBM: "ibm.com",
  BELCORP: "belcorp.com",
  "Smurfit Westrock": "smurfitwestrock.com",
  Diageo: "diageo.com",
  PepsiCo: "pepsico.com",
  Amazon: "amazon.com",
  Cemex: "cemex.com",
  "Cine Colombia S.A.S": "cinecolombia.com",
  "Enel Colombia": "enel.com.co",
  "Fundacion Santa Fe de Bogota": "fsfb.org.co",
  "Fundación Santa Fe de Bogotá": "fsfb.org.co",
  "D1 S.A.S": "tiendasd1.com",
  "Clínica del Country": "clinicadelcountry.com",
  "FRISBY S.A": "frisby.com.co",
  Cencosud: "cencosud.com",
  Roche: "roche.com",
  "Mondelēz International": "mondelezinternational.com",
  adidas: "adidas.com",
  Netflix: "netflix.com",
  "L'Oréal": "loreal.com",
  "Cueros Vélez": "cuerosvelez.com",
  Oracle: "oracle.com",
  CONCONCRETO: "conconcreto.com",
  SAP: "sap.com",
  "Samsung Electronics": "samsung.com",
  Pfizer: "pfizer.com",
  "Holcim Colombia": "holcim.com.co",
  Skandia: "skandia.co",
  "Skandia Colombia": "skandia.co",
  Globant: "globant.com",
  Mastercard: "mastercard.com",
  "Casa Luker": "casaluker.com",
  "Clínica Imbanaco": "imbanaco.com",
  Quala: "quala.com.co",
  "Solla S.A.": "solla.com",
  "FARMATODO COLOMBIA S.A": "farmatodo.com.co",
  Accenture: "accenture.com",
  "Accenture Colombia": "accenture.com",
  "Accenture Ltda": "accenture.com",
  "Accenture LTDA": "accenture.com",
  Siemens: "siemens.com",
  "Grupo Coomeva": "grupocoomeva.com",
  Sanofi: "sanofi.com",
  Colmédica: "colmedica.com",
  "MARVAL S.A.": "marval.com.co",
  Deloitte: "deloitte.com",

  // scripts/seed-gptw-aliases.ts (Accenture/Deloitte/Compensar already above)
  TP: "tp.com",
  "GFT Technologies": "gft.com",
  Capgemini: "capgemini.com",
  "Siemens Healthineers": "siemens-healthineers.com",
  Salesforce: "salesforce.com",
  Cargill: "cargill.com",
  Intellias: "intellias.com",
  Cisco: "cisco.com",
  Cognizant: "cognizant.com",
  SACYR: "sacyr.com",
  Amadeus: "amadeus.com",
  "Banco Santander Colombia": "santander.com.co",
  "BANCO SANTANDER COLOMBIA SA": "santander.com.co",
  Equinix: "equinix.com",
  Galderma: "galderma.com",
  "Encora Inc.": "encora.com",
  TransUnion: "transunion.com",
  "Kuehne+Nagel": "kuehne-nagel.com"
};

// Google's favicon service: no auth, no cost, no stored copy on our side —
// deliberately NOT downloading/caching these into public/ (a stored copy of
// a third-party mark is the version of this that raises a trademark
// question; hotlinking the employer's own domain to fetch their own public
// favicon does not, see docs/COMPANY-REPUTATION-PLAN.md's logo reasoning).
// Callers MUST still render their existing initial-avatar as a fallback
// (onError / no-match) — never assume this URL resolves to a real image.
export function getCompanyLogoUrl(rawCompanyName: string | null | undefined): string | null {
  if (!rawCompanyName) return null;
  const domain = COMPANY_LOGO_DOMAINS[rawCompanyName];
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}
