import "./require-isolated-database.js";
import { readFile } from "node:fs/promises";
import { pool } from "../src/db/client.js";
import {
  enablementContext,
  getInventoryBoard,
  inventoryStatusCounts,
  listInventoryForReview,
  ownedBoardKeys,
  pickDueInventory,
  promoteInventoryBoard,
  readOnly,
  recordInventoryProbe,
  revertInventoryBoards
} from "../src/db/direct-inventory-repository.js";
import { upsertEmployer } from "../src/db/direct-repository.js";
import { saveJobs } from "../src/db/job-repository.js";
import { inventoryKey } from "../src/direct/discovery/inventory.js";
import { readBoard, reviewVerdict, runInventoryProbe, type InventoryBoard, type ProbeRunDeps } from "../src/direct/discovery/inventory-probe.js";
import type { HttpGet } from "../src/direct/types.js";

/**
 * ATS inventory probe, phase I2 (openspec/changes/ats-inventory-co-2026-11,
 * INV-010…INV-014) against the disposable Postgres, with fixture HTTP:
 * insert-only enablement with the ATS-declared name, ownership conflicts,
 * agency, a block that is not no_colombia, the status guard, idempotent
 * re-runs, a dry run that writes nothing — and `jobs` / employer_discovery
 * untouched.
 */
let failures = 0;
function check(condition: boolean, pass: string, fail: string): void {
  if (condition) console.log(`OK  ${pass}`);
  else {
    console.error(`ERR ${fail}`);
    failures++;
  }
}

async function fingerprint(table: string, columns = "t"): Promise<string> {
  const result = await pool.query(`SELECT COUNT(*)::text || ':' || COALESCE(md5(string_agg((${columns})::text, ',' ORDER BY (${columns})::text)), '') AS f FROM ${table} t`);
  return result.rows[0].f;
}

const RECENT = new Date(Date.now() - 2 * 86_400_000).toUTCString();
function feed(company: string, countries: string[]): string {
  const items = countries
    .map((country, index) => `<item><title>Puesto ${index}</title><link>https://x.teamtailor.com/jobs/${100 + index}-p</link><pubDate>${RECENT}</pubDate><tt:country>${country}</tt:country></item>`)
    .join("");
  return `<rss version="2.0"><channel><title>${company}</title>${items}</channel></rss>`;
}
const tt = (ref: string) => `https://${ref}.teamtailor.com/jobs.rss?per_page=100&offset=0`;
const BOARDS: Record<string, { status: number; body: string }> = {
  [tt("prbacme")]: { status: 200, body: feed("Prbacme Colombia SAS", ["Colombia", "Colombia", "Colombia"]) },
  [tt("prbacme2")]: { status: 200, body: feed("PRBACME S.A.S.", ["Colombia"]) },
  [tt("prbgamma")]: { status: 200, body: feed("Prbgamma Energy", ["Colombia"]) },
  [tt("prbdelta")]: { status: 200, body: feed("Prbdelta Foods", ["Colombia"]) },
  [tt("prbabroad")]: { status: 200, body: feed("Prbabroad Ltd", ["Spain"]) },
  [tt("prbadecco")]: { status: 200, body: feed("Adecco", ["Colombia"]) },
  [tt("prbrejected")]: { status: 200, body: feed("Prbrejected Corp", ["Colombia"]) },
  [tt("prbblocked")]: { status: 403, body: "" },
  [tt("prbowned")]: { status: 200, body: feed("Prbowned Inc", ["Colombia"]) },
  [tt("prbzeta")]: { status: 200, body: feed("Prbzeta Labs", ["Colombia"]) },
  "https://api.ashbyhq.com/posting-api/job-board/prbnoname": {
    status: 200,
    body: JSON.stringify({ jobs: [{ id: "a1", title: "Backend", jobUrl: "https://jobs.ashbyhq.com/prbnoname/a1", location: "Bogotá, Colombia", publishedAt: new Date(Date.now() - 86_400_000).toISOString() }] })
  }
};
const calls: string[] = [];
const http: HttpGet = async (url) => {
  calls.push(url);
  return BOARDS[url] ?? { status: 404, body: "" };
};

