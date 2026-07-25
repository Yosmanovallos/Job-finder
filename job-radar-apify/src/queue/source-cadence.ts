const HOUR_MS = 60 * 60 * 1000;

/**
 * How often each source may be re-scraped for a given role, keyed by the
 * adapter's `.name`. Fragile/no-official-API sources get longer gaps;
 * official APIs (Torre) or robust public APIs (RemoteOK, Remotive,
 * GetOnBoard) can run more often.
 */
export const SOURCE_CADENCE_MS: Record<string, number> = {
  LinkedIn: 4 * HOUR_MS,
  Torre: 4 * HOUR_MS,
  Computrabajo: 6 * HOUR_MS,
  Elempleo: 6 * HOUR_MS,
  Magneto: 6 * HOUR_MS,
  RemoteOK: 8 * HOUR_MS,
  GetOnBoard: 8 * HOUR_MS,
  Remotive: 8 * HOUR_MS,
  WeRemoto: 12 * HOUR_MS,
  // Indeed, Glassdoor, and Workana all started returning 403 Forbidden on
  // every request during testing (2026-07-25) — pushed out further than the
  // other 8h/12h sources on top of the fanout cap in their adapters, to cut
  // total request volume against them while docs/source-catalog/*.md is
  // researched for a compliant API/feed alternative.
  Indeed: 24 * HOUR_MS,
  Glassdoor: 24 * HOUR_MS,
  Workana: 48 * HOUR_MS
};
