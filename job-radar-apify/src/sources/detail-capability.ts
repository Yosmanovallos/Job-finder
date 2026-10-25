/**
 * Which stored `jobs.source` labels can be enriched through an adapter's
 * `fetchDetail`, and which adapter (circuit/policy identity) serves each
 * country. Import-light on purpose: the classifier, the readiness repository
 * and the tick use it without pulling the scrapers in.
 *
 * Must stay in sync with `allAdapters` — tests/validate-job-seo-v2.ts asserts
 * that every adapter named here really implements fetchDetail and that no
 * other adapter does. Glassdoor's detail fetcher exists but is deliberately
 * unwired (403 risk, see src/sources/glassdoor.ts), so it is NOT listed.
 */
// Order is the drain order (drainDetailQueue): sources whose robots.txt allows
// the detail page and whose detail answers reliably go first, so a backlog on
// LinkedIn/Computrabajo can no longer starve them. Measured 2026-10-25: Magneto
// had 0 detail attempts in 48 h (1,309 pending) because the drain always ran
// out of time on LinkedIn first.
const DETAIL_ADAPTERS: Record<string, { CO: string; VE?: string }> = {
  Magneto: { CO: "Magneto" },
  Elempleo: { CO: "Elempleo" },
  LinkedIn: { CO: "LinkedIn", VE: "LinkedIn-VE" },
  Computrabajo: { CO: "Computrabajo", VE: "Computrabajo-VE" }
};

export function sourceSupportsDetail(source: string | null | undefined): boolean {
  return Boolean(source && DETAIL_ADAPTERS[source]);
}

/** Adapter name to use for a stored job's detail fetch, or null when unsupported. */
export function detailAdapterNameFor(source: string | null | undefined, country: string | null | undefined): string | null {
  const entry = source ? DETAIL_ADAPTERS[source] : undefined;
  if (!entry) return null;
  return (country === "VE" ? entry.VE : undefined) ?? entry.CO;
}

export const DETAIL_ADAPTER_NAMES: readonly string[] = Object.values(DETAIL_ADAPTERS).flatMap((entry) =>
  entry.VE ? [entry.CO, entry.VE] : [entry.CO]
);
