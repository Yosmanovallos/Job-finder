import { ReputationScoreInput, ReputationSourceAdapter } from "./types.js";

const MERCO_TALENTO_URL = "https://www.merco.info/co/ranking-merco-talento";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// merco.info responds 302 (Set-Cookie: m.cou1=co) to the very first request
// without that cookie, then 200 once it's sent back — a single hop, not the
// infinite loop a plain `curl -L` (no cookie jar) hits, verified live
// against the real site this session. No cookie-jar dependency needed for
// one hop — just replay the Set-Cookie value on a second request.
async function fetchMercoHtml(url: string): Promise<string> {
  const first = await fetch(url, {
    redirect: "manual",
    headers: { "User-Agent": USER_AGENT }
  });

  if (first.status === 200) return first.text();

  if (first.status === 302) {
    const setCookie = first.headers.get("set-cookie");
    if (!setCookie) {
      throw new Error(`[Merco] Redirigió (302) sin Set-Cookie — comportamiento inesperado del sitio`);
    }
    const cookieValue = setCookie.split(";")[0];
    const second = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Cookie: cookieValue }
    });
    if (second.status !== 200) {
      throw new Error(`[Merco] HTTP ${second.status} tras reenviar la cookie de sesión`);
    }
    return second.text();
  }

  throw new Error(`[Merco] HTTP ${first.status} inesperado`);
}

// merco.info emits accented company names as numeric HTML entities
// (e.g. "&#201;" = "É") — no named entities observed, so this is
// deliberately narrow rather than a general-purpose HTML decoder.
function decodeNumericEntities(text: string): string {
  return text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

// Matches only the "table-ranking-1" table's data rows — the position
// cell (<td><span ...>N</span></td>) is skipped naturally because its
// content contains a nested tag, so [^<]+ never matches it; the next
// <td> is always the company name, followed by the score cell. Verified
// against the real page this session: exactly 200/200 rows parsed.
const ROW_PATTERN = /<td>([^<]+)<\/td>\s*<td class="t-center f-monospace">(\d+)<\/td>/g;

// merco.info's own quirk (confirmed live): a malformed/renamed route still
// responds 200 with a "la página solicitada no existe" fallback body
// instead of a real 404 — so status code alone can't tell success from
// failure here. A real ranking page always has ~200 rows; anything far
// short means the fallback page or a changed layout, not real data — throw
// instead of ever persisting a partial/wrong result.
const MIN_EXPECTED_ROWS = 150;

export function parseMercoTalentoHtml(html: string): ReputationScoreInput[] {
  const tableMatch = html.match(/<table class="table table-ranking-1[\s\S]*?<\/table>/);
  if (!tableMatch) {
    throw new Error(
      `[Merco] No se encontró la tabla de ranking en el HTML (¿cambió la estructura del sitio?)`
    );
  }

  const rows: ReputationScoreInput[] = [...tableMatch[0].matchAll(ROW_PATTERN)].map((m) => ({
    companyName: decodeNumericEntities(m[1].trim()),
    source: "merco",
    score: Number(m[2]),
    scoreScale: "merco-talento-index",
    reviewCount: null,
    sourceUrl: MERCO_TALENTO_URL
  }));

  if (rows.length < MIN_EXPECTED_ROWS) {
    throw new Error(
      `[Merco] Solo se parsearon ${rows.length} filas (se esperaban ~200) — posible página de fallback o cambio de estructura, no se guardan datos parciales`
    );
  }

  return rows;
}

export const mercoTalentoAdapter: ReputationSourceAdapter = {
  name: "Merco Talento",
  async fetch(): Promise<ReputationScoreInput[]> {
    const html = await fetchMercoHtml(MERCO_TALENTO_URL);
    return parseMercoTalentoHtml(html);
  }
};
