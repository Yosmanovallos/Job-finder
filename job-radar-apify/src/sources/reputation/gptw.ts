import { ReputationScoreInput, ReputationSourceAdapter } from "./types.js";
import { decodeNumericHtmlEntities } from "./html-entities.js";

const CERTIFICATIONS_ENDPOINT = "https://greatplacetowork.com.co/wp-json/wp/v2/certificaciones";
const PER_PAGE = 100;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// GPTW's own badge program licenses a company to display "Certified" for
// 12 months from the date on this record (confirmed by GPTW's public
// certification-badge terms) — the /certificaciones REST endpoint is a
// cumulative historical archive (806 entries back to 2021, verified live
// this session), not a "currently valid" feed, so treating every row as
// "certified today" would show a company as certified years after that
// badge legally expired. 395 days = 12 months + a small buffer, never the
// literal 365 to avoid excluding a company right at the edge of its
// window on the day its data happens to be fetched.
const VALIDITY_WINDOW_DAYS = 395;

interface WpCertificacionRow {
  title: { rendered: string };
  link: string;
  date: string;
}

interface RawWpRow {
  title?: { rendered?: string };
  link?: string;
  date?: string;
}

function isValidRow(row: RawWpRow): row is WpCertificacionRow {
  return Boolean(row.title?.rendered && row.link && row.date);
}

async function fetchAllCertifications(): Promise<WpCertificacionRow[]> {
  const rows: WpCertificacionRow[] = [];
  let page = 1;

  while (true) {
    const url = `${CERTIFICATIONS_ENDPOINT}?per_page=${PER_PAGE}&page=${page}&_fields=title,link,date`;
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });

    if (response.status === 400) break; // rest_post_invalid_page_number — past the last page
    if (!response.ok) {
      throw new Error(`[GPTW] HTTP ${response.status} en la página ${page} de /wp-json/wp/v2/certificaciones`);
    }

    const body: unknown = await response.json();
    if (!Array.isArray(body)) {
      throw new Error(`[GPTW] Respuesta inesperada en la página ${page} (no es un array)`);
    }
    if (body.length === 0) break;

    rows.push(...body.filter(isValidRow));
    page++;
  }

  return rows;
}

export function filterCurrentCertifications(
  rows: WpCertificacionRow[],
  now: Date = new Date()
): ReputationScoreInput[] {
  const cutoff = now.getTime() - VALIDITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const current = rows.filter((row) => new Date(row.date).getTime() >= cutoff);

  // Sanity bound on the filtered count, not the raw fetch (the raw archive
  // legitimately has ~800 rows spanning years) — a real "currently
  // certified" window should land in the low hundreds; something wildly
  // outside that means the API's date format or filter logic broke, not
  // that GPTW suddenly has 3 certified companies or 5,000.
  if (current.length < 50 || current.length > 1000) {
    throw new Error(
      `[GPTW] ${current.length} certificaciones vigentes tras filtrar por fecha — fuera del rango de sanidad (50-1000), posible cambio de formato/API, no se guardan datos`
    );
  }

  return current.map((row) => ({
    companyName: decodeNumericHtmlEntities(row.title.rendered.trim()),
    source: "gptw",
    score: null,
    scoreScale: "gptw-certified",
    reviewCount: null,
    sourceUrl: row.link
  }));
}

export const gptwAdapter: ReputationSourceAdapter = {
  name: "Great Place to Work Colombia",
  async fetch(): Promise<ReputationScoreInput[]> {
    const rows = await fetchAllCertifications();
    return filterCurrentCertifications(rows);
  }
};
