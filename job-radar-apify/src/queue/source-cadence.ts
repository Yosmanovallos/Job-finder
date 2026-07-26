const HOUR_MS = 60 * 60 * 1000;

/**
 * How often each source may be re-scraped for a given role, keyed by the
 * adapter's `.name`. Fragile/no-official-API sources get longer gaps;
 * official APIs (Torre) can run more often.
 *
 * Only role-scoped sources belong here — ones whose fetch() actually uses
 * the role's keywords and returns different results per role. Sources that
 * ignore keywords/role entirely (RemoteOK, GetOnBoard, WeRemoto, Jooble)
 * live in GLOBAL_SOURCE_CADENCE_MS instead: tracking their cadence per role
 * here would re-fetch the identical catalog once per active role (~30x)
 * every window for zero extra coverage.
 */
export const SOURCE_CADENCE_MS: Record<string, number> = {
  LinkedIn: 4 * HOUR_MS,
  Torre: 4 * HOUR_MS,
  Computrabajo: 6 * HOUR_MS,
  Elempleo: 6 * HOUR_MS,
  Magneto: 6 * HOUR_MS,
  Remotive: 8 * HOUR_MS,
  // Indeed, Glassdoor, and Workana all started returning 403 Forbidden on
  // every request during testing (2026-07-25) — pushed out further than the
  // other sources on top of the fanout cap in their adapters, to cut total
  // request volume against them while docs/source-catalog/*.md is
  // researched for a compliant API/feed alternative.
  Indeed: 24 * HOUR_MS,
  Glassdoor: 24 * HOUR_MS,
  Workana: 48 * HOUR_MS
};

/**
 * Cadence for catalog-wide sources (see getDueGlobalSources in
 * scheduler-repository.ts): fetched once per window total, not once per
 * active role, so they can afford to run far more often than a per-role
 * source at the same — or lower — total request volume. RemoteOK and
 * GetOnBoard are official public JSON APIs (cheap, tolerant); WeRemoto is
 * HTML-scraped pagination with no official API, kept more conservative.
 *
 * Jooble requires JOOBLE_API_KEY (adapter no-ops without it) and its free
 * key comes with a flat 500-request allowance — the signup email doesn't
 * say it renews monthly, so treat it as a fixed budget, not a recurring
 * quota, until Jooble confirms otherwise. At 6h this is 4 req/day (~120/mo),
 * which stretches a one-time 500 to ~4 months instead of the ~20 days a 1h
 * cadence would burn through it in. Tighten this only after confirming with
 * Jooble that the 500 actually resets.
 */
export const GLOBAL_SOURCE_CADENCE_MS: Record<string, number> = {
  RemoteOK: 1 * HOUR_MS,
  GetOnBoard: 1 * HOUR_MS,
  Jooble: 6 * HOUR_MS,
  WeRemoto: 4 * HOUR_MS
};
