import { test } from "node:test";
import assert from "node:assert/strict";
import type { Job } from "../src/sources/types.js";
import { applyJobFilters } from "../src/lib/job-filters.js";
import { buildSearchPlan, likeMatches, searchTitleText, titleMatchesFamilies } from "../src/lib/job-search-intent.js";
import { SEARCH_FAMILIES } from "../src/lib/job-search-families.js";

// Real titles/companies/locations from the production corpus (2026-10-31
// sample). Before family search, "AI Engineer" returned "Ingeniero Residente
// de Obra", "UX" every "Auxiliar ..." and "IA" anything located in
// "Colombia".
const rows: Array<[string, string, string]> = [
  ["Senior AI Engineer / Technical Lead", "Gorilla Logic", "Colombia"],
  ["Ingeniero(a) de IA", "Tuya S.A.", "Medellín"],
  ["Ingeniero/a de Inteligencia Artificial", "TECH Global University", "Colombia"],
  ["Senior Machine Learning Engineer", "Nu Colombia", "Bogotá"],
  ["LLM Engineer (Remote, Cali)", "Blacksmith Agency", "Cali"],
  ["Ingeniero/a MLOps y Machine Learning", "Confidencial", "Bogotá"],
  ["Data Scientist SSR.", "Mercado Libre", "Bogotá"],
  ["Docente de Inteligencia Artificial (IA)", "Kuepa Edutech", "Bogotá"],
  ["INGENIERO RESIDENTE DE OBRA (MEDELLIN)", "Industrias Pintumel SAS", "Medellín"],
  ["Ingeniero eléctrico", "Soluciones de Infraestructura y Diseño SAS", "Bogotá"],
  ["asesor comercial ventas", "MarketingyVentas.AI", "Bogotá"],
  ["Client Service Assistant", "Torre.ai", "Colombia"],
  ["Aprendiz", "Air Liquide", "Bogotá"],
  ["Gerencia de Energía", "Celsia", "Cali"],
  ["auxiliar de cocina", "sandwich qbano", "Bogotá"],
  ["UX/UI Designer", "Confidencial", "Bogotá"],
  ["Diseñador(a) ui/ux senior.", "MICHAEL PAGE INTERNATIONAL", "Bogotá"],
  ["QA Engineer - AMS", "Amadeus", "Bogotá"],
  ["Asistente Comercial y Administrativa", "QAP INGENIERIA SAS", "Bogotá"],
  ["Analista de calidad", "Stefanini LATAM", "Cundinamarca"],
  ["Lead Data Engineer - Advertising", "Truelogic", "Bogotá"],
  ["Ingeniero de Datos", "CINTE Colombia", "Bogotá"],
  ["Associate Director - Structural Engineering (Data Centers)", "AECOM", "Medellín"],
  ["Auxiliar de Enfermería Bogotá", "Health & Life Ips", "Bogotá"],
  ["Enfermera Jefa", "Clínica Nieves", "Bogotá"],
  ["Analista de Recursos Humanos", "VEOLIA COLOMBIA", "Bogotá"],
  ["Power Platform Developer SSR/Senior", "Consultora de Recursos Humanos Karina Frossasco", "Bogotá"],
  ["Desarrollador Frontend Remoto", "Mainsoft LTDA", "Remoto"],
  ["Recepcionista Front Desk", "Hotel Estelar", "Cartagena"],
  ["Ingeniero(a) de sistemas – Líder TIC", "SALUD Y BIENESTAR DEL CARIBE IPS", "Barranquilla"],
  ["Senior Circuit Design Engineer", "Cisco Systems", "Armenia"],
  ["Agente de Clasificación Arancelaria", "DHL", "Bogotá"],
  ["Asesor de ventas Tienda de Moda", "MANUFACTURAS ELIOT S.A.S", "Medellín, Antioquia"],
  ["Desarrollador Senior Java", "Bancolombia", "Medellín"]
];

const jobs: Job[] = rows.map(([title, company, location], i) => ({
  jobId: `job-${i}`,
  title,
  company,
  location,
  url: `https://example.invalid/${i}`,
  dateText: "Hace 1 hora",
  source: "LinkedIn",
  publishedAt: new Date(Date.UTC(2026, 9, 31) - i * 3_600_000).toISOString()
}));

const search = (query: string) => applyJobFilters(jobs, { search: query }).map((job) => job.title);

test("AI Engineer returns AI roles, exact role first, never generic engineers", () => {
  const titles = search("AI Engineer");
  assert.deepEqual(titles.slice(0, 3), [
    "Senior AI Engineer / Technical Lead",
    "Ingeniero(a) de IA",
    "Ingeniero/a de Inteligencia Artificial"
  ]);
  for (const related of ["Senior Machine Learning Engineer", "LLM Engineer (Remote, Cali)", "Data Scientist SSR."]) {
    assert.ok(titles.includes(related), `${related} should be listed as related`);
  }
  // Same family + role type (ML Engineer) ranks above the family alone
  // (Docente de IA) and related families (Data Scientist).
  assert.ok(titles.indexOf("Senior Machine Learning Engineer") < titles.indexOf("Docente de Inteligencia Artificial (IA)"));
  assert.ok(titles.indexOf("LLM Engineer (Remote, Cali)") < titles.indexOf("Data Scientist SSR."));
  for (const junk of ["INGENIERO RESIDENTE DE OBRA (MEDELLIN)", "Ingeniero eléctrico", "Client Service Assistant", "asesor comercial ventas"]) {
    assert.ok(!titles.includes(junk), `${junk} must not match AI Engineer`);
  }
});

