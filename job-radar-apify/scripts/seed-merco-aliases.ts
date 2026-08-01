/**
 * Seeds company_reputation_alias with hand-verified matches between real
 * `jobs.company` values and Merco Talento's ranking (Fase R2, see
 * docs/COMPANY-REPUTATION-PLAN.md §5). Every pair here was individually
 * confirmed this session by cross-referencing the ~5,000 distinct company
 * names in the real `jobs` table against the 200 companies in Merco's
 * ranking, normalizing only well-known corporate suffixes (S.A.S, Ltda,
 * "- Colombia", etc.) — never a loose substring/fuzzy match. A looser
 * substring pass produced 127 "candidates" with real false positives
 * ("SURA" matching "Truchas Suralá SAS", "LATAM" matching 35 unrelated
 * companies) — those are deliberately excluded. `jobs.company` is messy
 * free text (mixed case, trailing spaces, legal suffixes), so several
 * Merco companies map to more than one real raw variant (e.g. Postobón
 * appears as "Postobon" / "POSTOBON S.A" / "POSTOBON S.A.").
 *
 * Safe to re-run — upsertReputationAliases() is an idempotent upsert.
 */
import dotenv from "dotenv";
import { pool } from "../src/db/client.js";
import { upsertReputationAliases, ReputationAliasInput } from "../src/db/company-reputation-repository.js";

dotenv.config();

