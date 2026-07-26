/**
 * Shared constants safe to import from both frontend (Vite/React) and
 * backend (Node/tsx) code — no `process.env`/`import.meta.env` here, so it
 * never breaks either bundle. Single source of truth for values that used
 * to be copy-pasted across multiple files.
 */

export const PRO_MONTHLY_PRICE_COP = 14900;
export const PRO_MONTHLY_PRICE_COP_CENTS = PRO_MONTHLY_PRICE_COP * 100;

export const SITE_DOMAIN = 'buscotrabajo.co';

export function formatCOP(amount: number): string {
  return `$${amount.toLocaleString('es-CO')}`;
}
