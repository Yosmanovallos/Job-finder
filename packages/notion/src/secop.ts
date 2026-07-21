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
  return value.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// QA / software-development terms: strong on their own (the contract object is
// software work). AI terms are broad (a tender can merely *mention* AI), so they
// only count as high-relevance alongside a service-context word.
// Software-qualified and testing-specific terms only. Bare "analista de
// calidad" / "control de calidad" / "aseguramiento de calidad" (unqualified) are
// deliberately excluded: in SECOP those are food/pharma/manufacturing QC noise.
const QA_DEV_TERMS = [
  "pruebas de software",
  "automatizacion de pruebas",
  "pruebas funcionales",
  "pruebas no funcionales",
  "pruebas de rendimiento",
  "analista de pruebas",
  "calidad de software",
  "aseguramiento de la calidad de software",
  "control de calidad de software",
  "quality assurance",
  "desarrollo de software",
  "fabrica de software",
  "ingenieria de software",
  "testing"
];
const AI_TERMS = [
  "inteligencia artificial",
  "machine learning",
  "aprendizaje automatico",
  "aprendizaje profundo",
  "deep learning",
  "ciencia de datos",
  "analitica de datos",
  "procesamiento de lenguaje natural",
  "vision artificial",
  "modelos predictivos",
  "mineria de datos",
  "big data",
  "chatbot"
];
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

// Natural-person / independent-contractor filter. The user has no company: he
// offers testing services solo. `tipo_de_contrato` is the primary discriminator
// — a "prestación de servicios" (or "consultoría") tender contracts a service a
// natural person can provide, unlike goods (Compraventa/Suministros), works
// (Obra) or non-profit-regime convenios (Decreto 092, which a natural person
// cannot be party to). Compared with norm() (accent-stripped, upper-cased).
const SERVICE_CONTRACT_TYPES = ["prestacion de servicios", "consultoria"];
// Company-scale procurement modalities a solo natural person realistically
// cannot win. Belt-and-suspenders on top of the tipo filter; substring match on
// the normalized value tolerates the dataset's inconsistent casing/accents
// (e.g. "Licitación pública" vs "Licitación Pública Acuerdo Marco de Precios").
//
// "Contratación régimen especial" is excluded outright. Verified against real
// tenders (hospitals, universities, public utilities, fiducias): régimen
// especial entities are not obliged to compete, so they use SECOP II only to
// PUBLISH already-signed contracts (Ley 2195 art. 53, "módulo publicitario").
// Every régimen-especial "Publicado" QA/AI process inspected was already awarded
// or already executed — none applyable. "Selección abreviada de menor cuantía"
// is NOT excluded (the guide's include-list: it can accept naturales); the
// goods-oriented "subasta inversa" is still screened by the "subasta" entry.
const EXCLUDED_MODALIDADES = [
  "licitacion",
  "regimen especial",
  "subasta",
  "acuerdo marco",
  "enajenacion"
];

// Individual-contract budget ceiling (COP). Per the independent-search guide,
// contracts under ~$80M are typical for a natural person and those over ~$100M
// almost always require a persona jurídica; $150M is the guide's red-flag line.
// An unstated/0 budget (parseBudget ⇒ null) is unknown, not large, so it is kept.
// Note: on régimen especial, precio_base is sometimes the whole program's value,
// not the individual contract — a noisy signal, hence a generous line, not $80M.
const NATURAL_PERSON_BUDGET_CEILING_COP = 150_000_000;

// UNSPSC procurement-category prefixes (after the "V1." version tag) for IT /
// software services, from the guide's code list: 8111xx (software, systems,
// data, internet services), 801116 (temporary engineering/IT staffing), 801015
// & 801017 (technical/management consulting). Used as a PRECISION SIGNAL, not a
// hard gate: SECOP category coding is unreliable (real "desarrollo de software"
// tenders appear miscoded under marketing/hardware/goods categories), so a
// missing IT code never drops a row on its own — it only fails to rescue one.
const IT_UNSPSC_PREFIXES = ["8111", "801116", "801015", "801017"];

function isItUnspsc(codigo: string | null): boolean {
  if (!codigo) return false;
  const code = codigo.replace(/^V\d+\./, ""); // strip "V1." version tag
  return IT_UNSPSC_PREFIXES.some((p) => code.startsWith(p));
}

