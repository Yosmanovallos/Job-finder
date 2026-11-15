// `npm run adsense:audit` — the AdSense auditor on the synthetic build
// (openspec/changes/adsense-readiness, F0). Exit code ≠ 0 when any
// measurable rule is not CUMPLE: expected until F2–F5 land. The JSON report
// stays in the run's temporary directory.
import { withSyntheticSite, auditSyntheticSite } from "./adsense-audit-synthetic.js";
import { writeReport } from "../scripts/lib/adsense-audit-run.js";

withSyntheticSite(async () => {
  const { report, exitCode, text } = await auditSyntheticSite();
  console.log(text);
  console.log(`[adsense-audit] informe: ${await writeReport(report, process.cwd())}`);
  process.exitCode = exitCode;
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "[adsense-audit] falló");
  process.exitCode = 2;
});
