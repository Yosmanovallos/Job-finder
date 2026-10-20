import "./require-isolated-database.js";
import { readFile } from "node:fs/promises";
import { pool } from "../src/db/client.js";
import {
  getCandidate,
  loadDirectoryCandidates,
  pickDueCandidates,
  promoteCandidate,
  recordProbe,
  rejectCandidate,
  syncCandidates
} from "../src/db/direct-discovery-repository.js";
import { upsertEmployer } from "../src/db/direct-repository.js";
import { companyKeySql } from "../src/lib/company-identity.js";
import { companyKey } from "../src/direct/discovery/company-key.js";
import type { DiscoveryCandidate, ProbeOutcome } from "../src/direct/discovery/probe.js";

/**
 * Employer discovery (docs/adr/0006-direct-employers.md §7.1) against the
 * disposable Postgres: the migration block, the directory read, the
 * insert-only promotion with every conflict refused, sticky decisions, the
 * soft revert — and `jobs` untouched. No network.
 */
let failures = 0;
function check(condition: boolean, pass: string, fail: string): void {
  if (condition) console.log(`OK  ${pass}`);
  else {
    console.error(`ERR ${fail}`);
    failures++;
  }
}

async function jobsFingerprint(): Promise<string> {
  const result = await pool.query(`SELECT COUNT(*)::text || ':' || COALESCE(md5(string_agg(id::text || title || COALESCE(company, ''), ',' ORDER BY id)), '') AS f FROM jobs`);
  return result.rows[0].f;
}

const candidate = (name: string, count = 10): DiscoveryCandidate & { domainOrigin: string | null } => ({
  companyKey: companyKey(name),
  companyName: name,
  directoryCount: count,
  websiteDomain: null,
  domainOrigin: null,
  isAgency: false
});
const outcome = (decision: ProbeOutcome["decision"]): ProbeOutcome => ({ nameProbe: "miss", siteProbe: "no_domain", decision, reason: "prueba", evidence: [], site: null });

