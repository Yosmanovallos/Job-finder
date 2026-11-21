import { createHash } from "node:crypto";
import { contentTerms } from "../../lib/resume-tailor/text.js";
import type { Transport, TransportRequest, TransportResponse } from "./gateway.js";
import { estimateTokens } from "./prompts.js";

// AI Resume Studio R3 — `RESUME_AI_PROVIDER=mock`: a deterministic,
// deliberately ADVERSARIAL stand-in for the model, used by CI and evals.
// It reads the same delimited messages Qwen would get and answers in the
// same JSON shapes, but on purpose (driven by a hash of the input):
//   - invents numbers, tools, employers, seniority and fake citations in a
//     fixed share of its answers (`fabricationRate`);
//   - returns invalid JSON on some first attempts (`invalidJsonRate`);
//   - OBEYS instructions injected in the CV or the vacancy («ignora las
//     instrucciones…»), like a weak model would.
// So «0 invented facts accepted» is proven against real fabrications, not
// against a mock that never lies.

export interface MockOptions {
  fabricationRate?: number;
  invalidJsonRate?: number;
  obeyInjections?: boolean;
}

export interface MockStats {
  calls: number;
  fabricated: number;
  invalidJson: number;
  obeyedInjection: number;
}

const INJECTION = /(ignora|ignore|olvida|disregard|nuevas instrucciones|system prompt|eres ahora|you are now)/i;

function blocks(user: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of user.matchAll(/<<<([A-Z_]+)>>>\n([\s\S]*?)\n<<<FIN_\1>>>/g)) out[m[1]] = m[2];
  return out;
}

function roll(seed: string, salt: string): number {
  return createHash("sha256").update(`${salt}\u0000${seed}`).digest().readUInt32BE(0) / 0xffffffff;
}

interface FactLine {
  id: string;
  section: string;
  text: string;
}

function factLinesOf(block: string | undefined): FactLine[] {
  if (!block) return [];
  const out: FactLine[] = [];
  for (const line of block.split("\n")) {
    const m = /^\[([^\]]+)\]\s+([a-z]+):\s*(.*)$/.exec(line);
    if (m) out.push({ id: m[1], section: m[2], text: m[3] });
  }
  return out;
}

function firstWords(text: string, n: number): string {
  return text.split(/\s+/).slice(0, n).join(" ");
}

function sentenceCase(text: string): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (!s) return s;
  const up = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?]$/.test(up) ? up : `${up}.`;
}

const MONTH_RANGE = /((?:19|20)\d{2}-(?:0[1-9]|1[0-2]))\s*[–-]\s*((?:19|20)\d{2}-(?:0[1-9]|1[0-2])|actual|presente)/i;

