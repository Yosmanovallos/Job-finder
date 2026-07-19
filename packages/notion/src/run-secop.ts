// Orchestrator: SECOP QA/AI tenders → Notion "Oportunidades" database.
// Dry-run by default (no writes, no DB creation). --execute creates/updates.
// Idempotent via a file-backed state store (var/notion/oportunidades.json).
//
// Reads NOTION_TOKEN from .env at runtime (the process, per app convention —
// never printed). This is a discovery bridge that does not require Postgres.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchSecopOpportunities } from "./secop.js";
import {
  buildOpportunityRow,
  loadState,
  saveState,
  OPPORTUNITY_SCHEMA,
  type OppState
} from "./opportunities.js";
import { createOppNotionApi } from "./opportunities-api.js";

const DB_TITLE = "Oportunidades (SECOP)";
const PARENT_PAGE_TITLE = "radar de empleo";

function readEnv(name: string, root: string): string {
  const text = readFileSync(resolve(root, ".env"), "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === name) return (m[2] ?? "").replace(/^["']|["']$/g, "");
  }
  throw new Error(`${name} no está en .env`);
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : undefined;
}

async function main(): Promise<void> {
  const root = process.env.INIT_CWD ?? process.cwd();
  const execute = process.argv.includes("--execute");
  const sinceDays = Number.parseInt(arg("since-days") ?? "60", 10);
  const limit = Number.parseInt(arg("limit") ?? "300", 10);
  const statePath = resolve(root, "var/notion/oportunidades.json");

  const { opportunities, rawCount, sinceIso } = await fetchSecopOpportunities({ sinceDays, limit });
  const rows = opportunities.map((opp) => ({ opp, row: buildOpportunityRow(opp) }));

  const state: OppState = loadState(statePath);
  const plan = { create: [] as typeof rows, update: [] as typeof rows, skip: 0 };
  for (const entry of rows) {
    const prev = state.pages[entry.opp.externalId];
    if (!prev) plan.create.push(entry);
    else if (prev.syncHash !== entry.row.syncHash) plan.update.push(entry);
    else plan.skip += 1;
  }

  const summary = {
    fuente: "SECOP II (datos.gov.co p6dx-8zbt)",
    ventana_desde: sinceIso,
    procesos_crudos: rawCount,
    oportunidades_qa_ai: opportunities.length,
    por_relevancia: {
      Alta: opportunities.filter((o) => o.relevance === "Alta").length,
      Media: opportunities.filter((o) => o.relevance === "Media").length
    },
    plan: { crear: plan.create.length, actualizar: plan.update.length, sin_cambios: plan.skip },
    muestra: rows.slice(0, 8).map(({ opp }) => ({
      relevancia: opp.relevance,
      entidad: opp.entidad,
      titulo: opp.title.slice(0, 70),
      terminos: opp.matchedTerms
    }))
  };

  if (!execute) {
    console.log(
      JSON.stringify(
        { modo: "dry-run", ...summary, nota: "Sin escrituras. Corre con --execute para crear/actualizar en Notion." },
        null,
        2
      )
    );
    return;
  }

  const token = readEnv("NOTION_TOKEN", root);
  const api = createOppNotionApi(token);

  // Ensure the Oportunidades database exists (idempotent).
  if (!state.dataSourceId) {
    const existing = await api.findDatabaseByTitle(DB_TITLE);
    if (existing) {
      state.databaseId = existing.databaseId;
      state.dataSourceId = existing.dataSourceId;
    } else {
      const parent = await api.findParentPage(PARENT_PAGE_TITLE);
      if (!parent) throw new Error(`No encuentro la página padre "${PARENT_PAGE_TITLE}" compartida con la integración.`);
      const created = await api.createDatabase(parent, DB_TITLE, OPPORTUNITY_SCHEMA);
      state.databaseId = created.databaseId;
      state.dataSourceId = created.dataSourceId;
      saveState(statePath, state);
    }
  }
  const dataSourceId = state.dataSourceId!;

  let created = 0;
  let updated = 0;
  const errors: { externalId: string; error: string }[] = [];
  for (const { opp, row } of [...plan.create, ...plan.update]) {
    try {
      const prev = state.pages[opp.externalId];
      if (prev) {
        await api.updatePage(prev.pageId, row.properties);
        state.pages[opp.externalId] = { pageId: prev.pageId, syncHash: row.syncHash };
        updated += 1;
      } else {
        const page = await api.createPage(dataSourceId, row.properties, row.children);
        state.pages[opp.externalId] = { pageId: page.id, syncHash: row.syncHash };
        created += 1;
      }
      saveState(statePath, state);
    } catch (e) {
      errors.push({ externalId: opp.externalId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  saveState(statePath, state);

  console.log(
    JSON.stringify(
      {
        modo: "execute",
        ...summary,
        resultado: { creadas: created, actualizadas: updated, errores: errors.length },
        database_id: state.databaseId,
        data_source_id: state.dataSourceId,
        errores: errors.slice(0, 5)
      },
      null,
      2
    )
  );
  if (errors.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
