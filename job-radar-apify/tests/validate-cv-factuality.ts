// Pure-logic adversarial tests for src/cv/factuality.ts — no LLM, no DB.
// Regla 11 de AGENTS.md: cada validador tiene sus propios tests
// adversariales, inyectando violaciones a propósito y confirmando que se
// detectan (nunca solo probando el camino feliz).
import type { CvFacts } from "../src/cv/cv-facts-schema.js";
import type { CvDocument } from "../src/cv/cv-document-schema.js";
import { collectFactIds, validateCvDocument } from "../src/cv/factuality.js";

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) {
    console.log(`✅ [PASSED] ${label}`);
  } else {
    console.error(`❌ [FAILED] ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};

const FACTS: CvFacts = {
  contact: { name: "Ana Ficticia", email: null, phone: null, location: null, linkedin: null },
  summary_raw: null,
  experience: [
    {
      id: "exp_1",
      title: "Ingeniera",
      company: "Empresa Uno",
      start_date: null,
      end_date: null,
      achievements: [{ id: "exp_1_bullet_1", statement: "Hizo X", metric: null }]
    }
  ],
  skills: [{ id: "skill_node", name: "Node.js", category: null }],
  education: [{ id: "edu_1", institution: "Universidad Uno", degree: "Sistemas", end_date: null }],
  certifications: [{ id: "cert_1", name: "Cert Uno", issuer: null, date: null }],
  languages: [{ id: "lang_es", name: "Español", level: "nativo" }]
};

function validDocument(): CvDocument {
  return {
    headline: { text: "Ingeniera de Software", supporting_fact_ids: ["exp_1"] },
    summary: { text: "Resumen real", supporting_fact_ids: ["exp_1_bullet_1"] },
    experience: [{ source_id: "exp_1", bullets: [{ text: "Hizo X", supporting_fact_ids: ["exp_1_bullet_1"] }] }],
    reordered_skill_ids: ["skill_node"],
    reordered_education_ids: ["edu_1"],
    reordered_certification_ids: ["cert_1"],
    omitted_fact_ids: [],
    gaps_not_to_claim: [],
    language: "es"
  };
}

function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN ADVERSARIAL — factuality.ts (sin LLM, sin DB)`);
  console.log(`==================================================\n`);

  console.log(`🔍 [Grupo 1] collectFactIds() cubre las 6 categorías (incluida languages)...`);
  {
    const ids = collectFactIds(FACTS);
    check("Incluye experience.id", ids.has("exp_1"));
    check("Incluye achievement.id", ids.has("exp_1_bullet_1"));
    check("Incluye skill.id", ids.has("skill_node"));
    check("Incluye education.id", ids.has("edu_1"));
    check("Incluye certification.id", ids.has("cert_1"));
    check("Incluye languages.id (el root project NO lo hace — este schema sí tiene ids ahí)", ids.has("lang_es"));
    check("Tamaño exacto = 6 ids", ids.size === 6, `size=${ids.size}`);
  }

  console.log(`\n🔍 [Grupo 2] Camino feliz: documento 100% respaldado → ok:true, 0 violaciones...`);
  {
    const report = validateCvDocument(validDocument(), FACTS);
    check("ok === true", report.ok === true, JSON.stringify(report.violations));
    check("violations.length === 0", report.violations.length === 0);
  }

  console.log(`\n🔍 [Grupo 3] unknown_fact_id inyectado en cada campo con ids — todos detectados...`);
  {
    const cases: [string, (d: CvDocument) => void][] = [
      ["headline.supporting_fact_ids", (d) => (d.headline.supporting_fact_ids = ["fake_id"])],
      ["summary.supporting_fact_ids", (d) => (d.summary.supporting_fact_ids = ["fake_id"])],
      ["experience[0].source_id", (d) => (d.experience[0]!.source_id = "fake_id")],
      ["experience[0].bullets[0].supporting_fact_ids", (d) => (d.experience[0]!.bullets[0]!.supporting_fact_ids = ["fake_id"])],
      ["reordered_skill_ids", (d) => (d.reordered_skill_ids = ["fake_id"])],
      ["reordered_education_ids", (d) => (d.reordered_education_ids = ["fake_id"])],
      ["reordered_certification_ids", (d) => (d.reordered_certification_ids = ["fake_id"])],
      ["omitted_fact_ids", (d) => (d.omitted_fact_ids = ["fake_id"])]
    ];
    for (const [label, mutate] of cases) {
      const doc = validDocument();
      mutate(doc);
      const report = validateCvDocument(doc, FACTS);
      check(
        `${label} con id inventado → ok:false, kind unknown_fact_id`,
        report.ok === false && report.violations.some((v) => v.kind === "unknown_fact_id"),
        JSON.stringify(report.violations)
      );
    }
  }

  console.log(`\n🔍 [Grupo 4] missing_evidence: supporting_fact_ids vacío en un Claim...`);
  {
    const doc = validDocument();
    doc.headline.supporting_fact_ids = [];
    const report = validateCvDocument(doc, FACTS);
    check(
      "headline sin ids → ok:false, kind missing_evidence",
      report.ok === false && report.violations.some((v) => v.kind === "missing_evidence"),
      JSON.stringify(report.violations)
    );
  }
  {
    const doc = validDocument();
    doc.experience[0]!.bullets[0]!.supporting_fact_ids = [];
    const report = validateCvDocument(doc, FACTS);
    check(
      "bullet sin ids → ok:false, kind missing_evidence",
      report.ok === false && report.violations.some((v) => v.kind === "missing_evidence"),
      JSON.stringify(report.violations)
    );
  }

  console.log(`\n🔍 [Grupo 5] Múltiples violaciones simultáneas se capturan todas, no solo la primera...`);
  {
    const doc = validDocument();
    doc.headline.supporting_fact_ids = ["fake_1"];
    doc.summary.supporting_fact_ids = [];
    doc.reordered_skill_ids = ["fake_2"];
    const report = validateCvDocument(doc, FACTS);
    check("3 violaciones capturadas", report.violations.length === 3, JSON.stringify(report.violations));
  }

  if (failed > 0) {
    console.error(`\n❌ [TEST SUITE FAILED] ${failed} caso(s) fallaron.`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] factuality.ts verificado adversarialmente.`);
  console.log(`==================================================\n`);
  process.exit(0);
}

main();