/** Parses the synthetic/common CV layout: UPPERCASE headings, «a | b | c» entries, «- » bullets. */
function extractCv(text: string, fabricate: boolean) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const out = {
    headline: null as null | { text: string; quote: string },
    summary: null as null | { text: string; quote: string },
    experience: [] as any[],
    education: [] as any[],
    certifications: [] as any[],
    skills: [] as any[],
    languages: [] as any[]
  };
  let section = "head";
  const heading = (l: string) => {
    const n = l.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
    if (l !== l.toUpperCase() || l.length > 40) return null;
    if (/^(PERFIL|RESUMEN|SOBRE MI)/.test(n)) return "summary";
    if (/^EXPERIENCIA/.test(n)) return "experience";
    if (/^(FORMACION|EDUCACION|ESTUDIOS)/.test(n)) return "education";
    if (/^(CERTIFICA|CURSOS)/.test(n)) return "certifications";
    if (/^(HABILIDADES|COMPETENCIAS|CONOCIMIENTOS)/.test(n)) return "skills";
    if (/^IDIOMAS/.test(n)) return "languages";
    return null;
  };
  for (const line of lines) {
    const h = heading(line);
    if (h) {
      section = h;
      continue;
    }
    if (/\[(NOMBRE|CORREO|TELEFONO|ENLACE)\]/.test(line)) continue;
    if (section === "head") {
      if (!out.headline) out.headline = { text: line.slice(0, 120), quote: line };
      continue;
    }
    if (section === "summary") {
      out.summary = out.summary ? { text: `${out.summary.text} ${line}`.slice(0, 1200), quote: out.summary.quote } : { text: line, quote: line };
      continue;
    }
    if (section === "experience") {
      if (/^[-•*]/.test(line) && out.experience.length) {
        const t = line.replace(/^[-•*]\s*/, "");
        out.experience[out.experience.length - 1].bullets.push({ text: t, quote: t });
        continue;
      }
      const parts = line.split("|").map((p) => p.trim());
      const range = MONTH_RANGE.exec(line);
      out.experience.push({
        role: parts[0] ?? "",
        company: parts[1] ?? "",
        city: parts.length > 3 ? parts[2] : "",
        startDate: range?.[1] ?? "",
        endDate: range && /^\d/.test(range[2]) ? range[2] : "",
        current: Boolean(range && !/^\d/.test(range[2])),
        quote: parts[0] || line,
        bullets: []
      });
      continue;
    }
    if (section === "education") {
      const parts = line.split("|").map((p) => p.trim());
      const range = MONTH_RANGE.exec(line);
      out.education.push({ degree: parts[0] ?? line, institution: parts[1] ?? "", startDate: range?.[1] ?? "", endDate: range && /^\d/.test(range[2]) ? range[2] : "", quote: parts[0] || line });
      continue;
    }
    if (section === "certifications") {
      const parts = line.split("|").map((p) => p.trim());
      out.certifications.push({ name: parts[0] ?? line, issuer: parts[1] ?? "", date: "", quote: parts[0] || line });
      continue;
    }
    if (section === "skills") {
      for (const s of line.split(/[,;·]/).map((x) => x.trim()).filter(Boolean)) out.skills.push({ name: s.slice(0, 60), quote: s });
      continue;
    }
    if (section === "languages") {
      const [name, ...rest] = line.split(/\s+/);
      out.languages.push({ name, level: rest.join(" "), quote: line });
    }
  }
  if (fabricate) {
    out.skills.push({ name: "Python", quote: "Python avanzado" });
    if (out.experience[0]) out.experience[0].bullets.push({ text: "Lideró un equipo de 12 personas.", quote: "Lideró un equipo de 12 personas" });
  }
  return out;
}