const PAIRS: Array<{ rawCompanyName: string; canonicalName: string }> = [
  { rawCompanyName: "Bancolombia", canonicalName: "BANCOLOMBIA" },
  { rawCompanyName: "Alpina", canonicalName: "ALPINA" },
  { rawCompanyName: "Bavaria - Colombia", canonicalName: "BAVARIA" },
  { rawCompanyName: "Sura Colombia", canonicalName: "SURA" },
  { rawCompanyName: "Mercado Libre", canonicalName: "MERCADO LIBRE" },
  { rawCompanyName: "Nestlé", canonicalName: "NESTLÉ" },
  { rawCompanyName: "avianca", canonicalName: "AVIANCA" },
  { rawCompanyName: "COLOMBINA S.A.", canonicalName: "COLOMBINA" },
  { rawCompanyName: "Pontificia Universidad Javeriana", canonicalName: "PONTIFICIA UNIVERSIDAD JAVERIANA" },
  { rawCompanyName: "Postobon", canonicalName: "POSTOBÓN" },
  { rawCompanyName: "POSTOBON S.A", canonicalName: "POSTOBÓN" },
  { rawCompanyName: "POSTOBON S.A.", canonicalName: "POSTOBÓN" },
  { rawCompanyName: "Grupo Éxito", canonicalName: "GRUPO ÉXITO" },
  { rawCompanyName: "Compensar", canonicalName: "COMPENSAR" },
  { rawCompanyName: "Google", canonicalName: "GOOGLE" },
  { rawCompanyName: "Alquería", canonicalName: "ALQUERÍA" },
  { rawCompanyName: "Comfama", canonicalName: "COMFAMA" },
  { rawCompanyName: "BANCO DE BOGOTA", canonicalName: "BANCO DE BOGOTÁ" },
  { rawCompanyName: "Banco de Bogotá", canonicalName: "BANCO DE BOGOTÁ" },
  { rawCompanyName: "COLSUBSIDIO", canonicalName: "COLSUBSIDIO" },
  { rawCompanyName: "TERPEL ", canonicalName: "TERPEL" },
  { rawCompanyName: "Protección", canonicalName: "PROTECCIÓN" },
  { rawCompanyName: "HOSPITAL PABLO TOBÓN URIBE", canonicalName: "HOSPITAL PABLO TOBÓN URIBE" },
  { rawCompanyName: "Nu Colombia", canonicalName: "NU COLOMBIA" },
  { rawCompanyName: "BBVA", canonicalName: "BBVA" },
  { rawCompanyName: "TECNOQUIMICAS S.A.S", canonicalName: "TECNOQUÍMICAS" },
  { rawCompanyName: "Claro Colombia", canonicalName: "CLARO" },
  { rawCompanyName: "CLARO COLOMBIA", canonicalName: "CLARO" },
  { rawCompanyName: "Fundación Valle del Lili", canonicalName: "FUNDACIÓN VALLE DEL LILI" },
  { rawCompanyName: "Banco de Occidente", canonicalName: "BANCO DE OCCIDENTE" },
  { rawCompanyName: "Falabella", canonicalName: "FALABELLA" },
  { rawCompanyName: "DAVIbank", canonicalName: "DAVIBANK" },
  { rawCompanyName: "Rappi", canonicalName: "RAPPI" },
  { rawCompanyName: "AMARILO", canonicalName: "AMARILO" },
  { rawCompanyName: "GRUPO BIOS S.A.S", canonicalName: "GRUPO BIOS" },
  { rawCompanyName: "CAFAM", canonicalName: "CAFAM" },
  { rawCompanyName: "CONSTRUCTORA BOLIVAR S.A.", canonicalName: "CONSTRUCTORA BOLÍVAR" },
  { rawCompanyName: "Constructora Bolívar S.A.", canonicalName: "CONSTRUCTORA BOLÍVAR" },
  { rawCompanyName: "Grupo Vanti", canonicalName: "GRUPO VANTI" },
  { rawCompanyName: "Allianz Colombia", canonicalName: "ALLIANZ COLOMBIA" },
  { rawCompanyName: "IBM", canonicalName: "IBM" },
  { rawCompanyName: "BELCORP", canonicalName: "BELCORP" },
  { rawCompanyName: "Smurfit Westrock", canonicalName: "SMURFIT WESTROCK" },
  { rawCompanyName: "Diageo", canonicalName: "DIAGEO" },
  { rawCompanyName: "PepsiCo", canonicalName: "PEPSICO" },
  { rawCompanyName: "Amazon", canonicalName: "AMAZON" },
  { rawCompanyName: "Cemex", canonicalName: "CEMEX" },
  { rawCompanyName: "Cine Colombia S.A.S", canonicalName: "CINE COLOMBIA" },
  { rawCompanyName: "Enel Colombia", canonicalName: "ENEL COLOMBIA" },
  { rawCompanyName: "Fundacion Santa Fe de Bogota", canonicalName: "FUNDACIÓN SANTA FE DE BOGOTÁ" },
  { rawCompanyName: "Fundación Santa Fe de Bogotá", canonicalName: "FUNDACIÓN SANTA FE DE BOGOTÁ" },
  { rawCompanyName: "D1 S.A.S", canonicalName: "D1" },
  { rawCompanyName: "Alianza Team®", canonicalName: "ALIANZA TEAM" },
  { rawCompanyName: "Clínica del Country", canonicalName: "CLÍNICA DEL COUNTRY" },
  { rawCompanyName: "FRISBY S.A", canonicalName: "FRISBY" },
  { rawCompanyName: "Cencosud", canonicalName: "CENCOSUD" },
  { rawCompanyName: "Roche", canonicalName: "ROCHE" },
  { rawCompanyName: "Mondelēz International", canonicalName: "MONDELĒZ INTERNATIONAL" },
  { rawCompanyName: "adidas", canonicalName: "ADIDAS" },
  { rawCompanyName: "Netflix", canonicalName: "NETFLIX" },
  { rawCompanyName: "L'Oréal", canonicalName: "L'ORÉAL" },
  { rawCompanyName: "Cueros Vélez", canonicalName: "CUEROS VÉLEZ" },
  { rawCompanyName: "Oracle", canonicalName: "ORACLE" },
  { rawCompanyName: "CONCONCRETO", canonicalName: "CONCONCRETO" },
  { rawCompanyName: "SAP", canonicalName: "SAP" },
  { rawCompanyName: "Samsung Electronics", canonicalName: "SAMSUNG ELECTRONICS" },
  { rawCompanyName: "Pfizer", canonicalName: "PFIZER" },
  { rawCompanyName: "Holcim Colombia", canonicalName: "HOLCIM" },
  { rawCompanyName: "Skandia", canonicalName: "SKANDIA" },
  { rawCompanyName: "Skandia Colombia", canonicalName: "SKANDIA" },
  { rawCompanyName: "Globant", canonicalName: "GLOBANT" },
  { rawCompanyName: "Mastercard", canonicalName: "MASTERCARD" },
  { rawCompanyName: "Casa Luker", canonicalName: "CASA LUKER" },
  { rawCompanyName: "Clínica Imbanaco", canonicalName: "CLÍNICA IMBANACO" },
  { rawCompanyName: "Quala", canonicalName: "QUALA" },
  { rawCompanyName: "Solla S.A.", canonicalName: "SOLLA" },
  { rawCompanyName: "FARMATODO COLOMBIA S.A", canonicalName: "FARMATODO" },
  { rawCompanyName: "Accenture", canonicalName: "ACCENTURE" },
  { rawCompanyName: "Accenture Colombia", canonicalName: "ACCENTURE" },
  { rawCompanyName: "Accenture Ltda", canonicalName: "ACCENTURE" },
  { rawCompanyName: "Accenture LTDA", canonicalName: "ACCENTURE" },
  { rawCompanyName: "Siemens", canonicalName: "SIEMENS" },
  { rawCompanyName: "Grupo Coomeva", canonicalName: "GRUPO COOMEVA" },
  { rawCompanyName: "Sanofi", canonicalName: "SANOFI" },
  { rawCompanyName: "Colmédica", canonicalName: "COLMÉDICA" },
  { rawCompanyName: "MARVAL S.A.", canonicalName: "MARVAL" },
  { rawCompanyName: "Deloitte", canonicalName: "DELOITTE" }
];

async function main() {
  const rows: ReputationAliasInput[] = PAIRS.map((p) => ({ ...p, source: "merco" }));
  console.log(`🌱 [seed-merco-aliases] Insertando/actualizando ${rows.length} alias...`);
  await upsertReputationAliases(rows);
  console.log(`✅ [seed-merco-aliases] Listo.`);
  await pool.end();
}

main().catch((err) => {
  console.error("❌ [seed-merco-aliases] Falló:", err);
  process.exit(1);
});