async function deps(execute: boolean, agencyKeys: Set<string>): Promise<ProbeRunDeps> {
  const owned = await ownedBoardKeys();
  return {
    http,
    now: () => new Date(),
    agencyKeys,
    execute,
    maxEnable: 25,
    deadlineAt: Date.now() + 60_000,
    concurrency: 3,
    isOwned: (board) => owned.has(inventoryKey(board.atsType, board.atsRef)),
    context: (board, verdict) => readOnly((query) => enablementContext(query, board, verdict)),
    promote: (board, verdict) => promoteInventoryBoard(board, verdict),
    record: async (board, outcome) => {
      await recordInventoryProbe(board, outcome);
    },
    log: () => undefined
  };
}

async function statusOf(ref: string): Promise<Record<string, unknown> | undefined> {
  const result = await pool.query(
    `SELECT status, status_reason, declared_name, colombia_count, total_count, probe_attempts, last_probed_at IS NOT NULL AS probed,
            CASE WHEN next_probe_at IS NULL THEN NULL ELSE round(extract(epoch FROM next_probe_at - NOW()) / 86400)::int END AS days,
            employer_source_id IS NOT NULL AS linked
       FROM ats_board_inventory WHERE ats_type = 'teamtailor' AND ats_ref = $1`,
    [ref]
  );
  return result.rows[0];
}

