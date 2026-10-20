import { Job } from './types.js';
import { jitterDelay } from '../engine/jitter-delay.js';
import { htmlEntities } from '../utils.js';
import { flightStream, objectAfter } from '../lib/next-flight.js';
import { DISALLOW_ALL, ALLOW_ALL, isAllowed, parseRobots, type RobotsPolicy } from '../lib/robots-txt.js';

/**
 * Magneto as a job board, within its robots.txt (owner decision 2026-10-20).
 *
 * Magneto's robots.txt has `Disallow: /*?` for every bot: the keyword search
 * this adapter used (`/co/empleos?q=...`) was forbidden. Allowed instead: the
 * general search page `/co/trabajos/buscar` and Magneto's own topic pages
 * (`/co/trabajos/ofertas-empleo-en-bogota`, `/co/trabajos/vacantes-servicio-al-cliente`…),
 * each listing its newest postings. The server ignores the paginator
 * (measured 2026-10-20: pages 1-3 return the same 20 rows), so coverage comes
 * from reading many topic pages, not from paging one. It is therefore a
 * catalog source (GLOBAL_SOURCE_CADENCE_MS): one pass per window, keywords
 * ignored. robots.txt is read on every pass and every URL is checked
 * against it. Identifies itself (no browser User-Agent). The posting date is
 * Magneto's own `publishDate`: a row without it is skipped, never dated today.
 */

const ORIGIN = 'https://www.magneto365.com';
const USER_AGENT = 'BuscoTrabajoBot/1.0 (+https://buscotrabajo.co)';
const SEARCH_PATH = '/co/trabajos/buscar';
// Topic pages read per pass (each ~20 newest postings), besides the search page.
const MAX_TOPIC_PAGES = 40;

interface MagnetoRow {
  id?: number;
  title?: string;
  jobSlug?: string;
  status?: string;
  cities?: string[];
  isRemote?: boolean;
  companyName?: string;
  confidential?: boolean;
  publishDate?: string;
  expirationDate?: string;
  countryIds?: number[];
}

async function get(url: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000)
  });
  return { status: response.status, body: await response.text() };
}

async function readRobots(): Promise<RobotsPolicy> {
  try {
    const response = await get(`${ORIGIN}/robots.txt`);
    if (response.status === 200) return parseRobots(response.body);
    return response.status >= 400 && response.status < 500 ? ALLOW_ALL : DISALLOW_ALL;
  } catch {
    return DISALLOW_ALL;
  }
}

/** Magneto's own Colombian topic pages linked from a page: `/co/trabajos/{slug}`, never with a query. */
export function magnetoTopicPaths(html: string): string[] {
  const paths = new Set<string>();
  for (const match of html.matchAll(/(?:https:\/\/www\.magneto365\.com)?(\/co\/trabajos\/[a-z0-9-]{3,120})(?=["'\s<])/g)) {
    if (match[1] !== SEARCH_PATH) paths.add(match[1]);
  }
  return [...paths];
}

/** Rows of a Magneto listing page, as the page states them. */
export function magnetoRows(html: string): MagnetoRow[] {
  const search = objectAfter(flightStream(html), 'searchResponse') as { rows?: unknown } | undefined;
  return Array.isArray(search?.rows) ? (search!.rows as MagnetoRow[]) : [];
}

/** A Magneto row as a Job — only what Magneto states; no date, no row. */
export function magnetoRowToJob(row: MagnetoRow): Job | null {
  if (!row.id || !row.title || !row.jobSlug || !/^[a-z0-9-]{1,200}$/.test(row.jobSlug)) return null;
  if (row.status && row.status !== 'published') return null;
  const publishedAt = row.publishDate && Number.isFinite(Date.parse(row.publishDate)) ? new Date(row.publishDate).toISOString() : null;
  if (!publishedAt) return null;
  const cities = (row.cities ?? []).map((city) => city.trim()).filter(Boolean);
  const job: Job = {
    jobId: String(row.id),
    title: htmlEntities(row.title),
    company: row.confidential ? 'Confidencial' : htmlEntities(row.companyName || 'Confidencial'),
    location: htmlEntities(row.isRemote ? 'Remoto' : cities.join(', ') || 'Colombia'),
    url: `${ORIGIN}/co/empleos/${row.jobSlug}`,
    dateText: '',
    source: 'Magneto',
    publishedAt
  };
  if (row.expirationDate && Number.isFinite(Date.parse(row.expirationDate))) job.validThrough = new Date(row.expirationDate).toISOString();
  return job;
}

export async function scrapeMagnetoCatalog(): Promise<Job[]> {
  const robots = await readRobots();
  if (!isAllowed(robots, SEARCH_PATH)) {
    console.warn('[Magneto] robots.txt no permite la búsqueda general: no se lee nada.');
    return [];
  }
  const search = await get(`${ORIGIN}${SEARCH_PATH}`);
  if (search.status !== 200) {
    console.warn(`[Magneto] Búsqueda general: HTTP ${search.status}`);
    return [];
  }
  const pages = [search.body];
  const topics = magnetoTopicPaths(search.body).filter((path) => isAllowed(robots, path)).slice(0, MAX_TOPIC_PAGES);
  for (const path of topics) {
    await jitterDelay();
    try {
      const response = await get(`${ORIGIN}${path}`);
      if (response.status === 200) pages.push(response.body);
    } catch {
      // One topic page failing never stops the pass.
    }
  }
  const jobs = new Map<string, Job>();
  for (const html of pages) {
    for (const row of magnetoRows(html)) {
      const job = magnetoRowToJob(row);
      if (job && isAllowed(robots, new URL(job.url).pathname)) jobs.set(job.jobId, job);
    }
  }
  console.log(`[Magneto] ${pages.length} páginas permitidas leídas → ${jobs.size} vacantes distintas.`);
  return [...jobs.values()];
}

