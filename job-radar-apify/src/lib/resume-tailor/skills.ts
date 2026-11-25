import { extractTechnologies, isCatalogTechnology } from "../extract-technologies.js";
import { normalizeText } from "./text.js";

// AI Resume Studio R3 — controlled skill vocabulary (doc 05 §4 «sinónimos
// controlados»). Technology names come from the site's catalog
// (extract-technologies.ts); this adds the office, marketing, admin,
// finance, logistics and service skills that most vacancies here ask for.
// Matching is literal (whole word/phrase), never inferred.

interface SkillEntry {
  name: string;
  aliases: string[];
  /** R4d: a tool (asked «¿Has usado X?») rather than an area or a language. */
  tool?: boolean;
  /** R4d: an extra check on the ORIGINAL text (e.g. «Office» but not «our Bogota office»). */
  guard?: (original: string, normalized: string) => boolean;
}

// R4d: QA, monitoring and CI tools that vacancies name and the site-wide
// catalog (extract-technologies.ts, which also feeds public job pages) doesn't
// have. Kept HERE so public pages don't change.
const STUDIO_TOOLS: SkillEntry[] = [
  { name: "Splunk", aliases: ["splunk"], tool: true },
  { name: "Robot Framework", aliases: ["robot framework", "robotframework"], tool: true },
  { name: "Kibana", aliases: ["kibana"], tool: true },
  { name: "Grafana", aliases: ["grafana"], tool: true },
  { name: "Datadog", aliases: ["datadog"], tool: true },
  { name: "New Relic", aliases: ["new relic", "newrelic"], tool: true },
  { name: "Elasticsearch", aliases: ["elasticsearch", "elk stack"], tool: true },
  { name: "Dynatrace", aliases: ["dynatrace"], tool: true },
  { name: "SoapUI", aliases: ["soapui", "soap ui"], tool: true },
  { name: "Insomnia", aliases: ["insomnia"], tool: true },
  { name: "Rest Assured", aliases: ["rest assured", "rest-assured", "restassured"], tool: true },
  { name: "Pytest", aliases: ["pytest"], tool: true },
  { name: "JUnit", aliases: ["junit"], tool: true },
  { name: "TestNG", aliases: ["testng"], tool: true },
  { name: "Cucumber", aliases: ["cucumber", "gherkin"], tool: true },
  { name: "Appium", aliases: ["appium"], tool: true },
  { name: "TestRail", aliases: ["testrail"], tool: true },
  { name: "Xray", aliases: ["xray for jira", "jira xray"], tool: true },
  { name: "Azure DevOps", aliases: ["azure devops"], tool: true },
  { name: "CircleCI", aliases: ["circleci", "circle ci"], tool: true },
  { name: "Bitbucket", aliases: ["bitbucket"], tool: true },
  { name: "GitHub", aliases: ["github"], tool: true },
  { name: "GitLab", aliases: ["gitlab"], tool: true },
  { name: "SVN", aliases: ["svn", "subversion"], tool: true }
];

// «Office» alone is usually «our Bogotá office» in English vacancies: only
// «Office» written with a capital, «paquete/microsoft office», or «de/en office».
const officeGuard = (original: string, normalized: string) =>
  /(^|[^A-Za-z0-9])Office($|[^A-Za-z0-9])/.test(original) ||
  /(microsoft|paquete|suite|ms|herramientas|manejo de|conocimientos? en|dominio de)\s+office/.test(normalized) ||
  /office\s*365/.test(normalized);

