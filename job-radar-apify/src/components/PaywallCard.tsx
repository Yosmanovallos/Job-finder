import React from "react";
import { Job } from "../sources/types.js";
import { PRO_MONTHLY_PRICE_COP, formatCOP } from "../config.js";

export interface PaywallCardProps {
  job: Job & {
    alsoIn?: string[];
  };
  onUnlockClick?: () => void;
}

export const PaywallCard: React.FC<PaywallCardProps> = ({ job, onUnlockClick }) => {
  return (
    <div className="hud-corners grid grid-cols-[4px_1fr] rounded-lg border border-[#e6e8e4] bg-[#ffffff] shadow-sm overflow-hidden text-left">
      <div className="bg-gradient-to-b from-gold-1 via-gold-2 to-gold-3" />

      <div className="p-5">
        {/* Status row: Pro pill + source pill + freshness */}
        <div className="flex flex-wrap items-center gap-2 mb-3 text-[11px] font-mono">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-semibold uppercase tracking-wide bg-gradient-to-br from-gold-1 to-gold-2 text-gold-ink">
            🔒 Nueva · Solo Pro
          </span>
          <span className="px-2.5 py-1 rounded-full bg-[#f1f2f0] text-muted-foreground border border-[#e6e8e4] normal-case font-medium">
            {job.source}
          </span>
          <span className="ml-auto text-ink-faint">
            {job.dateText || job.publishedAt || "Reciente"}
          </span>
        </div>

        {/* Visible title */}
        <h3 className="font-heading font-semibold text-lg text-foreground mb-2 leading-snug">
          {job.title}
        </h3>

        {/* The server withholds company/location/url for locked jobs — this
            line states that plainly instead of showing a blurred mock of
            fields we don't actually have permission to display. */}
        <p className="text-xs text-muted-foreground mb-4">
          Empresa y ubicación se revelan al desbloquear. Sé de los primeros en postularte antes de que venza.
        </p>

        <div className="ticket-seam mb-4" />

        <div className="mb-3 text-xs font-mono text-muted-foreground">
          Plan Pro:{" "}
          <strong className="text-foreground font-heading text-sm">
            {formatCOP(PRO_MONTHLY_PRICE_COP)} COP / mes
          </strong>
        </div>

        <button
          onClick={onUnlockClick}
          className="btn-gold-shine w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-md bg-gradient-to-br from-gold-1 via-gold-2 to-gold-3 text-gold-ink font-bold text-xs font-mono shadow-[0_8px_18px_-8px_rgba(156,122,30,0.55)]"
        >
          🔓 Desbloquear Acceso Pro
        </button>
      </div>
    </div>
  );
};
