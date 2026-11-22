import { extractTechnologies } from "../extract-technologies.js";
import { normalizeText } from "./text.js";

// AI Resume Studio R3 — controlled skill vocabulary (doc 05 §4 «sinónimos
// controlados»). Technology names come from the site's catalog
// (extract-technologies.ts); this adds the office, marketing, admin,
// finance, logistics and service skills that most vacancies here ask for.
// Matching is literal (whole word/phrase), never inferred.

interface SkillEntry {
  name: string;
  aliases: string[];
}

const STUDIO_SKILLS: SkillEntry[] = [
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
  { name: "Office", aliases: ["office", "microsoft office", "paquete office", "ofimatica"] },
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
    if (entry.aliases.some((alias) => aliasPattern(alias).test(normalized))) found.add(entry.name);
  }
  return [...found];
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
