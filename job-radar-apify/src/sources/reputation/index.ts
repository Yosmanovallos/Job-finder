import { ReputationSourceAdapter } from "./types.js";

// Empty until Fase R2 registers the Merco Talento fetcher (first real
// source), same "shipped inactive, activated phase by phase" pattern this
// project already uses for the LLM prompt gateway (packages/models — see
// CLAUDE.md's project status). scripts/run-reputation-tick.ts already
// exercises the full pipeline (circuit breaker, upsert) against this list
// today; it's just a real no-op until a fetcher is registered here.
//
// Order matters only for readability — each entry runs independently
// through its own circuit breaker (executeWithResilience), so one source
// failing never blocks another. Planned order per
// docs/COMPANY-REPUTATION-PLAN.md §5: Merco Talento (R2), Great Place to
// Work Colombia (R3), Computrabajo (R4, explicit re-checkpoint before
// coding given its specific anti-scraping clause). LinkedIn (R5) never
// appears here — it's a live, frontend-only badge, not a stored score.
export const REPUTATION_SOURCES: ReputationSourceAdapter[] = [];
