/**
 * Seeds company_reputation_alias with hand-verified matches between real
 * `jobs.company` values and Great Place to Work Colombia's currently-valid
 * certifications (Fase R3, see docs/COMPANY-REPUTATION-PLAN.md §5). Same
 * methodology as scripts/seed-merco-aliases.ts: fetched the live
 * certifications feed (https://greatplacetowork.com.co/wp-json/wp/v2/certificaciones,
 * filtered to the last ~13 months — GPTW badges are valid 12 months, the
 * raw feed is a cumulative archive back to 2021), cross-referenced its
 * ~154 currently-valid company names against the ~5,000 distinct names in
 * `jobs.company`, and kept only exact matches after normalizing corporate
 * suffixes — 30 companies (35 rows counting real raw-name variants).
 * Several overlap with scripts/seed-merco-aliases.ts's companies (e.g.
 * Accenture, Deloitte, Compensar) — that's expected and fine, each row is
 * keyed by (raw_company_name, source), so a company can carry an alias for
 * both sources independently.
 *
 * Safe to re-run — upsertReputationAliases() is an idempotent upsert.
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { upsertReputationAliases, ReputationAliasInput } from "../src/db/company-reputation-repository.js";

dotenv.config();

const PAIRS: Array<{ rawCompanyName: string; canonicalName: string }> = [
  { rawCompanyName: "Accenture", canonicalName: "Accenture" },
  { rawCompanyName: "Accenture Colombia", canonicalName: "Accenture" },
  { rawCompanyName: "Accenture Ltda", canonicalName: "Accenture" },
  { rawCompanyName: "Accenture LTDA", canonicalName: "Accenture" },
  { rawCompanyName: "TP", canonicalName: "TP" },
  { rawCompanyName: "GFT Technologies", canonicalName: "GFT Technologies" },
  { rawCompanyName: "Capgemini", canonicalName: "Capgemini" },
  { rawCompanyName: "DOXA Talent", canonicalName: "DOXA Talent" },
  { rawCompanyName: "ALLIANZ SEGUROS S.A.", canonicalName: "Allianz Seguros S.A." },
  { rawCompanyName: "Siemens Healthineers", canonicalName: "Siemens Healthineers" },
  { rawCompanyName: "Salesforce", canonicalName: "Salesforce" },
  { rawCompanyName: "Cargill", canonicalName: "Cargill" },
  { rawCompanyName: "Intellias", canonicalName: "Intellias" },
  { rawCompanyName: "NEXA BPO", canonicalName: "Nexa BPO" },
  { rawCompanyName: "Cisco", canonicalName: "Cisco" },
  { rawCompanyName: "Nextant", canonicalName: "Nextant" },
  { rawCompanyName: "Cognizant", canonicalName: "Cognizant" },
  { rawCompanyName: "COMPAÑÍA MUNDIAL DE SEGUROS S.A", canonicalName: "Compañía Mundial de Seguros" },
  { rawCompanyName: "SACYR", canonicalName: "Sacyr" },
  { rawCompanyName: "FUNDACION AMANECER", canonicalName: "Fundación Amanecer" },
  { rawCompanyName: "Fundación Amanecer", canonicalName: "Fundación Amanecer" },
  { rawCompanyName: "Compensar", canonicalName: "Compensar" },
  { rawCompanyName: "Amadeus", canonicalName: "Amadeus" },
  { rawCompanyName: "SII Group Colombia", canonicalName: "Sii Group Colombia" },
  { rawCompanyName: "Banco Santander Colombia", canonicalName: "Banco Santander Colombia" },
  { rawCompanyName: "BANCO SANTANDER COLOMBIA SA", canonicalName: "Banco Santander Colombia" },
  { rawCompanyName: "Centro Comercial Santafe", canonicalName: "Centro Comercial Santafé" },
  { rawCompanyName: "Equinix", canonicalName: "Equinix Colombia" },
  { rawCompanyName: "CORREDOR EMPRESARIAL S.A.", canonicalName: "Corredor Empresarial" },
  { rawCompanyName: "Cámara de Comercio de Bucaramanga", canonicalName: "Cámara de Comercio de Bucaramanga" },
  { rawCompanyName: "Galderma", canonicalName: "Galderma" },
  { rawCompanyName: "Encora Inc.", canonicalName: "Encora" },
  { rawCompanyName: "Deloitte", canonicalName: "Deloitte" },
  { rawCompanyName: "TransUnion", canonicalName: "TransUnion" },
  { rawCompanyName: "Kuehne+Nagel", canonicalName: "Kuehne + Nagel" }
];

async function main() {
  const rows: ReputationAliasInput[] = PAIRS.map((p) => ({ ...p, source: "gptw" }));
  console.log(`🌱 [seed-gptw-aliases] Insertando/actualizando ${rows.length} alias...`);
  await upsertReputationAliases(rows);
  console.log(`✅ [seed-gptw-aliases] Listo.`);
  await pool.end();
}

main().catch((err) => {
  console.error("❌ [seed-gptw-aliases] Falló:", err);
  process.exit(1);
});
