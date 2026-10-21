/**
 * Domain census, read-only (docs/adr/0006-direct-employers.md §7.1): how many
 * directory companies have a usable domain lead in what the job boards
 * already hold — an ATS host, a website or a corporate e-mail domain named
 * in their live vacancies (url + description). Measures before anyone
 * guesses: nothing is written, and an e-mail is reduced to its domain in
 * SQL (the local part never leaves the database).
 *
 *   npx tsx scripts/direct-domain-census.ts            (local DB)
 *   npx tsx scripts/direct-domain-census.ts --allow-remote-db   (workflow mode domain-census)
 */
import dotenv from "dotenv";
import { assertDirectDatabaseAllowed } from "../src/direct/db-guard.js";

dotenv.config();

// Hosts that name the job board, a social network, a free mailbox or a link
// shortener — never the employer's own site.
const NOT_EMPLOYER = [
  "linkedin.com", "computrabajo.com", "elempleo.com", "magneto365.com", "torre.ai", "torre.co", "indeed.com", "glassdoor.com",
  "jooble.org", "getonbrd.com", "getonboard.com", "remoteok.com", "remotive.com", "weremoto.com", "workana.com", "buscotrabajo.co",
  "google.com", "goo.gl", "forms.gle", "bit.ly", "wa.me", "whatsapp.com", "facebook.com", "instagram.com", "twitter.com", "x.com",
  "youtube.com", "tiktok.com", "gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "yahoo.es", "live.com", "icloud.com",
  "hotmail.es", "outlook.es", "msn.com", "apple.com", "microsoft.com", "w3.org", "schema.org", "sena.edu.co", "serviciodeempleo.gov.co"
];
const ATS_HOST = String.raw`(?:[a-z0-9-]+\.)*(?:greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|myworkdayjobs\.com|successfactors\.(?:com|eu)|gupy\.io|buk\.co|teamtailor\.com|icims\.com|eightfold\.ai)`;

