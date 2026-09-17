/**
 * Per-source, per-stage policy (P4, spec SRC-004/006/007).
 *
 * Correction to the P4 draft, which said the circuit is "one per source,
 * shared between listing and detail": it is not. `source_circuit_state` is
 * keyed by `source_name` and the detail path passes `${adapter.name}-detail`
 * (scrape-worker.ts), so they are already distinct rows. What IS shared is
 * the POLICY — `FAILURE_THRESHOLD = 3` and `DEGRADED_TIMEOUT_MS = 30 min`
 * were module constants applied identically to both stages. This file makes
 * them addressable by (source, stage).
 *
 * Lives in code, not in the database and not in docs/source-catalog/:
 *   - in the DB it would need a migration and a round-trip per decision,
 *     inside the tick's critical path;
 *   - in docs/ it would be documentation nobody executes, which is how
 *     documentation goes stale;
 *   - in code it ships in the same commit as the behavior it describes, and
 *     `tsc` checks it.
 *
 * EVERY DEFAULT EQUALS TODAY'S BEHAVIOR. A source with no entry behaves
 * exactly as it did before P4, which is what makes rollback trivial: delete
 * the entry and the previous behavior is back, with no deploy.
 */

export type SourceStage = "listing" | "detail" | "verification";
export type Transport = "direct" | "proxy";

export interface SourcePolicy {
  readonly source: string;
  readonly stage: SourceStage;
  /** Consecutive failures before the circuit opens. */
  readonly failureThreshold: number;
  /** How long it stays open. */
  readonly openForMs: number;
  /** 'direct' unless a source explicitly declares otherwise. */
  readonly transport: Transport;
  /** Request ceiling per attempt. null = no ceiling of its own. */
  readonly maxRequestsPerAttempt: number | null;
  /** Upper bound on a Retry-After we are willing to honor. */
  readonly maxRetryAfterMs: number;
}

/** Today's constants, verbatim from resilient-fetch.ts before P4. */
export const DEFAULT_SOURCE_POLICY: Omit<SourcePolicy, "source" | "stage"> = {
  failureThreshold: 3,
  openForMs: 30 * 60 * 1000,
  transport: "direct",
  maxRequestsPerAttempt: null,
  // A source may legitimately answer "come back in an hour". A tick lasts
  // ~20 min, so honoring that verbatim is pointless; sleepWithContext would
  // cut it to the remaining budget anyway. Capping here makes the intent
  // explicit instead of leaving it to a downstream clamp.
  maxRetryAfterMs: 60_000
};

/**
 * Explicit entries only. An empty-ish table is the correct state at the end
 * of P4: the phase delivers the mechanism, and P5 populates it per source as
 * each adapter is opened and measured.
 */
export const SOURCE_POLICIES: readonly SourcePolicy[] = [
  // Detail pages are optional enrichment on top of a job that is already
  // saved and visible, and the existing cap in scrape-worker.ts is 8 per
  // adapter per role (AGENTS.md #12). Declaring it here makes the ceiling a
  // policy rather than a constant buried in the worker.
  {
    source: "Computrabajo",
    stage: "detail",
    ...DEFAULT_SOURCE_POLICY,
    maxRequestsPerAttempt: 8
  },
  {
    source: "Computrabajo-VE",
    stage: "detail",
    ...DEFAULT_SOURCE_POLICY,
    maxRequestsPerAttempt: 8
  },
  // The browser route: Glassdoor and Indeed are Cloudflare-blocked from
  // datacenter IPs, which is why the residential proxy exists for them and
  // for nothing else. Declaring it here is what keeps `WEBSHARE_PROXY_URL`
  // from being able to change any other source's behavior (SRC-006).
  { source: "Glassdoor-CO", stage: "listing", ...DEFAULT_SOURCE_POLICY, transport: "proxy" },
  { source: "Glassdoor-VE", stage: "listing", ...DEFAULT_SOURCE_POLICY, transport: "proxy" },
  { source: "Indeed-CO", stage: "listing", ...DEFAULT_SOURCE_POLICY, transport: "proxy" },
  { source: "Indeed-VE", stage: "listing", ...DEFAULT_SOURCE_POLICY, transport: "proxy" }
];

const INDEX = new Map<string, SourcePolicy>(
  SOURCE_POLICIES.map((policy) => [`${policy.source}::${policy.stage}`, policy])
);

/**
 * Resolves the policy for a (source, stage) pair. An undeclared pair gets
 * the defaults, which are today's behavior — so this function can never be
 * the reason something changes.
 */
export function resolvePolicy(source: string, stage: SourceStage): SourcePolicy {
  const declared = INDEX.get(`${source}::${stage}`);
  if (declared) return declared;
  return { source, stage, ...DEFAULT_SOURCE_POLICY };
}

/**
 * The circuit key for a (source, stage) pair — the naming convention that
 * already exists in production data (`Computrabajo` vs `Computrabajo-detail`),
 * lifted out of the worker's template literal so both sides agree on it.
 */
export function circuitKeyFor(source: string, stage: SourceStage): string {
  return stage === "listing" ? source : `${source}-${stage}`;
}
