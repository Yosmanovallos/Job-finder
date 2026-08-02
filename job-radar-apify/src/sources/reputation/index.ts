import { ReputationSourceAdapter } from "./types.js";
import { mercoTalentoAdapter } from "./merco.js";
import { gptwAdapter } from "./gptw.js";
import { computrabajoAdapter } from "./computrabajo.js";

// Order matters only for readability — each entry runs independently
// through its own circuit breaker (executeWithResilience), so one source
// failing never blocks another. Order per docs/COMPANY-REPUTATION-PLAN.md
// §5: Merco Talento (R2, done), Great Place to Work Colombia (R3, done),
// Computrabajo (R4, retomada — discovery via our own jobs table, see
// computrabajo.ts). LinkedIn (R5) never appears here — it's a live,
// frontend-only badge, not a stored score.
export const REPUTATION_SOURCES: ReputationSourceAdapter[] = [
  mercoTalentoAdapter,
  gptwAdapter,
  computrabajoAdapter
];