const STUDIO_SKILLS: SkillEntry[] = [
  ...STUDIO_TOOLS,
  { name: "Meta Ads", aliases: ["meta ads", "facebook ads", "pauta en meta", "pauta en facebook"] },
  { name: "TikTok Ads", aliases: ["tiktok ads"] },
  { name: "Google Ads", aliases: ["google ads", "adwords"] },
  { name: "GA4", aliases: ["ga4", "google analytics"] },
  { name: "Looker Studio", aliases: ["looker studio", "data studio"] },
  { name: "SEO", aliases: ["seo"] },
  { name: "Canva", aliases: ["canva"] },
  { name: "Photoshop", aliases: ["photoshop"] },
  { name: "Illustrator", aliases: ["illustrator"] },
  { name: "HubSpot", aliases: ["hubspot"] },
  { name: "Salesforce", aliases: ["salesforce"] },
  { name: "CRM", aliases: ["crm"] },
  { name: "Pruebas A/B", aliases: ["pruebas a/b", "a/b testing", "test a/b", "pruebas ab"] },
  { name: "Redes sociales", aliases: ["redes sociales", "social media"] },
  { name: "Email marketing", aliases: ["email marketing", "mailchimp"] },
  { name: "Word", aliases: ["word", "microsoft word"] },
  { name: "PowerPoint", aliases: ["powerpoint"] },
  { name: "Office", aliases: ["office", "microsoft office", "paquete office", "ofimatica"], guard: officeGuard },
  { name: "Google Sheets", aliases: ["google sheets", "hojas de calculo de google"] },
  { name: "SAP", aliases: ["sap"] },
  { name: "Siigo", aliases: ["siigo"] },
  { name: "World Office", aliases: ["world office"] },
  { name: "Helisa", aliases: ["helisa"] },
  { name: "NIIF", aliases: ["niif", "ifrs"] },
  { name: "Nómina", aliases: ["nomina", "liquidacion de nomina"] },
  { name: "Contabilidad", aliases: ["contabilidad", "contable"] },
  { name: "Facturación electrónica", aliases: ["facturacion electronica"] },
  { name: "Conciliaciones bancarias", aliases: ["conciliaciones bancarias", "conciliacion bancaria"] },
  { name: "Cuentas por pagar", aliases: ["cuentas por pagar"] },
  { name: "Cuentas por cobrar", aliases: ["cuentas por cobrar", "cartera"] },
  { name: "Inventarios", aliases: ["inventarios", "inventario"] },
  { name: "Logística", aliases: ["logistica"] },
  { name: "WMS", aliases: ["wms"] },
  { name: "Montacargas", aliases: ["montacargas"] },
  { name: "Servicio al cliente", aliases: ["servicio al cliente", "atencion al cliente"] },
  { name: "Ventas", aliases: ["ventas", "venta consultiva"] },
  { name: "Call center", aliases: ["call center", "contact center"] },
  { name: "Archivo", aliases: ["archivo", "gestion documental"] },
  { name: "Recepción", aliases: ["recepcion"] },
  { name: "Agenda", aliases: ["agenda", "manejo de agenda"] },
  { name: "Caja", aliases: ["caja", "manejo de caja", "cuadre de caja"] },
  { name: "Manipulación de alimentos", aliases: ["manipulacion de alimentos"] },
  { name: "Licencia de conducción", aliases: ["licencia de conduccion", "pase c1", "pase c2", "licencia c1", "licencia c2"] },
  { name: "Seguridad y salud en el trabajo", aliases: ["sst", "seguridad y salud en el trabajo", "sg-sst"] },
  { name: "Inglés", aliases: ["ingles", "english"] },
  { name: "Portugués", aliases: ["portugues"] },
  { name: "AutoCAD", aliases: ["autocad"] },
  { name: "Gestión de proyectos", aliases: ["gestion de proyectos", "project management"] },
  { name: "Calendario de contenidos", aliases: ["calendario de contenidos", "calendario editorial"] }
];

