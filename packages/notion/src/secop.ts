// SECOP II (Colombia Compra Eficiente) discovery of QA/AI public-tender leads.
// Source: datos.gov.co Socrata SODA API, dataset p6dx-8zbt. Public open data,
// no auth, CC BY-SA 4.0. See docs/source-catalog/secop.md.
//
// Access is the official open-data API only — never scraping nor evasion
// (AGENTS.md rules 6, 8). External text is untrusted (rule 6): it is stored as
// data and never used to drive tool calls. Fields the source does not state stay
// null/unknown (rule 5): keyword match is discovery, not a semantic guarantee.

const DATASET_URL = "https://www.datos.gov.co/resource/p6dx-8zbt.json";

/** Normalized to UPPER + accent-stripped for robust keyword matching. */
function norm(value: string): string {
  return value
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// QA / software-development terms: strong on their own (the contract object is
// software work). AI terms are broad (a tender can merely *mention* AI), so they
// only count as high-relevance alongside a service-context word.
const QA_DEV_TERMS = [
  "pruebas de software",
  "automatizacion de pruebas",
  "calidad de software",
  "aseguramiento de la calidad de software",
  "control de calidad de software",
  "desarrollo de software",
  "fabrica de software",
  "testing"
];
const AI_TERMS = ["inteligencia artificial", "machine learning", "aprendizaje automatico"];
const SEARCH_TERMS = [...QA_DEV_TERMS, ...AI_TERMS];

// Words that signal actual software work is being contracted (raise AI matches
// to "Alta"). Deliberately excludes generic "servicio"/"contrato" — those appear
// in nearly every tender and would make the signal meaningless.
const SERVICE_CONTEXT = [
  "desarrollo de",
  "implementacion de",
  "consultoria",
  "modelo de",
  "software",
  "plataforma tecnologica",
  "solucion tecnologica",
  "analitica de datos",
  "algoritmo",
  "chatbot",
  "automatizacion"
];
// Contexts that are almost never a software/QA/AI service (obvious noise).
const NOISE_CONTEXT = [
  "impresion",
  "encuadernacion",
  "libro",
  "diplomado",
  "curso",
  "capacitacion",
  "dotacion",
  "papeleria",
  "mobiliario",
  "cafeteria",
  "refrigerio"
];

/** SoQL LIKE clause over the tender description for the strict term set. */
function buildWhere(sinceIso: string): string {
  const likes = SEARCH_TERMS.map(
    (term) => `upper(descripci_n_del_procedimiento) like '%${norm(term)}%'`
  ).join(" OR ");
  return (
    `(estado_del_procedimiento in ('Publicado','Abierto')) ` +
    `AND (${likes}) ` +
    `AND (fecha_de_publicacion_del > '${sinceIso}')`
  );
}

export interface SecopProcess {
  id_del_proceso?: string;
  nombre_del_procedimiento?: string;
  descripci_n_del_procedimiento?: string;
  entidad?: string;
  ciudad_entidad?: string;
  precio_base?: string;
  modalidad_de_contratacion?: string;
  estado_del_procedimiento?: string;
  fecha_de_publicacion_del?: string;
  fecha_de_recepcion_de?: string;
  urlproceso?: { url?: string };
}

export interface Opportunity {
  /** Stable external id: SECOP id_del_proceso. */
  externalId: string;
  title: string;
  entidad: string;
  /** Tender object (untrusted free text). */
  objeto: string;
  ciudad: string | null;
  /** Estimated budget in COP; null when the source does not state it. */
  presupuestoCop: number | null;
  modalidad: string | null;
  estado: string | null;
  publishedAt: string | null;
  /** Reception date — tentative "deadline"; semantics unconfirmed (see catalog). */
  deadlineTentative: string | null;
  url: string | null;
  /** Which QA/AI keywords matched — the evidence for inclusion. */
  matchedTerms: string[];
  /** "Alta" when a strong QA/AI term matched, else "Media". */
  relevance: "Alta" | "Media";
  sourceName: string;
  discoveredAt: string;
}

function parseBudget(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nonEmpty(value: string | undefined): string | null {
  const v = (value ?? "").trim();
  return v.length > 0 ? v : null;
}

/** Pure mapping: SECOP process → Opportunity. Never invents absent fields. */
export function mapProcess(p: SecopProcess, now: string): Opportunity | null {
  const externalId = nonEmpty(p.id_del_proceso);
  if (!externalId) return null;
  const objeto = (p.descripci_n_del_procedimiento ?? "").trim();
  const title = nonEmpty(p.nombre_del_procedimiento) ?? externalId;
  const haystack = norm(`${title} ${objeto}`);

  const qaDev = QA_DEV_TERMS.filter((term) => haystack.includes(norm(term)));
  const ai = AI_TERMS.filter((term) => haystack.includes(norm(term)));
  const matched = [...qaDev, ...ai];
  if (matched.length === 0) return null;

  const serviceContext = SERVICE_CONTEXT.some((w) => haystack.includes(norm(w)));
  const noiseContext = NOISE_CONTEXT.some((w) => haystack.includes(norm(w)));

  // Drop obvious noise: only a broad AI mention, in a non-service context.
  if (qaDev.length === 0 && noiseContext && !serviceContext) return null;

  // "Alta" when real software/QA work, or AI/ML with a service context; else "Media".
  const strong = qaDev.length > 0 || (ai.length > 0 && serviceContext);
  return {
    externalId,
    title,
    entidad: nonEmpty(p.entidad) ?? "(entidad no indicada)",
    objeto,
    ciudad: nonEmpty(p.ciudad_entidad),
    presupuestoCop: parseBudget(p.precio_base),
    modalidad: nonEmpty(p.modalidad_de_contratacion),
    estado: nonEmpty(p.estado_del_procedimiento),
    publishedAt: nonEmpty(p.fecha_de_publicacion_del),
    deadlineTentative: nonEmpty(p.fecha_de_recepcion_de),
    url: nonEmpty(p.urlproceso?.url),
    matchedTerms: matched,
    relevance: strong ? "Alta" : "Media",
    sourceName: "SECOP II",
    discoveredAt: now
  };
}

export interface FetchSecopOptions {
  sinceDays?: number;
  limit?: number;
  now?: Date;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

/** Fetches recent Publicado/Abierto QA/AI tenders and maps them to Opportunities. */
export async function fetchSecopOpportunities(
  options: FetchSecopOptions = {}
): Promise<{ opportunities: Opportunity[]; rawCount: number; sinceIso: string }> {
  const now = options.now ?? new Date();
  const sinceDays = options.sinceDays ?? 60;
  const limit = options.limit ?? 300;
  const since = new Date(now.getTime() - sinceDays * 24 * 60 * 60 * 1000);
  const sinceIso = `${since.toISOString().slice(0, 10)}T00:00:00`;
  const doFetch = options.fetchImpl ?? fetch;

  const select = [
    "id_del_proceso",
    "nombre_del_procedimiento",
    "descripci_n_del_procedimiento",
    "entidad",
    "ciudad_entidad",
    "precio_base",
    "modalidad_de_contratacion",
    "estado_del_procedimiento",
    "fecha_de_publicacion_del",
    "fecha_de_recepcion_de",
    "urlproceso"
  ].join(",");
  const query =
    `SELECT ${select} WHERE ${buildWhere(sinceIso)} ` +
    `ORDER BY fecha_de_publicacion_del DESC LIMIT ${limit}`;
  const url = `${DATASET_URL}?$query=${encodeURIComponent(query)}`;

  const res = await doFetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`SECOP API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const rows = (await res.json()) as SecopProcess[];
  const nowIso = now.toISOString();
  const seen = new Set<string>();
  const opportunities: Opportunity[] = [];
  for (const row of rows) {
    const opp = mapProcess(row, nowIso);
    if (opp && !seen.has(opp.externalId)) {
      seen.add(opp.externalId);
      opportunities.push(opp);
    }
  }
  return { opportunities, rawCount: rows.length, sinceIso };
}
