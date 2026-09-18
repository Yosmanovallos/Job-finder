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
const DETAIL_ADAPTERS: Record<string, { CO: string; VE?: string }> = {
  LinkedIn: { CO: "LinkedIn", VE: "LinkedIn-VE" },
  Computrabajo: { CO: "Computrabajo", VE: "Computrabajo-VE" },
  Elempleo: { CO: "Elempleo" },
  Magneto: { CO: "Magneto" }
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
