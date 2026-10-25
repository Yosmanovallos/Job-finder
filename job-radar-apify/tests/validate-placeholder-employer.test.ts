import { test } from "node:test";
import assert from "node:assert/strict";
import { companyKey, isPlaceholderEmployer, isPlaceholderKey } from "../src/lib/company-key.js";
import { isPlaceholderCompanyKeySql } from "../src/lib/company-identity.js";
import { buildCategoryInsights, type SeoJob } from "../src/lib/job-seo.js";

const PLACEHOLDERS = [
  "Confidencial",
  "-Confidencial-",
  "Empresa Confidencial",
  "Confidential",
  "CONFIDENTIAL",
  "Confidential Careers",
  "Empresa Reservada",
  "Reservado",
  "Anónima S.A.S.",
  "Reserved",
  "Anonymous",
  "Undisclosed",
  null
];
const REAL_EMPLOYERS = ["Confidence Group", "Confianza Seguros", "Reserva del Mar", "Accenture", "Anonymous Content Studio"];

test("undisclosed employers are placeholders in every spelling", () => {
  for (const name of PLACEHOLDERS) assert.equal(isPlaceholderEmployer(name), true, String(name));
});

test("real employers that merely look similar are not placeholders", () => {
  for (const name of REAL_EMPLOYERS) assert.equal(isPlaceholderEmployer(name), false, name);
});

test("the SQL predicate lists the same exact keys and substrings as the TS twin", () => {
  const sql = isPlaceholderCompanyKeySql("k");
  const exact = [...sql.matchAll(/'([a-z]*)'/g)].map((m) => m[1]).filter((key) => !key.includes("%"));
  for (const key of exact) assert.equal(isPlaceholderKey(key), true, key);
  assert.match(sql, /LIKE '%confidencial%'/);
  assert.match(sql, /LIKE '%confidential%'/);
  for (const name of PLACEHOLDERS) {
    const key = companyKey(name);
    const bySql = key.includes("confidencial") || key.includes("confidential") || exact.includes(key);
    assert.equal(bySql, true, String(name));
  }
});

test("city insights do not count a placeholder as one more company", () => {
  const base = { source: "Computrabajo", country: "CO", location: "Neiva", title: "Auxiliar" } as unknown as SeoJob;
  const jobs = [
    { ...base, jobId: "a", company: "Confidencial" },
    { ...base, jobId: "b", company: "Confidential Careers" },
    { ...base, jobId: "c", company: "Accenture" }
  ] as SeoJob[];
  const insights = buildCategoryInsights({ kind: "ciudad", label: "Neiva", country: "CO" }, 3, jobs);
  assert.equal(insights.companyCount, 1);
  assert.deepEqual(insights.topCompanies, ["Accenture"]);
});