async function run(): Promise<void> {
  console.log("\n--- Descubrimiento de empresas (D3) ---\n");

  const schema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
  for (const name of ["direct-employers", "direct-discovery"]) {
    const block = new RegExp(`-- BEGIN ${name}\\r?\\n([\\s\\S]*?)-- END ${name}`).exec(schema)?.[1];
    check(Boolean(block), `schema.sql contiene el bloque ${name}.`, `Falta el bloque ${name}.`);
    await pool.query(block!);
    await pool.query(block!);
  }
  const rls = await pool.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'employer_discovery'`);
  check(rls.rows[0]?.relrowsecurity === true, "employer_discovery con RLS activo; bloques idempotentes.", "employer_discovery sin RLS.");

  // The TS key the dry-run compares with must be the SQL key byte for byte.
  const names = ["Accenture Colombia", "ACCENTURE LTDA", "ACTIVOS S.A.S", "Bavaria - Colombia", "Universidad Nacional de Colombia", "Gente Útil S.A.", "Mondelēz International", "Grupo Éxito", "TERPEL ", "L'Oréal", "Kuehne+Nagel", "Interaseo S.A.S. E.S.P."];
  const sqlKeys = await pool.query<{ key: string }>(`SELECT ${companyKeySql("name")} AS key FROM unnest($1::text[]) WITH ORDINALITY AS t(name, i) ORDER BY i`, [names]);
  const mismatched = names.filter((name, index) => companyKey(name) !== sqlKeys.rows[index].key);
  check(mismatched.length === 0, "companyKey() en TS coincide con companyKeySql() en 12 grafías reales.", `Claves distintas: ${mismatched.join(", ")}`);

  // Directory from live job-board rows (the trigger fills company_key).
  await pool.query(
    `INSERT INTO jobs (url_hash, title, company, location, url, source, country, published_at)
     SELECT md5(random()::text || g), 'Cargo ' || g, c, 'Bogotá', 'https://example.com/d/' || md5(random()::text), 'LinkedIn', 'CO', NOW() - INTERVAL '1 day'
     FROM unnest(ARRAY['Disco Test', 'DISCO TEST S.A.S.', 'Disco Test', 'Otra Prueba', 'Confidencial']) AS c, generate_series(1, 1) AS g`
  );
  const jobsBefore = await jobsFingerprint();
  const directory = await loadDirectoryCandidates(100);
  const disco = directory.find((row) => row.companyKey === "discotest");
  check(
    disco?.directoryCount === 3 && disco.companyName === "Disco Test" && !directory.some((row) => row.companyKey.includes("confidencial")),
    "El directorio agrupa por company_key, usa la grafía más frecuente y omite nombres de relleno.",
    `Directorio inesperado: ${JSON.stringify(directory)}`
  );

  // A seeded employer already covers its candidate: `known`, never probed.
  await upsertEmployer({ slug: "seeded-co", displayName: "Seeded Co", websiteDomain: null, origin: "seed", aliases: [], sources: [{ atsType: "lever", atsRef: "seeded-co", portalUrl: "https://jobs.lever.co/seeded-co", enabled: true }] });
  const sync = await syncCandidates([candidate("Disco Test", 3), candidate("Otra Prueba", 1), candidate("Seeded Co", 5), candidate("Slug Thief", 2), candidate("Board Thief", 2)]);
  check(sync.inserted === 5 && sync.known === 1, "Sincronizar inserta candidatos y marca 'known' a los ya cubiertos.", `Sync: ${JSON.stringify(sync)}`);
  const due = await pickDueCandidates(10, 1);
  check(!due.some((row) => row.companyKey === "seededco") && due[0]?.companyKey === "discotest", "Los cubiertos no se re-sondean; el orden es por vacantes.", `Due: ${due.map((row) => row.companyKey).join(",")}`);

  // Promotion: insert-only, idempotent.
  const promoted = await promoteCandidate(candidate("Disco Test"), [{ atsType: "greenhouse", atsRef: "discotest", method: "name" }], "auto", null);
  const again = await promoteCandidate(candidate("Disco Test"), [{ atsType: "greenhouse", atsRef: "discotest", method: "name" }], "auto", null);
  const rows = await pool.query(
    `SELECT (SELECT COUNT(*)::int FROM employers WHERE slug = 'disco-test') AS employers,
            (SELECT COUNT(*)::int FROM employer_sources WHERE ats_ref = 'discotest' AND enabled) AS sources,
            (SELECT discovery_origin FROM employers WHERE slug = 'disco-test') AS origin,
            (SELECT decision FROM employer_discovery WHERE company_key = 'discotest') AS decision`
  );
  check(
    promoted.kind === "promoted" && again.kind === "promoted" && rows.rows[0].employers === 1 && rows.rows[0].sources === 1 && rows.rows[0].origin === "discovery_name" && rows.rows[0].decision === "verified",
    "Un candidato verificado crea empresa + alias + tablero habilitado una sola vez.",
    `Promoción: ${JSON.stringify({ promoted, again, ...rows.rows[0] })}`
  );

  // Conflicts never overwrite: an existing slug of another company…
  await upsertEmployer({ slug: "slug-thief", displayName: "Another Company", websiteDomain: null, origin: "seed", aliases: [], sources: [] });
  const slugConflict = await promoteCandidate(candidate("Slug Thief"), [{ atsType: "lever", atsRef: "slugthief", method: "name" }], "auto", null);
  const untouched = await pool.query(`SELECT display_name FROM employers WHERE slug = 'slug-thief'`);
  const leaked = await pool.query(`SELECT COUNT(*)::int AS n FROM employer_sources WHERE ats_ref = 'slugthief'`);
  check(
    slugConflict.kind === "conflict" && untouched.rows[0].display_name === "Another Company" && leaked.rows[0].n === 0,
    "Un slug de otra empresa no se renombra ni recibe tableros (todo se revierte).",
    `Conflicto de slug: ${JSON.stringify({ slugConflict, ...untouched.rows[0], leaked: leaked.rows[0].n })}`
  );
  // …and a board another employer owns.
  const boardConflict = await promoteCandidate(candidate("Board Thief"), [{ atsType: "greenhouse", atsRef: "discotest", method: "name" }], "auto", null);
  const owner = await pool.query(`SELECT e.slug FROM employer_sources s JOIN employers e ON e.id = s.employer_id WHERE s.ats_ref = 'discotest'`);
  const noEmployer = await pool.query(`SELECT COUNT(*)::int AS n FROM employers WHERE slug = 'board-thief'`);
  check(
    boardConflict.kind === "conflict" && owner.rows[0].slug === "disco-test" && noEmployer.rows[0].n === 0,
    "Un tablero con dueño no se reasigna y el candidato no deja empresa a medias.",
    `Conflicto de tablero: ${JSON.stringify({ boardConflict, owner: owner.rows[0], noEmployer: noEmployer.rows[0].n })}`
  );

  // Sticky decisions: an automatic probe never reopens verified.
  const overwritten = await recordProbe(candidate("Disco Test"), outcome("not_found"), 0);
  check(!overwritten && (await getCandidate("discotest"))?.decision === "verified", "Un sondeo automático no reabre un 'verified'.", "Se sobrescribió un 'verified'.");

  // Soft revert: disabled, alias retired, nothing deleted, sticky afterwards.
  const reverted = await rejectCandidate("discotest", "prueba de reversión");
  const after = await pool.query(
    `SELECT (SELECT enabled FROM employer_sources WHERE ats_ref = 'discotest') AS enabled,
            (SELECT COUNT(*)::int FROM employer_aliases WHERE company_key = 'discotest') AS aliases,
            (SELECT COUNT(*)::int FROM employers WHERE slug = 'disco-test') AS employers,
            (SELECT jsonb_array_length(history) FROM employer_discovery WHERE company_key = 'discotest') AS history`
  );
  await syncCandidates([candidate("Disco Test", 3)]);
  const stillRejected = (await getCandidate("discotest"))?.decision === "rejected";
  const reprobed = await recordProbe(candidate("Disco Test"), outcome("not_found"), 0);
  check(
    reverted.disabledBoards === 1 && reverted.aliasRetired && after.rows[0].enabled === false && after.rows[0].aliases === 0 && after.rows[0].employers === 1 && after.rows[0].history >= 2 && stillRejected && !reprobed,
    "Rechazar apaga el tablero, retira el alias, no borra nada y queda pegajoso (ni sync ni sondeo lo reabren).",
    `Reversión: ${JSON.stringify({ reverted, ...after.rows[0], stillRejected, reprobed })}`
  );

  check((await jobsFingerprint()) === jobsBefore, "La tabla jobs quedó intacta.", "Se modificó la tabla jobs.");

  await pool.query(`DELETE FROM employer_discovery`);
  await pool.query(`DELETE FROM employers WHERE slug IN ('disco-test', 'slug-thief', 'seeded-co')`);
  await pool.query(`DELETE FROM jobs WHERE company IN ('Disco Test', 'DISCO TEST S.A.S.', 'Otra Prueba', 'Confidencial')`);
}

run()
  .catch((error) => {
    console.error(error);
    failures++;
  })
  .finally(async () => {
    await pool.end();
    if (failures > 0) {
      console.error(`\n${failures} verificación(es) fallaron.`);
      process.exit(1);
    }
    console.log("\nDescubrimiento de empresas: todo verde.");
  });
