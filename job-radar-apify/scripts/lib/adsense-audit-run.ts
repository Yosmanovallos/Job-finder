// One audit run: crawl → (browser) → rules → report. Shared by the CLI
// (`npm run adsense:audit`, `--live`, `--base-url`) and the isolated suite.
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FIXED_PAGES,
  GetFetcher,
  collectFacts,
  observeInBrowser,
  type FetcherOptions,
  type SamplePlan
} from "./adsense-audit-crawl.js";
import {
  diffAgainst,
  evaluateRules,
  exitCodeFor,
  renderSummary,
  summarize,
  type AuditAttestations,
  type AuditSummary,
  type Estado,
  type RuleResult,
  type SiteFacts
} from "./adsense-audit-rules.js";

export interface AuditOptions extends FetcherOptions {
  mode: SiteFacts["mode"];
  browser: boolean;
  plan?: Partial<SamplePlan>;
  attestations?: AuditAttestations;
  expected?: Record<string, Estado>;
}

export interface AuditReport {
  generado: string;
  modo: SiteFacts["mode"];
  base: string;
  resumen: AuditSummary;
  reglas: RuleResult[];
  /** Indicators only — no HTML, no page text, no personal data. */
  indicadores: {
    paginas: { tipo: string; ruta: string; estado: number; robots: string; anuncios: boolean; palabras: number; jsonld: string[] }[];
    navegador: { ruta: string; anunciosPedidos: boolean; bloques: number; ausentes: number; ocultos: number; capa: number; palabrasHidratadas: number; palabrasServidor: number; palabrasAusentes: string[]; errores: number; error: string | null }[] | null;
    paginasOriginales: { ruta: string; palabras: number }[];
    muestraVacantes: { ruta: string; fuente: string | null; indexable: boolean }[];
    enlacesRotos: SiteFacts["brokenLinks"];
    enlacesComprobados: number;
    peticiones: number;
    metodos: string[];
  };
  diferencias?: ReturnType<typeof diffAgainst>;
}

export async function runAudit(options: AuditOptions): Promise<{ report: AuditReport; exitCode: number; text: string }> {
  const fetcher = new GetFetcher(options);
  const plan: SamplePlan = {
    pages: FIXED_PAGES,
    linkChecks: options.mode === "sintetico" ? 150 : 10,
    jobSampleSize: options.mode === "sintetico" ? 0 : 4,
    ...options.plan
  };
  const facts = await collectFacts(fetcher, plan, options.mode);
  if (options.browser) facts.browser = await observeInBrowser(facts);
  const results = evaluateRules(facts, options.attestations);
  const summary = summarize(results, facts);
  const report: AuditReport = {
    generado: new Date().toISOString(),
    modo: options.mode,
    base: options.base,
    resumen: summary,
    reglas: results,
    indicadores: {
      paginas: facts.pages.map((page) => ({
        tipo: page.kind,
        ruta: page.path,
        estado: page.status,
        robots: page.robots,
        anuncios: page.adMarker,
        palabras: page.rawWords,
        jsonld: [...new Set(page.jsonLd.flatMap((block) => (block.valid ? block.types : ["(inválido)"])))]
      })),
      navegador: facts.browser?.map((entry) => ({
        ruta: entry.path,
        anunciosPedidos: entry.adsRequested,
        bloques: entry.segments,
        ausentes: entry.missingSegments.length,
        ocultos: entry.hiddenSegments.length,
        capa: entry.overlayShare,
        palabrasHidratadas: entry.hydratedWords,
        palabrasServidor: entry.serverWords,
        palabrasAusentes: entry.missingWords.slice(0, 40),
        errores: entry.pageErrors,
        error: entry.error
      })) ?? null,
      paginasOriginales: facts.originalPages.map((page) => ({ ruta: page.path, palabras: page.words })),
      muestraVacantes: facts.jobSample.map((job) => ({ ruta: job.path, fuente: job.source, indexable: job.indexable })),
      enlacesRotos: facts.brokenLinks,
      enlacesComprobados: facts.checkedLinks,
      peticiones: facts.requests,
      metodos: facts.methods
    }
  };
  let exitCode = exitCodeFor(results);
  if (options.expected) {
    report.diferencias = diffAgainst(results, options.expected);
    // Baseline gate: reproducing the committed matrix is the pass condition.
    exitCode = report.diferencias.length === 0 ? 0 : 1;
  }
  let text = renderSummary(results, summary, `AdSense audit — modo ${options.mode} — ${options.base} — ${facts.requests} peticiones GET`);
  if (report.diferencias) {
    text += report.diferencias.length === 0
      ? "\nLínea base: el auditor reproduce la matriz esperada (0 diferencias)."
      : `\nLínea base: ${report.diferencias.length} diferencias: ${report.diferencias.map((entry) => `${entry.id} esperado ${entry.esperado ?? "—"} obtenido ${entry.obtenido}`).join("; ")}`;
  }
  return { report, exitCode, text };
}

/** Reports go to the OS temporary directory (design.md, F0), never the repo. */
export async function writeReport(report: AuditReport, directory?: string): Promise<string> {
  const dir = directory ?? path.join(tmpdir(), "adsense-audit");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `adsense-audit-${report.modo}-${report.generado.replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify(report, null, 2));
  return file;
}