test("AI and IA match the title, not companies ending in .AI nor letters inside words", () => {
  for (const query of ["AI", "IA", "ia"]) {
    const titles = search(query);
    assert.ok(titles.includes("Ingeniero(a) de IA"));
    for (const junk of ["Client Service Assistant", "Aprendiz", "Gerencia de Energía", "asesor comercial ventas", "Enfermera Jefa"]) {
      assert.ok(!titles.includes(junk), `${query} must not match ${junk}`);
    }
  }
});

test("short role words match whole words only", () => {
  assert.deepEqual(search("UX"), ["UX/UI Designer", "Diseñador(a) ui/ux senior."]);
  assert.ok(!search("QA").includes("Asistente Comercial y Administrativa"));
  assert.equal(search("QA")[0], "QA Engineer - AMS");
  // Quality roles were listed for "QA" before family search; they stay, last.
  assert.ok(search("QA").includes("Analista de calidad"));
});

test("data engineer excludes data centers and ranks the role first", () => {
  const titles = search("data engineer");
  assert.deepEqual(titles.slice(0, 2), ["Lead Data Engineer - Advertising", "Ingeniero de Datos"]);
  assert.ok(!titles.includes("Associate Director - Structural Engineering (Data Centers)"));
});

test("family searches gain related titles across Spanish and English", () => {
  assert.deepEqual(search("enfermera").sort(), ["Auxiliar de Enfermería Bogotá", "Enfermera Jefa"].sort());
  assert.deepEqual(search("recursos humanos"), ["Analista de Recursos Humanos"]);
  const sistemas = search("ingeniero de sistemas");
  assert.equal(sistemas[0], "Ingeniero(a) de sistemas – Líder TIC");
  assert.ok(sistemas.includes("Desarrollador Frontend Remoto"), "software roles are related to sistemas");
  assert.ok(!sistemas.includes("Senior Circuit Design Engineer"), "Cisco Systems is a company, not the role");
  assert.deepEqual(search("frontend"), ["Desarrollador Frontend Remoto"]);
});

test("leftover words keep the literal search, spelled as typed", () => {
  assert.deepEqual(search("AI medellín"), ["Ingeniero(a) de IA"]);
  assert.deepEqual(search("ventas medellín"), ["Asesor de ventas Tienda de Moda"]);
});

test("employer names containing a family word still find the employer", () => {
  assert.deepEqual(search("Torre.ai"), ["Client Service Assistant"]);
  assert.ok(search("Consultora de Recursos Humanos Karina Frossasco").includes("Power Platform Developer SSR/Senior"));
});

test("queries naming no family keep the literal search", () => {
  assert.equal(buildSearchPlan("Bancolombia"), null);
  assert.equal(buildSearchPlan("Senior"), null);
  assert.equal(buildSearchPlan("Desarrollador React"), null);
  assert.equal(buildSearchPlan("ingeniero"), null);
  assert.deepEqual(search("DHL"), ["Agente de Clasificación Arancelaria"]);
  assert.deepEqual(search("Bancolombia"), ["Desarrollador Senior Java"]);
  assert.equal(search("Medellín").length, 5);
});

test("every family phrase is a query trigger and matches a title containing it", () => {
  for (const family of SEARCH_FAMILIES) {
    for (const group of family.groups) {
      for (const phrase of group) {
        if (phrase.startsWith("~")) continue;
        const plan = buildSearchPlan(phrase.replace(/\*/g, ""));
        assert.ok(plan, `"${phrase}" (${family.id}) should be a query trigger`);
        const sample = `Cargo ${phrase.replace(/\*/g, "o")} senior`;
        assert.ok(
          plan.families.some((f) => titleMatchesFamilies({ ...plan, families: [f] }, sample)),
          `"${phrase}" (${family.id}) should match a title containing it`
        );
      }
    }
  }
});

test("title normalization and LIKE emulation", () => {
  assert.equal(searchTitleText("Ingeniero(a) de Sistemas – Líder TIC"), " ingeniero a de sistemas lider tic ");
  assert.equal(searchTitleText("Diseñador UX/UI"), " disenador ux ui ");
  assert.ok(likeMatches(" ingeniero a de sistemas ", "% ingenier% de sistemas %"));
  assert.ok(likeMatches("logística", "%l_g_st_c_%"));
  assert.ok(!likeMatches(" auxiliar ", "% ux %"));
  assert.ok(likeMatches("a.b", "a.b") && !likeMatches("axb", "a.b"));
});