function isServiceContract(tipoNorm: string | null): boolean {
  // Absent field ⇒ trust the SoQL WHERE (which already filtered on tipo).
  if (!tipoNorm) return true;
  return SERVICE_CONTRACT_TYPES.some((t) => tipoNorm.includes(norm(t)));
}

function isCompanyScaleModalidad(modalidadNorm: string): boolean {
  return EXCLUDED_MODALIDADES.some((m) => modalidadNorm.includes(norm(m)));
}

// Placeholder values SECOP uses for "no provider assigned yet" (genuinely open).
const NO_PROVIDER_PLACEHOLDERS = ["no definido", "no adjudicado", "no aplica"];

/**
 * True when a provider is already assigned. Régimen-especial entities publish
 * SIGNED contracts in SECOP II for transparency ("módulo publicitario", Ley 2195
 * art. 53); those keep `adjudicado = 'No'` yet name a `nombre_del_proveedor` /
 * `nit_del_proveedor_adjudicado`. Such a process cannot be applied to — drop it.
 */
function hasAwardedProvider(p: SecopProcess): boolean {
  for (const raw of [p.nombre_del_proveedor, p.nit_del_proveedor_adjudicado]) {
    const v = nonEmpty(raw);
    if (v && !NO_PROVIDER_PLACEHOLDERS.includes(v.toLowerCase())) return true;
  }
  return false;
}

/**
 * SoQL WHERE for recent, open QA/AI tenders that a natural person offering
 * testing services could take: a service-type contract, excluding company-scale
 * modalities. The `_` wildcard stands in for accented chars because Socrata's
 * upper() keeps accents (e.g. "PRESTACIÓN"); underscore matches the single Ó/Í.
 */
