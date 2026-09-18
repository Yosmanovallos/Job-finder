// Source-stated country names -> ISO 3166-1 alpha-2. Used ONLY to normalize a
// value a source actually published (JSON-LD applicantLocationRequirements,
// GetOnBoard `countries`). A name missing from this table is dropped, never
// guessed — and nothing here ever supplies a country the source didn't state
// (docs/JOBPOSTING-GOOGLE-CONTRACT.md, remote eligibility).

const COUNTRY_NAMES: Record<string, string> = {
  AR: "Argentina",
  BO: "Bolivia",
  BR: "Brasil",
  CA: "Canadá",
  CL: "Chile",
  CO: "Colombia",
  CR: "Costa Rica",
  CU: "Cuba",
  DO: "República Dominicana",
  EC: "Ecuador",
  ES: "España",
  GT: "Guatemala",
  HN: "Honduras",
  MX: "México",
  NI: "Nicaragua",
  PA: "Panamá",
  PE: "Perú",
  PR: "Puerto Rico",
  PY: "Paraguay",
  SV: "El Salvador",
  US: "Estados Unidos",
  UY: "Uruguay",
  VE: "Venezuela"
};

const ALIASES: Record<string, string> = {
  brazil: "BR",
  canada: "CA",
  mexico: "MX",
  panama: "PA",
  peru: "PE",
  spain: "ES",
  "dominican republic": "DO",
  "united states": "US",
  "united states of america": "US",
  usa: "US",
  "estados unidos": "US"
};

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const BY_FOLDED_NAME = new Map<string, string>([
  ...Object.entries(COUNTRY_NAMES).map(([code, name]) => [fold(name), code] as [string, string]),
  ...Object.entries(ALIASES)
]);

/** ISO-2 for a source-stated country value, or null when not a recognizable country. */
export function toCountryCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed) && COUNTRY_NAMES[trimmed.toUpperCase()]) return trimmed.toUpperCase();
  return BY_FOLDED_NAME.get(fold(trimmed)) ?? null;
}

/** Unique ISO-2 codes for every recognizable value; unrecognized ones are dropped. */
export function toCountryCodes(values: unknown[]): string[] {
  const codes = values.map(toCountryCode).filter((code): code is string => code !== null);
  return [...new Set(codes)];
}

export function countryNameFor(code: string): string | null {
  return COUNTRY_NAMES[code.toUpperCase()] ?? null;
}
