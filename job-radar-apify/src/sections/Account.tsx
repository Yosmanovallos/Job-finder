import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../auth/auth-provider.js";
import { PRO_MONTHLY_PRICE_COP, formatCOP } from "../config.js";

interface TransactionRecord {
  id: string;
  reference: string;
  status: string;
  amountInCents: number;
  currency: string;
  createdAt: string;
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  approved: { label: "Aprobado", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  pending: { label: "Pendiente", className: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  declined: { label: "Rechazado", className: "bg-red-500/10 text-red-400 border-red-500/30" },
  error: { label: "Error", className: "bg-red-500/10 text-red-400 border-red-500/30" }
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
    <section className="min-h-screen px-4 py-16" style={{ backgroundColor: "#0A0B0D" }}>
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold mb-8 font-heading" style={{ color: "#F4F5F7" }}>
          Mi cuenta
        </h1>

        <div className="rounded-2xl border border-[#262A31] bg-[#131519] p-6 space-y-5">
          <div>
            <p className="text-xs font-mono text-slate-500 mb-1">Nombre</p>
            {editingName ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  maxLength={255}
                  className="w-full px-3 py-2 rounded-lg bg-[#0A0B0D] border border-[#262A31] text-slate-100 text-sm focus:outline-none"
                />
                {nameError && <p className="text-xs text-red-400 font-mono">{nameError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveName}
                    disabled={savingName}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-all disabled:opacity-50"
                  >
                    {savingName ? "Guardando..." : "Guardar"}
                  </button>
                  <button
                    onClick={() => setEditingName(false)}
                    disabled={savingName}
                    className="px-3 py-1.5 rounded-lg border border-[#262A31] text-slate-300 text-xs font-semibold hover:bg-[#1B1E24] transition-all"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-100">{user?.name}</p>
                <button
                  onClick={startEditingName}
                  className="text-xs text-emerald-400 hover:text-emerald-300 font-mono"
                >
                  Editar
                </button>
              </div>
            )}
          </div>

          <div className="h-px bg-[#262A31]" />

          <div>
            <p className="text-xs font-mono text-slate-500 mb-1">Correo</p>
            <p className="text-sm text-slate-100">{user?.email}</p>
          </div>

          <div className="h-px bg-[#262A31]" />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-mono text-slate-500 mb-1">Plan actual</p>
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold ${
                  tier === "pro"
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                    : "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                }`}
              >
                {tier === "pro" ? "🌟 Pro" : "FREE"}
              </span>
            </div>

            {tier === "pro" && user?.subscriptionEnd && (
              <div className="text-right">
                <p className="text-xs font-mono text-slate-500 mb-1">Renueva</p>
                <p className="text-sm text-slate-300 font-mono">
                  {new Date(user.subscriptionEnd).toLocaleDateString("es-CO", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                  })}
                </p>
              </div>
            )}
          </div>

          {tier === "free" && (
            <>
              <div className="h-px bg-[#262A31]" />
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm text-slate-400">
                  Desbloquea acceso inmediato por {formatCOP(PRO_MONTHLY_PRICE_COP)} COP/mes.
                </p>
                <Link
                  to="/pricing"
                  className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs transition-all whitespace-nowrap"
                >
                  Ver plan Pro
                </Link>
              </div>
            </>
          )}

          {tier === "pro" && (
            <>
              <div className="h-px bg-[#262A31]" />
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-slate-500 font-mono">
                  Para cancelar tu suscripción, escríbenos a{" "}
                  <a href="mailto:hola@jobradar.co" className="text-emerald-400">
                    hola@jobradar.co
                  </a>
                  . Aún no hay cancelación automática desde aquí.
                </p>
                <Link
                  to="/pricing"
                  className="px-4 py-2 rounded-lg border border-emerald-500/30 text-emerald-400 text-xs font-bold hover:bg-emerald-500/10 transition-all whitespace-nowrap"
                >
                  Renovar ahora
                </Link>
              </div>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-[#262A31] bg-[#131519] p-6 mt-6">
          <h2 className="text-sm font-bold mb-4 font-heading" style={{ color: "#F4F5F7" }}>
            Historial de pagos
          </h2>
          {loadingTransactions ? (
            <p className="text-xs text-slate-500 font-mono">Cargando...</p>
          ) : transactions.length === 0 ? (
            <p className="text-xs text-slate-500 font-mono">Todavía no tienes pagos registrados.</p>
          ) : (
            <ul className="space-y-3">
              {transactions.map((t) => {
                const status = STATUS_LABEL[t.status] || {
                  label: t.status,
                  className: "bg-slate-500/10 text-slate-400 border-slate-500/30"
                };
                return (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-3 pb-3 border-b border-[#262A31] last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm text-slate-100">
                        {formatCOP(Math.round(t.amountInCents / 100))} {t.currency}
                      </p>
                      <p className="text-xs text-slate-500 font-mono">
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
          className="w-full mt-6 px-4 py-3 rounded-lg border border-[#262A31] text-slate-300 text-sm font-semibold hover:bg-[#1B1E24] hover:border-[#3A404A] transition-all"
        >
          Cerrar sesión
        </button>
      </div>
    </section>
  );
}