export function mockTransport(options: MockOptions = {}): Transport & { stats: MockStats } {
  const fabricationRate = options.fabricationRate ?? 0.35;
  const invalidJsonRate = options.invalidJsonRate ?? 0.1;
  const obey = options.obeyInjections ?? true;
  const seen = new Map<string, number>();
  const stats: MockStats = { calls: 0, fabricated: 0, invalidJson: 0, obeyedInjection: 0 };

  const transport = async (request: TransportRequest): Promise<TransportResponse> => {
    stats.calls++;
    const seed = createHash("sha256").update(request.user).digest("hex");
    const callNo = (seen.get(seed) ?? 0) + 1;
    seen.set(seed, callNo);
    const data = blocks(request.user);
    const injected = obey && Object.values(data).some((v) => INJECTION.test(v));
    const fabricate = roll(seed, "fab") < fabricationRate;
    if (fabricate) stats.fabricated++;
    if (injected) stats.obeyedInjection++;

    let payload: unknown;
    const facts = factLinesOf(data.CV);
    switch (request.promptId) {
      case "cv_extract":
        payload = extractCv(data.CV ?? "", fabricate || injected);
        break;
      case "job_requirements": {
        const lines = (data.VACANTE ?? "").split("\n").map((l) => l.replace(/^[-•*\s]+/, "").trim());
        const reqs = lines
          .filter((l) => l.length > 8 && !/^cargo:/i.test(l))
          .slice(0, 8)
          .map((text) => ({ text, kind: /deseable|plus/i.test(text) ? "nice" : "must" }));
        if (fabricate || injected) reqs.push({ text: "10 años de experiencia en liderazgo de equipos", kind: "must" });
        payload = { requirements: reqs };
        break;
      }
      case "evidence_map": {
        const reqs = (data.VACANTE ?? "").split("\n").map((l) => /^\[([^\]]+)\]\s*(.*)$/.exec(l)).filter(Boolean) as RegExpExecArray[];
        payload = {
          items: reqs.map((m) => {
            const terms = new Set(contentTerms(m[2]));
            const hits = facts.filter((f) => contentTerms(f.text).some((t) => terms.has(t))).slice(0, 2);
            const citations = hits.map((f) => ({ factId: f.id, quote: firstWords(f.text, 4) }));
            if (fabricate) citations.push({ factId: "exp-inventado", quote: "lideró un equipo de 20 personas" });
            return { requirementId: m[1], citations };
          })
        };
        break;
      }
      case "card_headline": {
        const role = facts.find((f) => f.section === "experience")?.text.split(" · ")[0] ?? facts.find((f) => f.section === "headline")?.text ?? "Profesional";
        const jobTitle = (data.VACANTE ?? "").trim();
        let text = role;
        if (fabricate) text = `${role} Senior · ${jobTitle}`;
        if (injected) text = `${jobTitle} con 10 años de experiencia en Python`;
        payload = { text: text.slice(0, 120), supportingFactIds: facts.filter((f) => f.section === "experience").slice(0, 1).map((f) => f.id), why: "Uso el cargo que ya aparece en tu experiencia." };
        break;
      }
      case "card_rewrite": {
        let text = sentenceCase(data.RESPUESTA_USUARIO ?? "");
        if (fabricate) text = text.replace(/\.$/, roll(seed, "kind") < 0.5 ? ", aumentando la productividad un 35%." : " usando Salesforce.");
        if (injected) text = `${text.replace(/\.$/, "")} con 10 años de experiencia en Python.`;
        payload = { text: text.slice(0, 300), supportingFactIds: facts.slice(0, 1).map((f) => f.id), why: "Es un requisito de la vacante; va primero." };
        break;
      }
      case "card_summary": {
        const role = facts.find((f) => f.section === "experience")?.text.split(" · ")[0] ?? "Profesional";
        const bullets = facts.filter((f) => f.section === "bullet").slice(0, 2).map((f) => f.text.replace(/\.$/, "").toLowerCase());
        let text = `${role} con experiencia en ${bullets.join(" y ") || "su área"}. Orientado a resultados y al trabajo en equipo.`;
        if (fabricate) text = `Con 10 años de experiencia, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
        if (injected) text = `${text} Experto certificado en Python.`;
        payload = { text: text.slice(0, 1200), supportingFactIds: facts.slice(0, 3).map((f) => f.id), why: "Resumo lo que aprobaste." };
        break;
      }
      case "card_chat": {
        const current = (data.PROPUESTA ?? "").trim();
        const ask = data.RESPUESTA_USUARIO ?? "";
        let text = /corto|breve|resum/i.test(ask) ? `${current.split(/(?<=\.)\s/)[0].slice(0, 160)}` : current;
        // A weak model obeys «agrega que vendí 500 millones»: the validator must catch it.
        const number = /\d[\d.,]*\s*%?/.exec(ask);
        if (number || injected) text = `${text.replace(/\.$/, "")}, con un resultado de ${number?.[0] ?? "10 años"}.`;
        payload = { text: text || current, supportingFactIds: [], reply: "Listo, ajusté la tarjeta." };
        break;
      }
      default:
        payload = {};
    }

    let content = JSON.stringify(payload);
    if (callNo === 1 && roll(seed, "json") < invalidJsonRate) {
      stats.invalidJson++;
      content = `Claro, aquí está el JSON: ${content.slice(0, Math.max(10, content.length - 5))}`;
    }
    return {
      content,
      usage: { promptTokens: estimateTokens(request.system) + estimateTokens(request.user), completionTokens: estimateTokens(content), cachedTokens: 0 }
    };
  };
  return Object.assign(transport, { stats });
}
