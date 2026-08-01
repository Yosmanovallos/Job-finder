import { ReputationSourceAdapter } from "./types.js";
import { mercoTalentoAdapter } from "./merco.js";
import { gptwAdapter } from "./gptw.js";

// Order matters only for readability — each entry runs independently
// through its own circuit breaker (executeWithResilience), so one source
// failing never blocks another. Planned order per
// docs/COMPANY-REPUTATION-PLAN.md §5: Merco Talento (R2, done), Great
// Place to Work Colombia (R3, done), Computrabajo (R4, explicit
// re-checkpoint before coding given its specific anti-scraping clause).
// LinkedIn (R5) never appears here — it's a live, frontend-only badge,
// not a stored score.
export const REPUTATION_SOURCES: ReputationSourceAdapter[] = [mercoTalentoAdapter, gptwAdapter];
