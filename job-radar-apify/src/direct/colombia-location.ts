import type { Workplace } from "./types.js";

/**
 * Colombia filter for official postings (ADR 0006 §4). A posting is
 * Colombian only when the ATS says so explicitly — a structured country
 * field first, then the location text. "LATAM", "Americas" or worldwide
 * remote never count: those postings may not hire in Colombia at all.
 */

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// City key (folded) -> display name. Only names that, on their own, mean a
// Colombian city in a job location. "cali" is matched as a whole word, so
// "California" never matches.
const UNAMBIGUOUS_CITIES: Record<string, string> = {
  bogota: "Bogotá",
  medellin: "Medellín",
  cali: "Cali",
  barranquilla: "Barranquilla",
  bucaramanga: "Bucaramanga",
  cucuta: "Cúcuta",
  ibague: "Ibagué",
  manizales: "Manizales",
  pereira: "Pereira",
  villavicencio: "Villavicencio",
  valledupar: "Valledupar",
  monteria: "Montería",
  popayan: "Popayán",
  neiva: "Neiva",
  tunja: "Tunja",
  sincelejo: "Sincelejo",
  riohacha: "Riohacha",
  yopal: "Yopal",
  envigado: "Envigado",
  itagui: "Itagüí",
  sabaneta: "Sabaneta",
  soacha: "Soacha",
  floridablanca: "Floridablanca",
  barrancabermeja: "Barrancabermeja",
  zipaquira: "Zipaquirá",
  "santa marta": "Santa Marta"
};

// Names shared with places outside Colombia (Armenia, Cartagena in Spain,
// Palmira in Syria, Río Negro in Argentina…): a city only when the same
// segment also says Colombia.
const AMBIGUOUS_CITIES: Record<string, string> = {
  cartagena: "Cartagena",
  armenia: "Armenia",
  palmira: "Palmira",
  rionegro: "Rionegro",
  pasto: "Pasto",
  bello: "Bello",
  chia: "Chía",
  funza: "Funza",
  mosquera: "Mosquera",
  cota: "Cota",
  zarzal: "Zarzal",
  tocancipa: "Tocancipá"
};

function wordRegex(key: string): RegExp {
  return new RegExp(`(^|[^a-z0-9])${key.replace(/ /g, "\\s+")}($|[^a-z0-9])`);
}
const UNAMBIGUOUS = Object.entries(UNAMBIGUOUS_CITIES).map(([key, name]) => ({ re: wordRegex(key), name }));
const AMBIGUOUS = Object.entries(AMBIGUOUS_CITIES).map(([key, name]) => ({ re: wordRegex(key), name }));
const COLOMBIA = wordRegex("colombia");

/**
 * Splits a multi-location string ("Remote - Brazil; Remote - Colombia") and
 * drops repeats (Greenhouse often lists the office with the same name as
 * the location).
 */
function segments(texts: string[]): string[] {
  const seen = new Map<string, string>();
  for (const part of texts.flatMap((text) => text.split(/[;|\n]| \/ /))) {
    const trimmed = part.trim();
    if (trimmed && !seen.has(fold(trimmed))) seen.set(fold(trimmed), trimmed);
  }
  return [...seen.values()];
}

function cityIn(folded: string, saysColombia: boolean): string | null {
  for (const city of UNAMBIGUOUS) if (city.re.test(folded)) return city.name;
  if (saysColombia) for (const city of AMBIGUOUS) if (city.re.test(folded)) return city.name;
  return null;
}

export interface ColombiaMatch {
  /** The location segment(s) that placed the posting in Colombia. */
  locationRaw: string;
  city: string | null;
}

/**
 * Null when the posting is not explicitly in Colombia. A structured country
 * list that names other countries only wins over the text: "Remote - US"
 * with country "US" is out even if a city name happens to match.
 */
export function matchColombia(input: {
  locationTexts: string[];
  countryCodes: string[];
  structuredCity: string | null;
}): ColombiaMatch | null {
  const codes = input.countryCodes.map((code) => code.toUpperCase());
  if (codes.length > 0 && !codes.includes("CO")) return null;

  const matched: { raw: string; city: string | null }[] = [];
  for (const raw of segments(input.locationTexts)) {
    const folded = fold(raw);
    const saysColombia = COLOMBIA.test(folded);
    const city = cityIn(folded, saysColombia);
    if (saysColombia || city) matched.push({ raw, city });
  }

  const structuredCity = input.structuredCity
    ? cityIn(fold(input.structuredCity), true) ?? input.structuredCity.trim()
    : null;

  if (matched.length === 0) {
    // The structured country alone is explicit enough (SmartRecruiters
    // `country: "co"` with fullLocation "Zarzal, Valle del Cauca, Colombia").
    if (!codes.includes("CO")) return null;
    return { locationRaw: input.locationTexts[0]?.trim() || "Colombia", city: structuredCity };
  }
  return {
    locationRaw: matched.map((entry) => entry.raw).join("; ").slice(0, 500),
    city: structuredCity ?? matched.find((entry) => entry.city)?.city ?? null
  };
}

/** Workplace from the location text, only when it states one. */
export function workplaceFromText(texts: string[]): Workplace | null {
  const folded = fold(texts.join(" "));
  if (/\b(hybrid|hibrido)\b/.test(folded)) return "hybrid";
  if (/\b(remote|remoto|teletrabajo|home office)\b/.test(folded)) return "remote";
  return null;
}
