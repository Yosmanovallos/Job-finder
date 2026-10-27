import React from "react";
import { Star, Check } from "lucide-react";

// The two personal marks on a job, as labeled buttons. They used to be a
// bare star and a bare check side by side, and the check read as "save":
// people marked jobs as applied without meaning to (owner feedback,
// 2026-10-27). The label says what each does; "Me postulé" also keeps the
// job in "Mis vacantes" (src/lib/saved-jobs.tsx).
export function JobMarkButtons({
  saved,
  applied,
  onSave,
  onApplied,
  className = ""
}: {
  saved: boolean;
  applied: boolean;
  onSave: () => void;
  onApplied: () => void;
  className?: string;
}) {
  const base =
    "inline-flex h-9 items-center gap-1 rounded-full border-2 px-2.5 sm:px-3 text-xs font-bold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold-1/60";
  return (
    <div className={`flex items-center gap-1 sm:gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={onSave}
        aria-label={saved ? "Quitar de guardados" : "Guardar"}
        aria-pressed={saved}
        title={saved ? "Quitar de Mis vacantes" : "Guardar en Mis vacantes"}
        className={`${base} ${saved ? "border-gold-3 bg-gold-1/60 text-gold-ink" : "border-foreground bg-white text-foreground hover:bg-[#fdf1d3]"}`}
      >
        <Star className="h-3.5 w-3.5" fill={saved ? "currentColor" : "none"} aria-hidden="true" />
        {saved ? "Guardada" : "Guardar"}
      </button>
      <button
        type="button"
        onClick={onApplied}
        aria-label={applied ? "Marcar como no aplicada" : "Marcar aplicada"}
        aria-pressed={applied}
        title={applied ? "Quitar la marca de postulada" : "Márcala cuando ya te hayas postulado"}
        className={`${base} ${applied ? "border-primary bg-primary text-white" : "border-foreground bg-white text-foreground hover:bg-green-soft"}`}
      >
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
        {applied ? "Postulada" : "Me postulé"}
      </button>
    </div>
  );
}
