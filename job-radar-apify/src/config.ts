/**
 * Shared constants safe to import from both frontend (Vite/React) and
 * backend (Node/tsx) code — no `process.env`/`import.meta.env` here, so it
 * never breaks either bundle. Single source of truth for values that used
 * to be copy-pasted across multiple files.
 */

export const PRO_MONTHLY_PRICE_COP = 14900;
export const PRO_MONTHLY_PRICE_COP_CENTS = PRO_MONTHLY_PRICE_COP * 100;

export const SITE_DOMAIN = 'buscotrabajo.co';

// Pro plan paused until there are enough users/features to justify it
// (2026-07-26 decision). Flip back to `true` to re-enable the 48h paywall
// and the Pro marketing UI — nothing else needs to change.
export const PAYWALL_ENABLED = false;

export function formatCOP(amount: number): string {
  return `$${amount.toLocaleString('es-CO')}`;
}
