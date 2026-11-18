/**
 * The HTML of a job detail page, composed from the SPA shell (adsense-readiness
 * F2). Moved verbatim out of server.ts's /empleos/:id branch so the composition
 * can be tested offline; with THIRD_PARTY_JOB_EXCERPT_ENABLED off its output is
 * byte for byte the pre-F2 page (tests/fixtures/job-page-golden).
 *
 * Every block around the description is real data or absent (no invention):
 * breadcrumb, facts, source link, reputation, the employer's careers link,
 * the employer's other vacancies and «Más empleos en <ciudad>».
 */
import { isAdEligibleJobPage, markAdEligible } from "./ad-eligibility.js";
import { renderCompanyJobsHtml, type CompanyJobsBlock } from "./job-company-links.js";
import {
  buildJobBreadcrumbList,
  renderJobBreadcrumbHtml,
  renderRelatedJobsHtml,
  resolveJobCityHub,
  type RelatedJobLink
} from "./job-internal-links.js";
import {
  buildJobMeta,
  buildJobPageBody,
  buildJobPagePayload,
  buildJobPosting,
  injectJobHeadMeta,
  injectJobPageContent,
  isGoogleEligiblePage,
  type SeoJob
} from "./job-seo.js";
import { applyThirdPartyExcerpt, isExcludedFromGoogleIndex, thirdPartyExcerptEnabled } from "./third-party-excerpt.js";

export interface JobPageInput {
  /** The job as the public (masked) view returns it. */
  job: SeoJob;
  /** Anonymous visitors only: the same job with its reputation, embedded for hydration. */
  publicJob: SeoJob | null;
  related: RelatedJobLink[];
  companyJobs: CompanyJobsBlock | null;
  /** adsense-readiness F3: «Guías relacionadas» body block and its head payload. */
  guides?: { html: string; head: string };
}

export function renderJobPageHtml(
  shell: string,
  input: JobPageInput,
  env: Record<string, string | undefined> = process.env
): string {
  const excerpt = thirdPartyExcerptEnabled(env);
  const visible = applyThirdPartyExcerpt(input.job, excerpt);
  const publicJob = input.publicJob ? applyThirdPartyExcerpt(input.publicJob, excerpt) : null;
  // Job SEO V2: the stored verdict of the shared gate alone decides robots
  // and JobPosting. D1(b) withholds both for a third-party copy: the
  // JobPosting contract requires the full description.
  const googleReady = isGoogleEligiblePage(visible) && !isExcludedFromGoogleIndex(visible, excerpt);
  const jobPosting = googleReady ? buildJobPosting(visible) : null;
  const cityHub = resolveJobCityHub(visible);
  const { related, companyJobs } = input;
  let html = injectJobPageContent(shell, {
    appHtml:
      `${renderJobBreadcrumbHtml(visible, cityHub)}${buildJobPageBody(publicJob ?? visible)}` +
      `${companyJobs ? renderCompanyJobsHtml(companyJobs) : ""}${renderRelatedJobsHtml(cityHub, related)}${input.guides?.html ?? ""}`,
    links: { jobId: visible.jobId, related, ...(companyJobs ? { company: companyJobs } : {}) },
    breadcrumb: buildJobBreadcrumbList(visible, cityHub),
    payload: publicJob ? buildJobPagePayload(publicJob) : null,
    noindex: !googleReady || !jobPosting,
    jobPosting
  });
  html = injectJobHeadMeta(html, buildJobMeta(visible));
  if (input.guides?.head) html = html.replace("</head>", () => `${input.guides!.head}</head>`);
  // Ads only on the employer's own vacancy; a copy from another job
  // board is replicated content (adsense-readiness PP-4).
  if (isAdEligibleJobPage(visible, Boolean(googleReady && jobPosting))) html = markAdEligible(html);
  return html;
}
