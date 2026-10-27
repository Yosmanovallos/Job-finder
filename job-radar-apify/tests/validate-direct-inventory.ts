import "./require-isolated-database.js";
import { readFile } from "node:fs/promises";
import { pool } from "../src/db/client.js";
import {
  existingInventoryKeys,
  insertInventory,
  inventoryTableExists,
  jobLinkUrls,
  ownedBoardKeys,
  siteProbeRefs
} from "../src/db/direct-inventory-repository.js";
import { upsertEmployer } from "../src/db/direct-repository.js";
import { saveJobs } from "../src/db/job-repository.js";
import { collectInventory, inventoryKey, type InventorySighting } from "../src/direct/discovery/inventory.js";

/**
 * ATS board inventory, phase I1 (openspec/changes/ats-inventory-co-2026-11,
 * INV-001…INV-005) against the disposable Postgres: migration block with RLS,
 * the bounded reads, an idempotent insert-only write, case-folded
 * uniqueness, owned boards — and `jobs` / employer_sources untouched.
 */
let failures = 0;
function check(condition: boolean, pass: string, fail: string): void {
  if (condition) console.log(`OK  ${pass}`);
  else {
    console.error(`ERR ${fail}`);
    failures++;
  }
}

async function fingerprint(table: string): Promise<string> {
  const result = await pool.query(`SELECT COUNT(*)::text || ':' || COALESCE(md5(string_agg(t::text, ',' ORDER BY t::text)), '') AS f FROM ${table} t`);
  return result.rows[0].f;
}

