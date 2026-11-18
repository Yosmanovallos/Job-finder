// Re-measures every BuscoTrabajo corpus figure the guides cite (sources with
// "corte AAAA-MM-DD"), for the release-day update of content/guias.
// Read-only and public only: the public API's pagination.total (paced, honours
// Retry-After) and the total a hub page shows (window.__SSR_CATEGORY__).
// It never touches the database and never edits files: it prints a table, and
// a person updates each figure and its cut-off date in the guide.
//
//   npx tsx scripts/check-guide-figures.ts
import { GUIDES_CONTENT_DIR, loadGuidesFrom } from "../src/server/guides-store.js";

const PAUSE_MS = 12_000;
const MAX_RETRY_WAIT_S = 120;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiTotal(url: string): Promise<number | string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after")) || 60;
      if (wait > MAX_RETRY_WAIT_S) return `cuota agotada (reintentar en ${Math.round(wait / 3600)} h)`;
      await sleep(wait * 1000 + 2000);
      continue;
    }
    if (!res.ok) return `HTTP ${res.status}`;
    const body = (await res.json()) as { pagination?: { total?: number } };
    return body.pagination?.total ?? "sin total";
  }
  return "sin respuesta";
}

async function hubTotal(url: string): Promise<number | string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return `HTTP ${res.status}`;
  const match = /window\.__SSR_CATEGORY__=(\{[\s\S]*?\});<\/script>/.exec(await res.text());
  try {
    return (JSON.parse(match?.[1] ?? "") as { total?: number }).total ?? "sin total";
  } catch {
    return "sin total";
  }
}

async function main(): Promise<void> {
  const seen = new Map<string, number | string>();
  for (const guide of loadGuidesFrom(GUIDES_CONTENT_DIR)) {
    for (const source of guide.sources.filter((item) => item.corpus)) {
      if (!seen.has(source.url)) {
        const isApi = new URL(source.url).pathname.startsWith("/api/");
        seen.set(source.url, isApi ? await apiTotal(source.url) : await hubTotal(source.url));
        if (isApi) await sleep(PAUSE_MS);
      }
      console.log(`${guide.meta.slug}\t[^${source.id}]\t${source.cutoff}\t→ hoy: ${seen.get(source.url)}\t${source.url}`);
    }
  }
}

await main();
