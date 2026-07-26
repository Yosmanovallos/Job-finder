import { useState } from "react";
import { DEFAULT_ROLES_200 } from "../queue/scheduler.js";

export interface RoleOnboardingModalProps {
  onDone: (roles: string[]) => void;
}

export function RoleOnboardingModal({ onDone }: RoleOnboardingModalProps) {
  const [roles, setRoles] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  const addRole = (value: string) => {
    const clean = value.trim();
    if (!clean || roles.includes(clean) || roles.length >= 10) return;
    setRoles((prev) => [...prev, clean]);
    setInput("");
  };

  const removeRole = (value: string) => {
    setRoles((prev) => prev.filter((r) => r !== value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onDone(roles);
    setSaving(false);
  };

  const suggestions = DEFAULT_ROLES_200.filter((r) => !roles.includes(r)).slice(0, 8);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(14,15,16,0.45)" }}
    >
      <div className="hud-corners w-full max-w-lg rounded-2xl border border-[#e6e8e4] bg-[#ffffff] p-6 sm:p-8 shadow-lg">
        <h2 className="font-heading font-semibold text-2xl text-foreground mb-2">
          ¿Qué puestos estás buscando?
        </h2>
        <p className="text-sm text-muted-foreground mb-5">
          Así te mostramos primero las vacantes que más te interesan. Puedes agregar varios.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addRole(input);
                }
              }}
              placeholder="Ej: Desarrollador Frontend"
              className="flex-1 font-body text-sm py-3 px-4 rounded-lg border border-[#d3d6cf] bg-[#ffffff] text-foreground focus:outline-none focus:border-gold-2 focus:ring-4 focus:ring-gold-1/40 transition-all"
            />
            <button
              type="button"
              onClick={() => addRole(input)}
              className="px-4 py-2 rounded-lg border border-[#d3d6cf] text-sm font-mono font-semibold text-foreground hover:bg-[#f1f2f0] transition-colors whitespace-nowrap"
            >
              + Añadir
            </button>
          </div>

          {roles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {roles.map((role) => (
                <span
                  key={role}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono font-medium bg-green-soft text-green-deep"
                >
                  {role}
                  <button
                    type="button"
                    onClick={() => removeRole(role)}
                    aria-label={`Quitar ${role}`}
                    className="hover:opacity-70"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="mb-6">
              <p className="text-[11px] font-mono uppercase tracking-wide text-ink-faint mb-2">
                Sugerencias
              </p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => addRole(role)}
                    className="px-3 py-1.5 rounded-full text-xs font-mono border border-[#d3d6cf] text-muted-foreground hover:border-primary/40 hover:text-green-deep transition-colors"
                  >
                    + {role}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => onDone([])}
              disabled={saving}
              className="text-xs font-mono text-ink-faint hover:text-muted-foreground transition-colors"
            >
              Omitir por ahora
            </button>
            <button
              type="submit"
              disabled={saving}
              className="btn-gold-shine px-6 py-3 rounded-lg bg-gradient-to-br from-gold-1 via-gold-2 to-gold-3 text-gold-ink font-bold text-sm font-mono disabled:opacity-60"
            >
              {saving ? "Guardando..." : "Guardar y continuar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
