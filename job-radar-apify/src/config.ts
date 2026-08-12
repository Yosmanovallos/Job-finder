/**
 * Shared constants safe to import from both frontend (Vite/React) and
 * backend (Node/tsx) code — no `process.env`/`import.meta.env` here, so it
 * never breaks either bundle. Single source of truth for values that used
 * to be copy-pasted across multiple files.
 */

export const PRO_MONTHLY_PRICE_COP = 14900;
export const PRO_MONTHLY_PRICE_COP_CENTS = PRO_MONTHLY_PRICE_COP * 100;

// Confirmado por el usuario 2026-08-07 (docs/CV-GENERATION-PLAN.md §12
// punto 7): $29.900 COP, nombre "Pro Max". 14 créditos/mes confirmados
// (punto 8) — ver src/cv/quota.ts.
export const PRO_MAX_MONTHLY_PRICE_COP = 29900;
export const PRO_MAX_MONTHLY_PRICE_COP_CENTS = PRO_MAX_MONTHLY_PRICE_COP * 100;

export const SITE_DOMAIN = "buscotrabajo.co";

// Pro plan paused until there are enough users/features to justify it
// (2026-07-26 decision). Flip back to `true` to re-enable the 48h paywall
// and the Pro marketing UI — nothing else needs to change.
export const PAYWALL_ENABLED = false;

// Fase 1 de docs/RESUME-STUDIO-PLAN.md — kill-switch de despliegue para el
// beta del Resume Studio, independiente de `users.resume_studio_beta` (esa
// columna decide QUIÉN lo ve; esta constante decide si la feature existe en
// este deploy en absoluto). Corrección al plan original al implementar: el
// plan decía "variable de entorno" (`RESUME_STUDIO_ENABLED`), pero este
// archivo es explícitamente frontend+backend compartido y el comentario de
// arriba prohíbe `process.env` aquí a propósito (rompería el bundle de
// Vite). Un booleano hardcodeado, exactamente el mismo patrón que
// `PAYWALL_ENABLED` un renglón arriba, es la forma correcta de un
// kill-switch en este archivo — cambiarlo es un commit explícito, no una
// var de entorno que alguien pueda tocar sin revisión.
export const RESUME_STUDIO_ENABLED = true; // TEMP dev review session — revert to false when done

export function formatCOP(amount: number): string {
  return `$${amount.toLocaleString("es-CO")}`;
}