async function run(): Promise<void> {
  console.log("\n--- Sondeo y habilitación del inventario ATS (I2) ---\n");
  const schema = await readFile(new URL("../src/db/schema.sql", import.meta.url), "utf8");
  for (const name of ["source-closure", "job-freshness", "direct-employers", "direct-discovery", "direct-projection", "direct-inventory"]) {
    const block = new RegExp(`-- BEGIN ${name}\\r?\\n([\\s\\S]*?)-- END ${name}`).exec(schema)?.[1];
    if (!block) throw new Error(`schema.sql no contiene el bloque ${name}`);
    await pool.query(block);
  }
  const agencyKeys = new Set(["adecco"]);

  // Existing employers: one already reads a Teamtailor board, one reads only Lever, one owns a board.
  await upsertEmployer({ slug: "prbgamma-energy", displayName: "Prbgamma Energy", websiteDomain: null, origin: "seed", aliases: ["Prbgamma Energy"], sources: [{ atsType: "teamtailor", atsRef: "prbgamma-old", portalUrl: "https://prbgamma-old.teamtailor.com/jobs", enabled: false }] });
  await upsertEmployer({ slug: "prbdelta-foods", displayName: "Prbdelta Foods", websiteDomain: null, origin: "seed", aliases: ["Prbdelta Foods"], sources: [{ atsType: "lever", atsRef: "prbdelta", portalUrl: "https://jobs.lever.co/prbdelta", enabled: true }] });
  await upsertEmployer({ slug: "prbowner", displayName: "Prbowner", websiteDomain: null, origin: "seed", aliases: [], sources: [{ atsType: "teamtailor", atsRef: "PrbOwned", portalUrl: "https://prbowned.teamtailor.com/jobs", enabled: true }] });
  await pool.query(`INSERT INTO employer_discovery (company_key, company_name, decision) VALUES ('prbrejected', 'Prbrejected Corp', 'rejected')`);
  await saveJobs([
    { title: "Analista Sondeo", company: "Prbacme", location: "Bogotá, Colombia", url: "https://www.linkedin.com/jobs/view/prb-1", source: "LinkedIn", description: "x", dateText: "", publishedAt: new Date(Date.now() - 86_400_000).toISOString(), country: "CO" }
  ] as never);

  const refs = ["prbacme", "prbacme2", "prbgamma", "prbdelta", "prbabroad", "prbadecco", "prbrejected", "prbblocked", "prbowned"];
  await pool.query(
    `INSERT INTO ats_board_inventory (ats_type, ats_ref, first_source, sources, status)
     SELECT 'teamtailor', ref, 'commoncrawl', ARRAY['commoncrawl'], 'pending' FROM unnest($1::text[]) AS ref`,
    [refs]
  );
  // Rows a probe must never pick: a human decision and an unreadable board.
  await pool.query(
    `INSERT INTO ats_board_inventory (ats_type, ats_ref, first_source, sources, status, status_reason)
     VALUES ('teamtailor', 'prbheld', 'commoncrawl', ARRAY['commoncrawl'], 'ambiguous', 'revisión humana'),
            ('gupy', 'prbgupy', 'commoncrawl', ARRAY['commoncrawl'], 'unsupported_ats', NULL)`
  );

  const jobsBefore = await fingerprint("jobs");
  const discoveryBefore = await fingerprint("employer_discovery");
  const ownerSourcesBefore = await fingerprint("employer_sources", "t.ats_type, t.ats_ref, t.employer_id, t.enabled, t.portal_url");

  // Dry run first: probes, writes nothing.
  const inventoryBefore = await fingerprint("ats_board_inventory");
  const employersBefore = await fingerprint("employers");
  const due = await pickDueInventory(100);
  check(due.length === refs.length && !due.some((row) => ["prbheld", "prbgupy"].includes(row.atsRef)), "Solo se eligen filas pendientes de un ATS con conector.", `Elegidas: ${due.map((row) => row.atsRef).join(",")}`);
  const dry = await runInventoryProbe(due, await deps(false, agencyKeys));
  check(
    (await fingerprint("ats_board_inventory")) === inventoryBefore && (await fingerprint("employers")) === employersBefore && (await fingerprint("employer_sources", "t.ats_type, t.ats_ref, t.employer_id, t.enabled, t.portal_url")) === ownerSourcesBefore,
    `Dry-run: nada escrito (${JSON.stringify(dry.byStatus)}).`,
    "El dry-run escribió en la base."
  );

  const summary = await runInventoryProbe(await pickDueInventory(100), await deps(true, agencyKeys));
  check(summary.probed === refs.length && summary.enabled === 2, `Ejecución: ${summary.probed} sondeados, ${summary.enabled} habilitados.`, `Resumen: ${JSON.stringify(summary)}`);
  const sorted = (counts: Record<string, number>) => JSON.stringify(Object.entries(counts).sort());
  check(sorted(summary.byStatus) === sorted(dry.byStatus),"El dry-run anticipó exactamente los mismos estados.", `dry ${JSON.stringify(dry.byStatus)} vs execute ${JSON.stringify(summary.byStatus)}`);

  const acme = await statusOf("prbacme");
  const acme2 = await statusOf("prbacme2");
  const winner = acme?.status === "enabled" ? acme : acme2;
  const loser = acme?.status === "enabled" ? acme2 : acme;
  check(winner?.status === "enabled" && winner.linked === true && winner.days === null, "Un tablero con nombre declarado y vacantes en Colombia queda habilitado y enlazado.", `prbacme: ${JSON.stringify(acme)}`);
  check(loser?.status === "ambiguous", "El segundo tablero del mismo ATS con la misma empresa queda ambiguous.", `prbacme2: ${JSON.stringify(loser)}`);
  const created = await pool.query(
    `SELECT e.display_name, e.discovery_origin, e.company_key, a.company_key AS alias, s.ats_ref, s.enabled
       FROM employers e JOIN employer_aliases a ON a.employer_id = e.id JOIN employer_sources s ON s.employer_id = e.id
      WHERE e.company_key = 'prbacme'`
  );
  check(
    created.rowCount === 1 && created.rows[0].discovery_origin === "ats_inventory" && created.rows[0].alias === "prbacme" && created.rows[0].enabled === true &&
      ["Prbacme Colombia SAS", "PRBACME S.A.S."].includes(created.rows[0].display_name),
    "Empresa nueva con el nombre que declara el ATS, origen ats_inventory, alias exacto y tablero habilitado.",
    `Empresa creada: ${JSON.stringify(created.rows)}`
  );
  const delta = await pool.query(
    `SELECT COUNT(DISTINCT e.id)::int AS employers, array_agg(s.ats_type || ':' || s.ats_ref ORDER BY s.ats_type) AS boards
       FROM employers e JOIN employer_sources s ON s.employer_id = e.id WHERE e.company_key = 'prbdeltafoods'`
  );
  check(
    delta.rows[0].employers === 1 && delta.rows[0].boards.join(",") === "lever:prbdelta,teamtailor:prbdelta" && (await statusOf("prbdelta"))?.status === "enabled",
    "Una empresa existente sin tablero de ese ATS lo gana; no se crea otra.",
    `prbdelta: ${JSON.stringify(delta.rows[0])}`
  );
  check((await statusOf("prbgamma"))?.status === "ambiguous", "La empresa ya tiene otro tablero del mismo ATS (aunque apagado): ambiguous.", `prbgamma: ${JSON.stringify(await statusOf("prbgamma"))}`);
  check((await statusOf("prbrejected"))?.status === "ambiguous", "Una empresa rechazada por revisión humana no se habilita.", `prbrejected: ${JSON.stringify(await statusOf("prbrejected"))}`);
  check((await statusOf("prbadecco"))?.status === "agency", "El nombre de una agencia queda agency.", `prbadecco: ${JSON.stringify(await statusOf("prbadecco"))}`);
  const abroad = await statusOf("prbabroad");
  check(abroad?.status === "no_colombia" && abroad.colombia_count === 0 && abroad.total_count === 1 && abroad.days === 30 && abroad.declared_name === "Prbabroad Ltd", "Listado completo sin Colombia: no_colombia con evidencia y recheck a 30 días.", `prbabroad: ${JSON.stringify(abroad)}`);
  const blocked = await statusOf("prbblocked");
  check(blocked?.status === "blocked" && blocked.days === 1 && blocked.colombia_count === null && blocked.probe_attempts === 1, "Un 403 es blocked con backoff, nunca no_colombia.", `prbblocked: ${JSON.stringify(blocked)}`);
  const owned = await statusOf("prbowned");
  check(owned?.status === "owned" && owned.linked === true && !calls.includes(tt("prbowned")), "Un tablero ya registrado (otra grafía) queda owned, enlazado, sin pedirlo al ATS.", `prbowned: ${JSON.stringify(owned)}`);
  const held = await statusOf("prbheld");
  check(held?.status === "ambiguous" && held.status_reason === "revisión humana" && held.probed === false, "Una decisión existente no se toca.", `prbheld: ${JSON.stringify(held)}`);

  // The database guards hold even if the run's own checks were skipped.
  const acme2Board: InventoryBoard = { id: (await pool.query(`SELECT id FROM ats_board_inventory WHERE ats_ref = $1`, [loser === acme ? "prbacme" : "prbacme2"])).rows[0].id, atsType: "teamtailor", atsRef: loser === acme ? "prbacme" : "prbacme2", probeAttempts: 0 };
  await pool.query(`UPDATE ats_board_inventory SET status = 'pending' WHERE id = $1`, [acme2Board.id]);
  const direct = await promoteInventoryBoard(acme2Board, { status: "eligible", companyKey: "prbacme", declaredName: "Prbacme", colombiaCount: 1, totalCount: 1, reason: "prueba" });
  check(direct.kind === "conflict" && direct.status === "ambiguous", "La promoción en la base rechaza un segundo tablero del mismo ATS para la misma clave.", `Promoción directa: ${JSON.stringify(direct)}`);
  const enabledId = (await pool.query(`SELECT id FROM ats_board_inventory WHERE status = 'enabled' LIMIT 1`)).rows[0].id;
  const overwritten = await recordInventoryProbe({ id: enabledId, atsType: "teamtailor", atsRef: "x", probeAttempts: 0 }, { status: "no_colombia", reason: "x", declaredName: null, colombiaCount: 0, totalCount: 0, nextProbeDays: 30 });
  check(!overwritten, "Un tablero habilitado nunca vuelve a otro estado por un sondeo.", "Se sobrescribió un tablero habilitado.");
  await pool.query(`UPDATE ats_board_inventory SET status = 'ambiguous' WHERE id = $1`, [acme2Board.id]);

  // Idempotent: nothing is due again, so a second run reads and writes nothing.
  const afterFirst = [await fingerprint("ats_board_inventory"), await fingerprint("employers"), await fingerprint("employer_sources"), await fingerprint("employer_aliases")];
  const again = await runInventoryProbe(await pickDueInventory(100), await deps(true, agencyKeys));
  const afterSecond = [await fingerprint("ats_board_inventory"), await fingerprint("employers"), await fingerprint("employer_sources"), await fingerprint("employer_aliases")];
  check(again.probed === 0 && afterSecond.join() === afterFirst.join(), "Repetir la corrida no cambia nada (nada vence hoy).", `Segunda corrida: ${JSON.stringify(again)}`);

  // The cap: a new eligible board over --max-enable stays pending, untouched.
  await pool.query(`INSERT INTO ats_board_inventory (ats_type, ats_ref, first_source, sources) VALUES ('teamtailor', 'prbzeta', 'commoncrawl', ARRAY['commoncrawl'])`);
  const capped = await runInventoryProbe(await pickDueInventory(100), { ...(await deps(true, agencyKeys)), maxEnable: 0 });
  const zeta = await statusOf("prbzeta");
  check(capped.deferred === 1 && zeta?.status === "pending" && zeta.probed === false, "Sobre el tope --max-enable el tablero queda pendiente, sin escribir.", `prbzeta: ${JSON.stringify(zeta)} / ${JSON.stringify(capped)}`);

  // Order: a board whose ATS declares a name goes before one that never can.
  await pool.query(
    `INSERT INTO ats_board_inventory (ats_type, ats_ref, first_source, sources) VALUES ('ashby', 'aaprbfirst', 'commoncrawl', ARRAY['commoncrawl']), ('teamtailor', 'zzprblast', 'commoncrawl', ARRAY['commoncrawl'])`
  );
  const ordered = (await pickDueInventory(100)).map((row) => row.atsRef).filter((ref) => ["aaprbfirst", "zzprblast"].includes(ref));
  check(ordered.join(",") === "zzprblast,aaprbfirst", "Los ATS que declaran nombre se sondean antes que Ashby.", `Orden: ${ordered.join(",")}`);
  await pool.query(`DELETE FROM ats_board_inventory WHERE ats_ref IN ('aaprbfirst', 'zzprblast')`);

  // Human review: an Ashby board (no declared name) approved under the name a person states.
  await pool.query(
    `INSERT INTO ats_board_inventory (ats_type, ats_ref, first_source, sources, status, status_reason, colombia_count, total_count)
     VALUES ('ashby', 'prbnoname', 'commoncrawl', ARRAY['commoncrawl'], 'ambiguous', 'ashby no declara el nombre de la empresa', 1, 1)`
  );
  const review = await listInventoryForReview(["ambiguous"], 50);
  check(review.some((row) => row.atsRef === "prbnoname" && row.colombiaCount === 1), "La lista de revisión muestra los ambiguous con su evidencia.", `Lista: ${JSON.stringify(review.map((row) => row.atsRef))}`);
  const noName = (await getInventoryBoard("ashby", "PRBNONAME"))!;
  const human = reviewVerdict("Prbnoname Payments", await readBoard(noName, http, new Date()), agencyKeys);
  const approved = human.status === "eligible" ? await promoteInventoryBoard(noName, human, ["ambiguous"]) : null;
  const approvedRow = await getInventoryBoard("ashby", "prbnoname");
  const approvedEmployer = await pool.query(`SELECT display_name, discovery_origin FROM employers WHERE company_key = 'prbnonamepayments'`);
  check(
    approved?.kind === "enabled" && approvedRow?.status === "enabled" && approvedEmployer.rows[0]?.display_name === "Prbnoname Payments" && approvedEmployer.rows[0]?.discovery_origin === "ats_inventory",
    "Aprobación humana: el ambiguous queda habilitado con el nombre dado (insert-only).",
    `Aprobación: ${JSON.stringify({ approved, approvedRow, employer: approvedEmployer.rows })}`
  );
  const automatic = human.status === "eligible" ? await promoteInventoryBoard(noName, human) : null;
  check(automatic?.kind === "conflict", "La vía automática nunca toca un tablero ya habilitado.", `Automática: ${JSON.stringify(automatic)}`);

  // Rollback: dry run lists, execute switches the inventory's boards off; nothing deleted.
  const employersBeforeRevert = await fingerprint("employers");
  const enabledBoards = (await pool.query(`SELECT COUNT(*)::int AS n FROM ats_board_inventory WHERE status = 'enabled'`)).rows[0].n;
  const preview = await revertInventoryBoards(null, "prueba", true);
  const stillEnabled = (await pool.query(`SELECT COUNT(*)::int AS n FROM employer_sources s JOIN ats_board_inventory i ON i.employer_source_id = s.id WHERE i.status = 'enabled' AND s.enabled`)).rows[0].n;
  check(preview.boards.length === enabledBoards && stillEnabled === enabledBoards, `Reversión dry-run: listaría ${preview.boards.length} tableros sin escribir.`, `Dry-run: ${JSON.stringify(preview)} / ${stillEnabled}`);
  const one = await revertInventoryBoards({ atsType: "ashby", atsRef: "PRBNONAME" }, "nombre equivocado", false);
  const oneRow = await getInventoryBoard("ashby", "prbnoname");
  const oneSource = await pool.query(`SELECT enabled FROM employer_sources WHERE ats_type = 'ashby' AND ats_ref = 'prbnoname'`);
  check(
    one.boards.join() === "ashby:prbnoname" && oneRow?.status === "ambiguous" && /revertido.*nombre equivocado/.test(oneRow.reason ?? "") && oneSource.rows[0]?.enabled === false,
    "Reversión de un tablero: apagado, fila ambiguous con el motivo.",
    `Reversión: ${JSON.stringify({ one, oneRow, source: oneSource.rows })}`
  );
  const all = await revertInventoryBoards(null, "lote equivocado", false);
  const left = (await pool.query(`SELECT COUNT(*)::int AS n FROM employer_sources s JOIN ats_board_inventory i ON i.employer_source_id = s.id WHERE s.enabled AND i.status <> 'owned'`)).rows[0].n;
  check(all.boards.length === enabledBoards - 1 && left === 0, `Reversión total: ${all.boards.length} tableros apagados.`, `Total: ${JSON.stringify(all)} / encendidos ${left}`);
  check((await fingerprint("employers")) === employersBeforeRevert, "La reversión no borra ni cambia empresas.", "La reversión cambió employers.");
  const again2 = await revertInventoryBoards(null, "otra vez", false);
  check(again2.boards.length === 0, "Revertir de nuevo no cambia nada.", `Segunda reversión: ${JSON.stringify(again2)}`);
  const reapproved = human.status === "eligible" ? await promoteInventoryBoard(noName, human, ["ambiguous"]) : null;
  check(reapproved?.kind === "conflict" && reapproved.status === "owned", "Un tablero revertido no se reactiva por aprobación: queda su employer_source apagado.", `Re-aprobación: ${JSON.stringify(reapproved)}`);

  check((await fingerprint("jobs")) === jobsBefore, "La tabla jobs quedó intacta.", "Se modificó jobs.");
  check((await fingerprint("employer_discovery")) === discoveryBefore, "employer_discovery quedó intacta.", "Se modificó employer_discovery.");
  const preexisting = await pool.query(
    `SELECT COUNT(*)::int AS n FROM employer_sources WHERE (ats_type, ats_ref) IN (('teamtailor', 'prbgamma-old'), ('lever', 'prbdelta'), ('teamtailor', 'PrbOwned'))
        AND ((ats_ref = 'prbgamma-old' AND NOT enabled) OR (ats_ref <> 'prbgamma-old' AND enabled))`
  );
  check(preexisting.rows[0].n === 3, "Los tableros existentes no cambiaron (insert-only).", "Se modificó un tablero existente.");
  const counts = await inventoryStatusCounts();
  check(!counts.enabled && counts.unsupported_ats === 1, `Conteo por estado tras revertir: ${JSON.stringify(counts)}.`, `Conteo inesperado: ${JSON.stringify(counts)}`);

  await pool.query(`DELETE FROM ats_board_inventory`);
  await pool.query(`DELETE FROM employer_discovery WHERE company_key = 'prbrejected'`);
  await pool.query(`DELETE FROM employers WHERE slug LIKE 'prb%' OR discovery_origin = 'ats_inventory'`);
  await pool.query(`DELETE FROM jobs WHERE company = 'Prbacme'`);
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
    console.log("\nSondeo del inventario ATS: todo verde.");
  });