const patterns = new Map<string, RegExp>();
function aliasPattern(alias: string): RegExp {
  let re = patterns.get(alias);
  if (!re) {
    const escaped = normalizeText(alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`);
    patterns.set(alias, re);
  }
  return re;
}

/** Canonical skill names literally present in `text`: technologies first, then studio skills. */
export function findSkills(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = new Set(extractTechnologies(text));
  const normalized = normalizeText(text);
  for (const entry of STUDIO_SKILLS) {
    const hits = entry.aliases.filter((alias) => aliasPattern(alias).test(normalized));
    if (!hits.length) continue;
    // A guarded entry found only by its bare name needs the guard too.
    if (entry.guard && hits.every((a) => a === normalizeText(entry.name)) && !entry.guard(text, normalized)) continue;
    found.add(entry.name);
  }
  return [...found];
}

// ---------- R4d: one question per missing tool -----------------------------

const LANGUAGE_SKILLS = new Set(["Inglés", "Portugués"]);
// Named products of the studio list (the rest are areas of work: «Nómina», «Ventas»…).
const STUDIO_PRODUCTS = new Set([
  "Meta Ads", "TikTok Ads", "Google Ads", "GA4", "Looker Studio", "Canva", "Photoshop", "Illustrator", "HubSpot", "Salesforce",
  "Word", "PowerPoint", "Office", "Google Sheets", "SAP", "Siigo", "World Office", "Helisa", "WMS", "AutoCAD"
]);

/** How a missing skill is asked: a tool («¿Has usado Jenkins?»), a language or an area of work. */
export function skillKind(skill: string): "tool" | "language" | "area" {
  if (LANGUAGE_SKILLS.has(skill)) return "language";
  if (isCatalogTechnology(skill) || STUDIO_PRODUCTS.has(skill) || STUDIO_SKILLS.some((e) => e.name === skill && e.tool)) return "tool";
  return "area";
}

/** The plain question for one missing skill (copy from the report; not tested with users yet). */
export function skillQuestion(skill: string): string {
  const kind = skillKind(skill);
  if (kind === "language") return `¿Hablas ${skill.toLowerCase()}?`;
  if (kind === "area") return `¿Tienes experiencia en ${skill.charAt(0).toLowerCase()}${skill.slice(1)}?`;
  return `¿Has usado ${skill}?`;
}

// Families of interchangeable tools, for «Algo parecido». Only tools the CV
// ALREADY shows are offered; the missing tool's name is never written.
const FAMILIES: string[][] = [
  ["Jenkins", "GitHub Actions", "GitLab CI", "Azure DevOps", "CircleCI", "CI/CD"],
  ["Git", "GitHub", "GitLab", "Bitbucket", "SVN"],
  ["Splunk", "Kibana", "Grafana", "Datadog", "New Relic", "Elasticsearch", "Dynatrace"],
  ["Robot Framework", "Selenium", "Cypress", "Playwright", "Pytest", "JUnit", "TestNG", "Cucumber", "Appium", "Jest"],
  ["Postman", "SoapUI", "Insomnia", "Rest Assured", "API REST"],
  ["Jira", "TestRail", "Xray", "Trello", "Azure DevOps"],
  ["Confluence", "Jira", "Trello"],
  ["Python", "Java", "JavaScript", "TypeScript", "C#", "Ruby", "Kotlin", "Go", "PHP"],
  ["PostgreSQL", "MySQL", "SQL", "Oracle", "MongoDB"],
  ["AWS", "Azure", "Google Cloud"],
  ["Power BI", "Tableau", "Looker Studio", "Excel"],
  ["Siigo", "World Office", "Helisa", "SAP"],
  ["Meta Ads", "TikTok Ads", "Google Ads"],
  ["HubSpot", "Salesforce", "CRM"],
  ["Photoshop", "Illustrator", "Canva", "Figma", "Adobe XD"]
];

/** Tools of the same family as `skill` that are among `cvSkills` (in family order). */
export function relatedSkills(skill: string, cvSkills: Iterable<string>): string[] {
  const have = new Set(cvSkills);
  const out: string[] = [];
  for (const family of FAMILIES) {
    if (!family.includes(skill)) continue;
    for (const other of family) if (other !== skill && have.has(other) && !out.includes(other)) out.push(other);
  }
  return out.slice(0, 4);
}

/** True when `skill` (a canonical name) or one of its aliases appears in `text`. */
export function textMentionsSkill(text: string, skill: string): boolean {
  const normalized = normalizeText(text);
  if (aliasPattern(skill).test(normalized)) return true;
  const entry = STUDIO_SKILLS.find((e) => e.name === skill);
  if (entry && entry.aliases.some((alias) => aliasPattern(alias).test(normalized))) return true;
  return extractTechnologies(text).includes(skill);
}

/** Canonical names of every known skill, lowercased and normalized (for the factuality validator). */
export function isKnownSkillTerm(term: string): boolean {
  return findSkills(term).length > 0;
}
