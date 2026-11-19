// Writes the golden job pages with the pre-F2 composition of /empleos/:id (449c981). See cases.ts.
import fs from "node:fs";
import path from "node:path";
import { buildJobPageBody, buildJobPagePayload, buildJobPosting, buildJobMeta, injectJobHeadMeta, injectJobPageContent, isGoogleEligiblePage } from "../../../src/lib/job-seo.js";
import { buildJobBreadcrumbList, renderJobBreadcrumbHtml, renderRelatedJobsHtml, resolveJobCityHub } from "../../../src/lib/job-internal-links.js";
import { isAdEligibleJobPage, markAdEligible } from "../../../src/lib/ad-eligibility.js";
import { goldenCases } from "./cases.js";
const root = process.argv[2];
const shell = fs.readFileSync(path.join(root, "index.html"), "utf-8").replace(/\r\n/g, "\n");
for (const c of goldenCases) {
  const visible = c.job;
  const googleReady = isGoogleEligiblePage(visible);
  const jobPosting = googleReady ? buildJobPosting(visible) : null;
  const cityHub = resolveJobCityHub(visible);
  let html = injectJobPageContent(shell, {
    appHtml: `${renderJobBreadcrumbHtml(visible, cityHub)}${buildJobPageBody(visible)}${renderRelatedJobsHtml(cityHub, c.related)}`,
    links: { jobId: visible.jobId, related: c.related },
    breadcrumb: buildJobBreadcrumbList(visible, cityHub),
    payload: buildJobPagePayload(visible),
    noindex: !googleReady || !jobPosting,
    jobPosting
  });
  html = injectJobHeadMeta(html, buildJobMeta(visible));
  if (isAdEligibleJobPage(visible, Boolean(googleReady && jobPosting))) html = markAdEligible(html);
  fs.writeFileSync(path.join(root, "tests/fixtures/job-page-golden", `${c.name}.html`), html);
  console.log(c.name, html.length, googleReady, !!jobPosting);
}
