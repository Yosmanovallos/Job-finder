import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../auth/auth-provider.js";
import {
  PRO_MONTHLY_PRICE_COP,
  formatCOP,
  PAYWALL_ENABLED,
  RESUME_STUDIO_ENABLED
} from "../config.js";

interface TransactionRecord {
  id: string;
  reference: string;
  status: string;
  amountInCents: number;
  currency: string;
  plan: string;
  createdAt: string;
}

const PLAN_LABEL: Record<string, string> = { pro: "Pro", pro_max: "Pro Max" };

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  approved: { label: "Aprobado", className: "bg-primary/10 text-primary border-primary/30" },
  pending: { label: "Pendiente", className: "bg-accent/10 text-accent border-accent/30" },
  declined: {
    label: "Rechazado",
    className: "bg-destructive/10 text-destructive border-destructive/30"
  },
  error: { label: "Error", className: "bg-destructive/10 text-destructive border-destructive/30" }
};

// RequireAuth (see App.tsx) already guarantees a resolved, authenticated
// session before this ever renders — no loading/redirect guard needed here.
export default function Account() {
  const { user, tier, accessToken, logout, updateProfileName } = useAuth();
  const navigate = useNavigate();
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(user?.name || "");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    (async () => {
      try {
        const res = await fetch("/api/transactions", {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (res.ok) {
          const data = await res.json();
          setTransactions(Array.isArray(data.transactions) ? data.transactions : []);
        }
      } catch (e) {
        // no-op — the history section just stays empty, nothing critical breaks
      } finally {
        setLoadingTransactions(false);
      }
    })();
  }, [accessToken]);

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  const startEditingName = () => {
    setNameInput(user?.name || "");
    setNameError(null);
    setEditingName(true);
  };

  const handleSaveName = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setNameError("El nombre no puede estar vacío.");
      return;
    }
    setSavingName(true);
    setNameError(null);
    const result = await updateProfileName(trimmed);
    setSavingName(false);
    if (result.error) {
      setNameError(result.error);
      return;
    }
    setEditingName(false);
  };

  return (
    <section className="min-h-screen px-4 py-16" style={{ backgroundColor: "#fafafa" }}>
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold mb-2 font-heading" style={{ color: "#0e0f10" }}>
          Mi cuenta
        </h1>

        {/* Shell de navegación de Settings (Fase 6 de
            docs/RESUME-STUDIO-PLAN.md, §6 fila 6) — Cuenta/IA/Currículum/
            Facturación/Seguridad. Solo "IA" está conectada a una página
            real hoy, y solo cuando RESUME_STUDIO_ENABLED (mismo patrón
            hardcoded-boolean que PAYWALL_ENABLED, config.ts) está en
            true — el resto queda preparado para fases futuras sin que
            cada una tenga que rediseñar esta barra. */}
        <nav className="flex items-center gap-1 mb-8 border-b border-[#e6e8e4]">
          <span className="px-3 py-2 text-xs font-mono font-semibold text-foreground border-b-2 border-primary -mb-px">
            Cuenta
          </span>
          {RESUME_STUDIO_ENABLED && (
            <Link
              to="/cuenta/ai/providers"
              className="px-3 py-2 text-xs font-mono font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              IA
            </Link>
          )}
          <span
            className="px-3 py-2 text-xs font-mono font-semibold text-ink-faint/50 cursor-not-allowed"
            title="Próximamente"
          >
            Currículum
          </span>
          <span
            className="px-3 py-2 text-xs font-mono font-semibold text-ink-faint/50 cursor-not-allowed"
            title="Próximamente"
          >
            Facturación
          </span>
          <span
            className="px-3 py-2 text-xs font-mono font-semibold text-ink-faint/50 cursor-not-allowed"
            title="Próximamente"
          >
            Seguridad
          </span>
        </nav>

        <div className="rounded-2xl border border-[#e6e8e4] bg-[#ffffff] p-6 space-y-5">
          <div>
            <p className="text-xs font-mono text-ink-faint mb-1">Nombre</p>
            {editingName ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  maxLength={255}
                  className="w-full px-3 py-2 rounded-lg bg-[#fafafa] border border-[#e6e8e4] text-foreground text-sm focus:outline-none"
                />
                {nameError && <p className="text-xs text-destructive font-mono">{nameError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveName}
                    disabled={savingName}
                    className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary text-primary-foreground font-bold text-xs transition-all disabled:opacity-50"
                  >
                    {savingName ? "Guardando..." : "Guardar"}
                  </button>
                  <button
                    onClick={() => setEditingName(false)}
                    disabled={savingName}
                    className="px-3 py-1.5 rounded-lg border border-[#e6e8e4] text-foreground text-xs font-semibold hover:bg-[#f1f2f0] transition-all"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-sm text-foreground">{user?.name}</p>
                <button
                  onClick={startEditingName}
                  className="text-xs text-primary hover:text-primary font-mono"
                >
                  Editar
                </button>
              </div>
            )}
          </div>

          <div className="h-px bg-[#e6e8e4]" />

          <div>
            <p className="text-xs font-mono text-ink-faint mb-1">Correo</p>
            <p className="text-sm text-foreground">{user?.email}</p>
          </div>

          <div className="h-px bg-[#e6e8e4]" />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-mono text-ink-faint mb-1">Plan actual</p>
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold ${
                  tier === "pro"
                    ? "bg-primary/10 text-primary border border-primary/30"
                    : "bg-accent/10 text-accent border border-accent/30"
                }`}
              >
                {tier === "pro" ? "🌟 Pro" : "FREE"}
              </span>
            </div>

            {tier === "pro" && user?.subscriptionEnd && (
              <div className="text-right">
                <p className="text-xs font-mono text-ink-faint mb-1">Renueva</p>
                <p className="text-sm text-foreground font-mono">
                  {new Date(user.subscriptionEnd).toLocaleDateString("es-CO", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                  })}
                </p>
              </div>
            )}
          </div>

          {PAYWALL_ENABLED && tier === "free" && (
            <>
              <div className="h-px bg-[#e6e8e4]" />
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm text-muted-foreground">
                  Desbloquea acceso inmediato por {formatCOP(PRO_MONTHLY_PRICE_COP)} COP/mes.
                </p>
                <Link
                  to="/pricing"
                  className="px-4 py-2 rounded-lg bg-accent hover:bg-accent text-primary-foreground font-bold text-xs transition-all whitespace-nowrap"
                >
                  Ver plan Pro
                </Link>
              </div>
            </>
          )}

          {PAYWALL_ENABLED && tier === "pro" && (
            <>
              <div className="h-px bg-[#e6e8e4]" />
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-ink-faint font-mono">
                  Para cancelar tu suscripción, escríbenos a{" "}
                  <a href="mailto:buscotrabajocolombia123@gmail.com" className="text-primary">
                    buscotrabajocolombia123@gmail.com
                  </a>
                  . Aún no hay cancelación automática desde aquí.
                </p>
                <Link
                  to="/pricing"
                  className="px-4 py-2 rounded-lg border border-primary/30 text-primary text-xs font-bold hover:bg-primary/10 transition-all whitespace-nowrap"
                >
                  Renovar ahora
                </Link>
              </div>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-[#e6e8e4] bg-[#ffffff] p-6 mt-6">
          <h2 className="text-sm font-bold mb-4 font-heading" style={{ color: "#0e0f10" }}>
            Historial de pagos
          </h2>
          {loadingTransactions ? (
            <p className="text-xs text-ink-faint font-mono">Cargando...</p>
          ) : transactions.length === 0 ? (
            <p className="text-xs text-ink-faint font-mono">Todavía no tienes pagos registrados.</p>
          ) : (
            <ul className="space-y-3">
              {transactions.map((t) => {
                const status = STATUS_LABEL[t.status] || {
                  label: t.status,
                  className: "bg-ink-faint/10 text-muted-foreground border-ink-faint/30"
                };
                return (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-3 pb-3 border-b border-[#e6e8e4] last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm text-foreground">
                        {formatCOP(Math.round(t.amountInCents / 100))} {t.currency}
                        {" · "}
                        {PLAN_LABEL[t.plan] || t.plan}
                      </p>
                      <p className="text-xs text-ink-faint font-mono">
                        {new Date(t.createdAt).toLocaleDateString("es-CO", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric"
                        })}
                      </p>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-mono font-semibold border ${status.className}`}
                    >
                      {status.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <button
          onClick={handleLogout}
          className="w-full mt-6 px-4 py-3 rounded-lg border border-[#e6e8e4] text-foreground text-sm font-semibold hover:bg-[#f1f2f0] hover:border-[#d3d6cf] transition-all"
        >
          Cerrar sesión
        </button>
      </div>
    </section>
  );
}
