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
  const otherSources =
    job.alsoIn || (Array.isArray(job.sources) ? job.sources.filter((s) => s !== job.source) : []);

  return (
    <div className="group relative rounded-xl border border-[#262A31] bg-[#131519] p-5 transition-all duration-200 overflow-hidden text-left">
      {/* Top Lock Badge */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs mb-3 font-mono">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            🔒 Exclusivo Suscriptores Pro
          </span>

          <span className="px-2 py-0.5 rounded bg-[#1F232B] text-slate-300 font-medium border border-[#2B303B]">
            {job.source}
          </span>

          {otherSources.length > 0 && (
            <span className="text-slate-400 font-sans text-[11px]">
              también en:{" "}
              <strong className="text-emerald-400 font-mono">{otherSources.join(", ")}</strong>
            </span>
          )}
        </div>

        <span className="text-slate-400 text-[11px] font-bold">⚡ Publicada recientemente</span>
      </div>

      {/* Visible Title */}
      <h3 className="font-heading font-semibold text-lg text-slate-100 mb-2">{job.title}</h3>

      {/* Blurred Sensitive Content — the server withholds these fields for locked
          jobs, so when unset we show a generic placeholder instead of inventing data. */}
      <div className="relative my-3 p-3 rounded-lg bg-[#0A0B0D] border border-[#1F232B]">
        <div className="filter blur-[5px] select-none pointer-events-none opacity-40 space-y-1 text-xs font-mono text-slate-300">
          <div>🏢 {job.company || "Empresa oculta hasta desbloquear"}</div>
          <div>📍 {job.location || "Ubicación oculta hasta desbloquear"}</div>
          <div>🔗 {job.url || "Enlace oculto hasta desbloquear"}</div>
        </div>

        {/* Lock Overlay Banner */}
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0A0B0D]/80 backdrop-blur-sm p-2 text-center">
          <span className="text-xs font-mono text-amber-300 font-semibold mb-1">
            🔒 Contenido de las últimas 48 horas bloqueado para usuarios Free
          </span>
          <span className="text-[11px] text-slate-400">
            Sé de los primeros en postularte antes de que venza.
          </span>
        </div>
      </div>

      {/* CTA Unlock Button */}
      <div className="pt-2 flex items-center justify-between">
        <span className="text-xs text-slate-400 font-mono">
          Plan Pro:{" "}
          <strong className="text-emerald-400">{formatCOP(PRO_MONTHLY_PRICE_COP)} COP / mes</strong>
        </span>

        <button
          onClick={onUnlockClick}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs transition-all shadow-lg shadow-amber-400/20 font-sans"
        >
          <span>🔓 Desbloquear Acceso Pro</span>
        </button>
      </div>
    </div>
  );
};
