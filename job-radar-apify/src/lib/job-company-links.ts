/**
 * Block B1 of a job page (openspec/changes/job-page-differentiation): other
 * live vacancies of the same employer, from every source, with a link to its
 * company page labelled with the real total. No job board shows the vacancies
 * an employer posted on the other boards.
 *
 * Pure and client-safe: server.ts (raw HTML) and JobLanding.tsx (hydrated DOM)
 * render the same block from the same payload.
 */
import { buildCompanyPath, buildJobPath, escapeHtml } from "./job-seo.js";
import { companyKey, isPlaceholderEmployer } from "./company-key.js";
import { resolveJobCityHub, stableHash } from "./job-internal-links.js";

export const COMPANY_JOBS_LIMIT = 6;

/** One cached row of the employer's company page query (light fields only). */
export interface CompanyJobRow {
  jobId: string;
  title: string;
  location: string | null;
  url: string | null;
  /** Read by maskLockedFields() before the rows are linked. */
  isLocked?: boolean;
}

/** The employer's first rows and its total, both from the same query. */
export interface CompanyJobsSnapshot {
  total: number;
  jobs: CompanyJobRow[];
}

export interface CompanyJobLink {
  path: string;
  title: string;
  location: string;
}

/** total null: the company cache was cold, so only the company link shows. */
export interface CompanyJobsBlock {
  jobId: string;
  name: string;
  path: string;
  total: number | null;
  jobs: CompanyJobLink[];
}

export interface CompanyJobsScope {
  /** Cache key: same employer grouping (companyKey) as the /empresas directory. */
  key: string;
  name: string;
  path: string;
  country: "CO" | "VE";
}

/**
 * Which company page this job links to, or null for an undisclosed employer.
 * The job's own country picks the directory, so "Ver las N vacantes" counts
 * exactly what that page lists.
 */
export function companyJobsScope(job: { company?: string | null; country?: string | null }): CompanyJobsScope | null {
  if (!job.company || isPlaceholderEmployer(job.company)) return null;
  const country = job.country?.toUpperCase() === "VE" ? "VE" : "CO";
  return {
    key: `${country}|${companyKey(job.company)}`,
    name: job.company,
    path: buildCompanyPath(job.company, country),
    country
  };
}

function foldCityText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// Starts each group at an offset derived from this job's id, like
// pickRelatedJobs: sibling pages link different slices of the employer.
function rotate<T>(jobId: string, rows: T[]): T[] {
  if (rows.length === 0) return rows;
  const start = stableHash(jobId) % rows.length;
  return [...rows.slice(start), ...rows.slice(0, start)];
}

/**
 * B1 for this job. undefined snapshot (cold cache) → only the company link.
 * Null for a placeholder employer, or when the employer has no other job
 * that a visitor could open.
 */
export function buildCompanyJobsBlock(
  job: { jobId: string; company?: string | null; country?: string | null; location?: string | null },
  snapshot: CompanyJobsSnapshot | undefined
): CompanyJobsBlock | null {
  const scope = companyJobsScope(job);
  if (!scope) return null;
  const base = { jobId: job.jobId, name: scope.name, path: scope.path };
  if (!snapshot) return { ...base, total: null, jobs: [] };
  if (snapshot.total < 2) return null;

  const others = snapshot.jobs.filter((row) => row.jobId !== job.jobId && row.title && row.location && row.url);
  if (others.length === 0) return null;
  // Same city first: the hub the job page links (when it has one), else the
  // same location text.
  const hub = resolveJobCityHub(job);
  const sameCity = (row: CompanyJobRow) =>
    hub
      ? resolveJobCityHub({ location: row.location, country: job.country })?.label === hub.label
      : foldCityText(row.location!) === foldCityText(job.location ?? "");
  const ordered = [...rotate(job.jobId, others.filter(sameCity)), ...rotate(job.jobId, others.filter((row) => !sameCity(row)))];
  return {
    ...base,
    total: snapshot.total,
    jobs: ordered.slice(0, COMPANY_JOBS_LIMIT).map((row) => ({
      path: buildJobPath({ jobId: row.jobId, title: row.title, location: row.location }),
      title: row.title,
      location: row.location!
    }))
  };
}

/** Link label of the company page: the real total, or no number when unknown. */
export function companyJobsLinkLabel(block: Pick<CompanyJobsBlock, "name" | "total">): string {
  return block.total === null ? `Ver las vacantes de ${block.name}` : `Ver las ${block.total} vacantes de ${block.name}`;
}

export function companyJobsHeading(block: Pick<CompanyJobsBlock, "name">): string {
  return `Otras vacantes de ${block.name}`;
}

/** Raw-HTML B1, placed after the job body. Every string escaped. */
export function renderCompanyJobsHtml(block: CompanyJobsBlock): string {
  const companyLink = `<p><a href="${escapeHtml(block.path)}">${escapeHtml(companyJobsLinkLabel(block))}</a></p>`;
  if (block.jobs.length === 0) return `<section data-company-jobs>${companyLink}</section>`;
  const items = block.jobs
    .map((link) => `<li><a href="${escapeHtml(link.path)}">${escapeHtml(link.title)}</a> — ${escapeHtml(link.location)}</li>`)
    .join("");
  return `<section data-company-jobs><h2>${escapeHtml(companyJobsHeading(block))}</h2><ul>${items}</ul>${companyLink}</section>`;
}

const COMPANY_PATH_RE = /^(\/ve)?\/empresas\/[a-z0-9-]+$/;

/** Validates window.__SSR_JOB_LINKS__.company before React trusts it: this job only, path-only links. */
export function readCompanyJobs(id: string | undefined, payload: unknown): CompanyJobsBlock | null {
  if (!id || !payload || typeof payload !== "object") return null;
  const { jobId, company } = payload as { jobId?: unknown; company?: Partial<CompanyJobsBlock> };
  if (jobId !== id || !company || typeof company !== "object") return null;
  if (company.jobId !== id || typeof company.name !== "string" || !company.name) return null;
  if (typeof company.path !== "string" || !COMPANY_PATH_RE.test(company.path)) return null;
  const total = company.total;
  if (total !== null && !(typeof total === "number" && Number.isInteger(total) && total >= 2)) return null;
  const jobs = (Array.isArray(company.jobs) ? company.jobs : [])
    .filter(
      (link): link is CompanyJobLink =>
        !!link &&
        typeof link.path === "string" &&
        link.path.startsWith("/empleos/") &&
        [link.title, link.location].every((field) => typeof field === "string" && field.length > 0)
    )
    .slice(0, COMPANY_JOBS_LIMIT)
    .map(({ path, title, location }) => ({ path, title, location }));
  return { jobId: id, name: company.name, path: company.path, total, jobs: total === null ? [] : jobs };
}
