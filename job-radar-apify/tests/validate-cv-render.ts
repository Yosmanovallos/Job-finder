// Etapa F verification — no LLM (pure functions), but real round-trip:
// generate a real PDF/DOCX, then parse it back with the SAME libraries
// already proven in Fase 2a (pdf-parse/mammoth) to confirm the rendered
// text is actually extractable, not just "a well-formed file". That's
// the real ATS-friendliness question, not just valid magic bytes.
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import type { CvFacts } from "../src/cv/cv-facts-schema.js";
import type { CvDocument } from "../src/cv/cv-document-schema.js";
import { resolveCvDocumentForRender } from "../src/cv/resolve-document.js";
import { renderCvToPdf } from "../src/cv/render-pdf.js";
import { renderCvToDocx } from "../src/cv/render-docx.js";

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
  contact: { name: "Ana Ficticia Prueba", email: "ana.ficticia.prueba@example-test.com", phone: "+57 300 000 0000", location: "Bogotá, Colombia", linkedin: null },
  summary_raw: null,
  experience: [
    {
      id: "exp_1",
      title: "Ingeniera de Software",
      company: "Empresa Inventada Uno S.A.S.",
      start_date: "2021-01",
      end_date: "2023-06",
      achievements: [{ id: "exp_1_b1", statement: "Redujo el tiempo de respuesta en un 40%.", metric: "40%" }]
    }
  ],
  skills: [
    { id: "skill_node", name: "Node.js", category: null },
    { id: "skill_pg", name: "PostgreSQL", category: null }
  ],
  education: [{ id: "edu_1", institution: "Universidad Ficticia de Pruebas", degree: "Ingeniería de Sistemas", end_date: "2018" }],
  certifications: [{ id: "cert_1", name: "Certificación Ficticia en Bases de Datos", issuer: "Instituto Ficticio", date: "2020" }],
  languages: [{ id: "lang_es", name: "Español", level: "nativo" }, { id: "lang_en", name: "Inglés", level: "intermedio" }]
};

function validDocument(language: "es" | "en" = "es"): CvDocument {
  return {
    headline: { text: "Ingeniera de Software Backend", supporting_fact_ids: ["exp_1"] },
    summary: { text: "Desarrolladora con experiencia real en sistemas ficticios.", supporting_fact_ids: ["exp_1_b1"] },
    experience: [{ source_id: "exp_1", bullets: [{ text: "Redujo el tiempo de respuesta en un 40%.", supporting_fact_ids: ["exp_1_b1"] }] }],
    reordered_skill_ids: ["skill_node", "skill_pg"],
    reordered_education_ids: ["edu_1"],
    reordered_certification_ids: ["cert_1"],
    omitted_fact_ids: [],
    gaps_not_to_claim: [],
    language
  };
}

async function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN — Etapa F: render a PDF/DOCX (round-trip real, sin LLM)`);
  console.log(`==================================================\n`);

  console.log(`🔍 [Grupo 1] resolveCvDocumentForRender() — ids reales resueltos, nada inventado...`);
  {
    const resolved = resolveCvDocumentForRender(validDocument(), FACTS);
    check("contact viene literal de CvFacts", resolved.contact.name === "Ana Ficticia Prueba");
    check("experience[0].company resuelto desde el id", resolved.experience[0]?.company === "Empresa Inventada Uno S.A.S.");
    check("experience[0].title resuelto desde el id", resolved.experience[0]?.title === "Ingeniera de Software");
    check("skills resueltos en el orden de reordered_skill_ids", JSON.stringify(resolved.skills) === JSON.stringify(["Node.js", "PostgreSQL"]));
    check("education resuelto", resolved.education[0]?.institution === "Universidad Ficticia de Pruebas");
    check("certifications resuelto", resolved.certifications[0]?.name === "Certificación Ficticia en Bases de Datos");
    check("languages viene directo de CvFacts (CvDocument no tiene campo de idiomas)", resolved.languages.length === 2);
  }
  {
    const doc = validDocument();
    doc.reordered_skill_ids = ["skill_node", "fake_skill_no_existe"];
    const resolved = resolveCvDocumentForRender(doc, FACTS);
    check("Un id inexistente se omite silenciosamente, nunca se inventa un nombre", resolved.skills.length === 1 && resolved.skills[0] === "Node.js", JSON.stringify(resolved.skills));
  }

  console.log(`\n🔍 [Grupo 2] PDF real — generado y vuelto a leer con pdf-parse...`);
  {
    const buf = await renderCvToPdf(validDocument(), FACTS);
    check("Bytes con magic %PDF-", buf.subarray(0, 5).toString("latin1") === "%PDF-");
    const parser = new PDFParse({ data: buf });
    try {
      const result = await parser.getText();
      const text = result.text;
      check("El texto extraído contiene el nombre real", text.includes("Ana Ficticia Prueba"), text.slice(0, 200));
      check("Contiene el email real", text.includes("ana.ficticia.prueba@example-test.com"));
      check("Contiene la empresa real (resuelta desde el id)", text.includes("Empresa Inventada Uno S.A.S."));
      check("Contiene el bullet con la métrica real (40%)", text.includes("40%"));
      check("Contiene las skills reales", text.includes("Node.js") && text.includes("PostgreSQL"));
      check("Contiene la institución educativa real", text.includes("Universidad Ficticia de Pruebas"));
      check("Contiene el encabezado de sección en español", text.includes("EXPERIENCIA"));
    } finally {
      await parser.destroy();
    }
  }

  console.log(`\n🔍 [Grupo 3] PDF en inglés — encabezados de sección cambian...`);
  {
    const buf = await renderCvToPdf(validDocument("en"), FACTS);
    const parser = new PDFParse({ data: buf });
    try {
      const text = (await parser.getText()).text;
      check("Encabezado en inglés (EXPERIENCE, no EXPERIENCIA)", text.includes("EXPERIENCE") && !text.includes("EXPERIENCIA"));
    } finally {
      await parser.destroy();
    }
  }

  console.log(`\n🔍 [Grupo 4] DOCX real — generado y vuelto a leer con mammoth...`);
  {
    const buf = await renderCvToDocx(validDocument(), FACTS);
    check("Bytes con magic ZIP (PK\\x03\\x04)", buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04);
    const result = await mammoth.extractRawText({ buffer: buf });
    const text = result.value;
    check("El texto extraído contiene el nombre real", text.includes("Ana Ficticia Prueba"), text.slice(0, 200));
    check("Contiene la empresa real (resuelta desde el id)", text.includes("Empresa Inventada Uno S.A.S."));
    check("Contiene el bullet con la métrica real (40%)", text.includes("40%"));
    check("Contiene la certificación real", text.includes("Certificación Ficticia en Bases de Datos"));
    check("Contiene los idiomas reales (no están en CvDocument, vienen de CvFacts)", text.includes("Español") && text.includes("Inglés"));
  }

  if (failed > 0) {
    console.error(`\n❌ [TEST SUITE FAILED] ${failed} caso(s) fallaron.`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] Etapa F verificada: PDF y DOCX generados de verdad extraen texto real, nada inventado.`);
  console.log(`==================================================\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ [FAILED] Error inesperado en la suite:", err);
  process.exit(1);
});