async function main() {
  assertDirectDatabaseAllowed(process.env.DATABASE_URL, process.argv);
  const { pool } = await import("../src/db/client.js");
  const { isPlaceholderCompanyKeySql, storedCompanyKeySql } = await import("../src/lib/company-identity.js");
  const { liveJobSql } = await import("../src/lib/job-freshness.js");
  const client = await pool.connect();
  try {
    // Bounded: one statement, read-only transaction, 3 minutes at most.
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '180s'");
    const result = await client.query<{ company_key: string; kind: string; domain: string; n: number }>(
      `WITH keyed AS (
         SELECT ${storedCompanyKeySql()} AS company_key, url, COALESCE(left(description, 20000), '') AS description
         FROM jobs
         WHERE is_active = TRUE AND ${liveJobSql()} AND (country = 'CO' OR country IS NULL)
       ), live AS (
         SELECT * FROM keyed WHERE company_key <> '' AND NOT ${isPlaceholderCompanyKeySql("company_key")}
       ), found AS (
         SELECT company_key, 'ats' AS kind, lower(m[1]) AS domain
         FROM live, regexp_matches(url || ' ' || description, '(${ATS_HOST})', 'gi') AS m
         UNION ALL
         SELECT company_key, 'web', lower(m[1])
         FROM live, regexp_matches(description, '(?:https?://|www\\.)((?:[a-z0-9-]+\\.)+[a-z]{2,})', 'gi') AS m
         UNION ALL
         SELECT company_key, 'email', lower(m[1])
         FROM live, regexp_matches(description, '[a-z0-9._%+-]+@((?:[a-z0-9-]+\\.)+[a-z]{2,})', 'gi') AS m
       )
       SELECT company_key, kind, regexp_replace(domain, '^www\\.', '') AS domain, COUNT(*)::int AS n
       FROM found GROUP BY 1, 2, 3`
    );
    const total = await client.query<{ n: number }>(
      `SELECT COUNT(DISTINCT company_key)::int AS n FROM (
         SELECT ${storedCompanyKeySql()} AS company_key FROM jobs
         WHERE is_active = TRUE AND ${liveJobSql()} AND (country = 'CO' OR country IS NULL)
       ) keyed
       WHERE company_key <> '' AND NOT ${isPlaceholderCompanyKeySql("company_key")}`
    );
    await client.query("COMMIT");

    const atsHost = new RegExp(`^${ATS_HOST}$`, "i");
    // An ATS host is counted as ATS, never as the employer's own site.
    const isEmployerDomain = (domain: string) =>
      !atsHost.test(domain) && !NOT_EMPLOYER.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
    const byKind = { ats: new Map<string, Set<string>>(), web: new Map<string, Set<string>>(), email: new Map<string, Set<string>>() };
    // A domain named by many companies is a job board / provider, not one employer's site.
    const companiesPerDomain = new Map<string, Set<string>>();
    for (const row of result.rows) {
      if (row.kind !== "ats") {
        if (!companiesPerDomain.has(row.domain)) companiesPerDomain.set(row.domain, new Set());
        companiesPerDomain.get(row.domain)!.add(row.company_key);
      }
    }
    for (const row of result.rows) {
      const kind = row.kind as keyof typeof byKind;
      if (kind !== "ats" && (!isEmployerDomain(row.domain) || (companiesPerDomain.get(row.domain)?.size ?? 0) > 3)) continue;
      if (!byKind[kind].has(row.company_key)) byKind[kind].set(row.company_key, new Set());
      byKind[kind].get(row.company_key)!.add(row.domain);
    }
    const anyLead = new Set([...byKind.ats.keys(), ...byKind.web.keys(), ...byKind.email.keys()]);
    const companies = total.rows[0].n;
    const pct = (n: number) => (companies ? `${((n / companies) * 100).toFixed(1)} %` : "—");
    console.log(`[domain-census] Empresas del directorio (CO + remotas, vigentes): ${companies}`);
    console.log(`  con un host de ATS en sus vacantes:          ${String(byKind.ats.size).padStart(6)} (${pct(byKind.ats.size)})`);
    console.log(`  con un sitio web propio mencionado:          ${String(byKind.web.size).padStart(6)} (${pct(byKind.web.size)})`);
    console.log(`  con un dominio de correo corporativo:        ${String(byKind.email.size).padStart(6)} (${pct(byKind.email.size)})`);
    console.log(`  con al menos una pista de dominio:           ${String(anyLead.size).padStart(6)} (${pct(anyLead.size)})`);
    console.log(`  sin ninguna pista (solo búsqueda por nombre): ${String(companies - anyLead.size).padStart(5)} (${pct(companies - anyLead.size)})`);
    console.log(`  (dominios descartados por ser bolsas, redes, correos gratuitos o compartidos por > 3 empresas)`);
    const atsHosts = new Map<string, number>();
    for (const domains of byKind.ats.values()) {
      for (const domain of domains) {
        const host = domain.replace(/^.*?((?:[a-z0-9-]+\.)?(?:greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|myworkdayjobs\.com|successfactors\.(?:com|eu)|gupy\.io|buk\.co|teamtailor\.com|icims\.com|eightfold\.ai)).*$/, "$1");
        const provider = host.split(".").slice(-2).join(".");
        atsHosts.set(provider, (atsHosts.get(provider) ?? 0) + 1);
      }
    }
    console.log(`\n  ATS mencionados (empresas por proveedor): ${[...atsHosts].sort((a, b) => b[1] - a[1]).map(([host, n]) => `${host} ${n}`).join(" · ") || "ninguno"}`);
    console.log(`\n  Muestra (primeras 25 empresas con sitio o correo propio — solo dominios):`);
    for (const key of [...new Set([...byKind.web.keys(), ...byKind.email.keys()])].sort().slice(0, 25)) {
      const domains = [...(byKind.web.get(key) ?? []), ...(byKind.email.get(key) ?? [])];
      console.log(`    ${key.slice(0, 30).padEnd(31)} ${[...new Set(domains)].slice(0, 3).join(", ")}`);
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[domain-census] Falló:", (error as Error)?.message || error);
  process.exit(1);
});