function buildWhere(sinceIso: string, nowIso: string): string {
  // Match the term against title + description together (more recall than
  // description alone). Concatenated so each term needs a single LIKE.
  const haystackExpr =
    "(upper(descripci_n_del_procedimiento) || ' ' || upper(nombre_del_procedimiento))";
  const likes = SEARCH_TERMS.map((term) => `${haystackExpr} like '%${norm(term)}%'`).join(" OR ");
  const serviceType =
    `(upper(tipo_de_contrato) like '%PRESTACI_N DE SERVICIOS%' ` +
    `OR upper(tipo_de_contrato) like '%CONSULTOR_A%')`;
  // R_GIMEN → underscore matches the accented É in "RÉGIMEN".
  const notCompanyScale = [
    "%LICITACI_N%",
    "%R_GIMEN ESPECIAL%",
    "%SUBASTA%",
    "%ACUERDO MARCO%",
    "%ENAJENACI_N%"
  ]
    .map((p) => `upper(modalidad_de_contratacion) not like '${p}'`)
    .join(" AND ");
  return (
    `(estado_del_procedimiento in ('Publicado','Abierto')) ` +
    // The one reliable "still open" signal: a future offer-reception deadline.
    // Publicity-mode / already-awarded processes have no offer window (null), and
    // closed ones are in the past — both are excluded. This is the load-bearing
    // filter; the status flags (adjudicado/estado/fase) proved unreliable for
    // régimen especial and are NOT trusted.
    `AND (fecha_de_recepcion_de > '${nowIso}') ` +
    // Belt-and-suspenders: drop a named contracted provider if present.
    `AND (nombre_del_proveedor is null OR upper(nombre_del_proveedor) in ('NO DEFINIDO','NO ADJUDICADO','NO APLICA','')) ` +
    `AND (${likes}) ` +
    `AND ${serviceType} ` +
    `AND (${notCompanyScale}) ` +
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
  tipo_de_contrato?: string;
  codigo_principal_de_categoria?: string;
  adjudicado?: string;
  estado_de_apertura_del_proceso?: string;
  nombre_del_proveedor?: string;
  nit_del_proveedor_adjudicado?: string;
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
  /** Contract type (e.g. "Prestación de servicios") — the natural-person signal. */
  tipoContrato: string | null;
  /** UNSPSC procurement category (e.g. "V1.81111500"); null when unstated. */
  categoriaUnspsc: string | null;
  /** Assigned provider if any (open ⇒ null). Surfaced so the user can spot a
   *  publicity-mode award the open-data flag may miss; awarded rows are dropped. */
  proveedorAdjudicado: string | null;
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

  // Natural-person gate (defense in depth over the SoQL WHERE; also covers
  // fixtures/mocks that bypass the query). Keep only service-type contracts and
  // drop company-scale modalities — the user has no company.
  const tipoContrato = nonEmpty(p.tipo_de_contrato);
  const modalidad = nonEmpty(p.modalidad_de_contratacion);
  if (!isServiceContract(tipoContrato ? norm(tipoContrato) : null)) return null;
  if (modalidad && isCompanyScaleModalidad(norm(modalidad))) return null;
  // Already contracted (publicity-mode signed contract) ⇒ cannot apply.
  if (hasAwardedProvider(p)) return null;
  // Must still be open to offers: a future reception deadline is the only
  // reliable "can I apply" signal (status/fase flags lie for régimen especial).
  // Absent/past deadline ⇒ publicity of an already-decided contract ⇒ dropped.
  const recepcion = nonEmpty(p.fecha_de_recepcion_de);
  if (!recepcion || new Date(recepcion).getTime() <= new Date(now).getTime()) return null;

  // Enterprise-scale budget ⇒ not a solo natural-person contract. Unstated (null)
  // is unknown, so it is kept and shown for the user to judge.
  const presupuestoCop = parseBudget(p.precio_base);
  if (presupuestoCop !== null && presupuestoCop > NATURAL_PERSON_BUDGET_CEILING_COP) return null;

  const serviceContext = SERVICE_CONTEXT.some((w) => haystack.includes(norm(w)));
  const noiseContext = NOISE_CONTEXT.some((w) => haystack.includes(norm(w)));
  const categoriaUnspsc = nonEmpty(p.codigo_principal_de_categoria);
  const itCode = isItUnspsc(categoriaUnspsc);

  // Noise gate. A bare AI mention (no QA/dev term) that has neither a real
  // tech-service context nor an IT procurement category is almost always noise
  // — the tender name-drops "inteligencia artificial" while contracting
  // agriculture, audiovisual, editorial or training work. The IT UNSPSC code or
  // a service-context word rescues genuine AI-tech leads (chatbots, big data).
  if (qaDev.length === 0 && !serviceContext && !itCode) return null;
  if (qaDev.length === 0 && noiseContext && !serviceContext) return null;

  // Consultoría tenders are usually awarded to firms, not a solo natural person,
  // so never rank one "Alta" even when a QA term matched.
  const esPrestacionServicios =
    !tipoContrato || norm(tipoContrato).includes(norm("prestacion de servicios"));
  // "Alta" when real software/QA work, or AI/ML with a tech signal (service
  // context or an IT procurement code); else "Media".
  const strong =
    (qaDev.length > 0 || (ai.length > 0 && (serviceContext || itCode))) && esPrestacionServicios;
  return {
    externalId,
    title,
    entidad: nonEmpty(p.entidad) ?? "(entidad no indicada)",
    objeto,
    ciudad: nonEmpty(p.ciudad_entidad),
    presupuestoCop,
    modalidad,
    tipoContrato,
    categoriaUnspsc,
    proveedorAdjudicado: nonEmpty(p.nombre_del_proveedor),
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
  const sinceDays = options.sinceDays ?? 120;
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
    "tipo_de_contrato",
    "codigo_principal_de_categoria",
    "adjudicado",
    "estado_de_apertura_del_proceso",
    "nombre_del_proveedor",
    "nit_del_proveedor_adjudicado",
    "estado_del_procedimiento",
    "fecha_de_publicacion_del",
    "fecha_de_recepcion_de",
    "urlproceso"
  ].join(",");
  // SoQL timestamp literal: no trailing "Z"/milliseconds (matches sinceIso).
  const nowIsoForQuery = now.toISOString().slice(0, 19);
  const query =
    `SELECT ${select} WHERE ${buildWhere(sinceIso, nowIsoForQuery)} ` +
    `ORDER BY fecha_de_recepcion_de ASC LIMIT ${limit}`;
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
