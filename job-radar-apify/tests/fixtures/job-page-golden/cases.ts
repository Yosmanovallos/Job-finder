/**
 * Golden job pages (openspec adsense-readiness F2). The .html files next to
 * this one were written by generate.ts, which repeats the composition the
 * /empleos/:id route used at 449c981 (before F2), with the root index.html
 * as shell. With THIRD_PARTY_JOB_EXCERPT_ENABLED off, renderJobPageHtml()
 * must still produce them byte for byte (line endings normalized to LF).
 * If the shell changes on purpose, regenerate from a pre-change checkout:
 *   npx tsx tests/fixtures/job-page-golden/generate.ts "$PWD"
 * Synthetic data only.
 */
import type { SeoJob } from "../../../src/lib/job-seo.js";
import type { RelatedJobLink } from "../../../src/lib/job-internal-links.js";
import { boardJob, officialJob } from "../job-page-blocks.js";

// A future publication date keeps the fixtures "live" for the freshness gate
// (src/lib/job-freshness.ts) no matter when the test runs.
const live = (job: SeoJob): SeoJob => ({ ...job, publishedAt: "2099-01-15T15:00:00.000Z" });

const related: RelatedJobLink[] = [
  { path: "/empleos/cccccccc-3333-4333-8333-333333333333/analista-de-cartera-bogota", title: "Analista de Cartera", company: "Banco Sintético", location: "Bogotá, D.C." },
  { path: "/empleos/dddddddd-4444-4444-8444-444444444444/auxiliar-contable-bogota", title: "Auxiliar Contable", company: "Empresa Ficticia", location: "Bogotá, D.C." }
];

export const goldenCases: Array<{ name: string; job: SeoJob; related: RelatedJobLink[] }> = [
  { name: "third-party", job: live(boardJob), related },
  { name: "official", job: live({ ...officialJob, location: "Bogotá, D.C." }), related }
];