async function run(): Promise<void> {
  console.log("\n--- Inventario de tableros ATS (I1) ---\n");
  const schema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
  for (const name of ["source-closure", "job-freshness", "direct-employers", "direct-discovery", "direct-projection"]) {
    const block = new RegExp(`-- BEGIN ${name}\\r?\\n([\\s\\S]*?)-- END ${name}`).exec(schema)?.[1];
    if (!block) throw new Error(`schema.sql no contiene el bloque ${name}`);
    await pool.query(block);
  }
  check(!(await inventoryTableExists()), "Antes de migrar, la tabla de inventario no existe.", "La tabla existía antes de migrar.");
  const inventoryBlock = /-- BEGIN direct-inventory\r?\n([\s\S]*?)-- END direct-inventory/.exec(schema)?.[1];
  check(Boolean(inventoryBlock), "schema.sql contiene el bloque direct-inventory.", "Falta el bloque direct-inventory.");
  await pool.query(inventoryBlock!);
  await pool.query(inventoryBlock!);
  const rls = await pool.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'ats_board_inventory'`);
  check(rls.rows[0]?.relrowsecurity === true, "ats_board_inventory con RLS; bloque idempotente.", "ats_board_inventory sin RLS.");

  await upsertEmployer({
    slug: "inv-owned",
    displayName: "Inv Owned",
    websiteDomain: null,
    origin: "seed",
    aliases: [],
    sources: [{ atsType: "lever", atsRef: "invowned", portalUrl: "https://jobs.lever.co/invowned", enabled: true }]
  });
  await saveJobs([
    {
      title: "Analista Inventario",
      company: "Inv Test",
      location: "Bogotá, Colombia",
      url: "https://www.linkedin.com/jobs/view/inv-test-1",
      source: "LinkedIn",
      description: "Postúlate en https://boards.greenhouse.io/InvGreen/jobs/123 o escribe a rrhh@invtest.com.co. Más en https://invtest.com.co",
      dateText: "",
      publishedAt: new Date(Date.now() - 86_400_000).toISOString(),
      country: "CO"
    },
    {
      title: "Desarrollador Inventario",
      company: "Inv Test",
      location: "Remoto",
      url: "https://jobs.lever.co/InvOwned/abc",
      source: "LinkedIn",
      description: "Vacante remota.",
      dateText: "",
      publishedAt: new Date(Date.now() - 86_400_000).toISOString()
    }
  ] as never);
  await pool.query(
    `INSERT INTO employer_discovery (company_key, company_name, evidence)
     VALUES ('invsite', 'Inv Site', $1::jsonb)`,
    [JSON.stringify({ boards: [{ method: "site", atsType: "greenhouse", atsRef: "invgreen", outcome: "verified", reason: "prueba" }, { method: "name", atsType: "lever", atsRef: "ignored", outcome: "not_found", reason: "prueba" }], site: null })]
  );

  const jobsBefore = await fingerprint("jobs");
  const sourcesBefore = await fingerprint("employer_sources");

  const urls = await jobLinkUrls(100);
  check(
    urls.some((url) => url.startsWith("https://boards.greenhouse.io/InvGreen")) && urls.some((url) => url.startsWith("https://jobs.lever.co/InvOwned")),
    "job_link extrae las URLs de ATS de la URL y la descripción.",
    `URLs inesperadas: ${urls.join(" | ")}`
  );
  check(
    urls.every((url) => !url.includes("@") && !url.includes("invtest.com.co")),
    "Ningún correo ni sitio ajeno sale de la base.",
    `Salió un enlace que no es de ATS: ${urls.join(" | ")}`
  );
  const site = await siteProbeRefs();
  check(
    site.length === 1 && site[0].atsRef === "invgreen",
    "site_probe lee solo la evidencia del método site.",
    `Refs del site probe: ${JSON.stringify(site)}`
  );

  const sightings: InventorySighting[] = [
    ...urls.map((url) => ({ url, source: "job_link" as const })),
    ...site.map((ref) => ({ ...ref, source: "site_probe" as const }))
  ];
  const rows = collectInventory(sightings);
  const owned = await ownedBoardKeys();
  const first = await insertInventory(rows, owned);
  check(first.inserted === 2, "Primera escritura: 2 tableros (mayúsculas distintas, una fila).", `Insertadas: ${JSON.stringify(first)}`);
  const second = await insertInventory(rows, owned);
  check(second.inserted === 0 && second.sourcesAdded === 0, "Repetir la misma entrada no cambia nada (INV-005).", `Segunda escritura: ${JSON.stringify(second)}`);
  const third = await insertInventory(collectInventory([{ url: "https://jobs.lever.co/invowned", source: "commoncrawl" }]), owned);
  check(third.inserted === 0 && third.sourcesAdded === 1, "Una fuente nueva solo añade su procedencia.", `Tercera escritura: ${JSON.stringify(third)}`);

  const stored = await pool.query(
    `SELECT ats_type, ats_ref, status, sources, employer_source_id IS NOT NULL AS linked FROM ats_board_inventory ORDER BY ats_type`
  );
  const green = stored.rows.find((row) => row.ats_type === "greenhouse");
  const lever = stored.rows.find((row) => row.ats_type === "lever");
  check(
    green?.status === "pending" && green.ats_ref === "invgreen" && green.sources.join(",") === "job_link,site_probe",
    "Greenhouse: pendiente, ref canónica, dos procedencias.",
    `Greenhouse: ${JSON.stringify(green)}`
  );
  check(
    lever?.status === "owned" && lever.linked === true && lever.sources.join(",") === "commoncrawl,job_link",
    "Lever ya registrado: owned y enlazado a su employer_source.",
    `Lever: ${JSON.stringify(lever)}`
  );
  check((await existingInventoryKeys()).has(inventoryKey("lever", "INVOWNED")), "La clave compara sin mayúsculas.", "La clave distingue mayúsculas.");
  let duplicateRefused = false;
  try {
    await pool.query(`INSERT INTO ats_board_inventory (ats_type, ats_ref, first_source) VALUES ('greenhouse', 'INVGREEN', 'job_link')`);
  } catch {
    duplicateRefused = true;
  }
  check(duplicateRefused, "La base rechaza el mismo tablero con otra grafía (INV-020).", "Se aceptó un tablero duplicado.");

  check((await fingerprint("jobs")) === jobsBefore, "La tabla jobs quedó intacta.", "Se modificó jobs.");
  check((await fingerprint("employer_sources")) === sourcesBefore, "employer_sources quedó intacta: nada se habilitó.", "Se modificó employer_sources.");

  await pool.query(`DELETE FROM ats_board_inventory`);
  await pool.query(`DELETE FROM employer_discovery WHERE company_key = 'invsite'`);
  await pool.query(`DELETE FROM employers WHERE slug = 'inv-owned'`);
  await pool.query(`DELETE FROM jobs WHERE company = 'Inv Test'`);
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
    console.log("\nInventario de tableros ATS: todo verde.");
  });
