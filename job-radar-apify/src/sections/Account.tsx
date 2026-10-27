import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Check, Trash2 } from "lucide-react";
import { useAuth } from "../auth/auth-provider.js";
import { useSavedJobs, type SavedJobEntry } from "../lib/saved-jobs.js";
import { buildJobPath } from "../lib/job-seo.js";
import { getSourceColor } from "../lib/source-colors.js";
import { getEffectiveCountry } from "../lib/country-context.js";
import { CompanyAvatar } from "../components/CompanyAvatar.js";
import { PRO_MONTHLY_PRICE_COP, formatCOP, PAYWALL_ENABLED } from "../config.js";

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

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });

// "Mi cuenta": what an account does today — the jobs you saved or applied
// to, and your name/email. Plan and payment history only render while the
// paywall is on (PAYWALL_ENABLED); the product is free today, so they're
// hidden, not deleted (owner decision 2026-10-25).
// RequireAuth (see App.tsx) already guarantees a resolved, authenticated
// session before this ever renders — no loading/redirect guard needed here.
export default function Account() {
  const { user, tier, accessToken, logout, updateProfileName } = useAuth();
  const saved = useSavedJobs();
  const navigate = useNavigate();
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(user?.name || "");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"saved" | "applied">("saved");
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(PAYWALL_ENABLED);
  const dashboardPath = getEffectiveCountry("/cuenta") === "VE" ? "/ve/dashboard" : "/dashboard";

  // Fresh list every time the page opens (another device may have changed it).
  const { refresh } = saved;
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!PAYWALL_ENABLED || !accessToken) return;
    (async () => {
      try {
        const res = await fetch("/api/transactions", {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (res.ok) {
          const data = await res.json();
          setTransactions(Array.isArray(data.transactions) ? data.transactions : []);
        }
      } catch {
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

  // The list shows the account's entries, with the live marks on top (a
  // star toggled on another page this visit is reflected right away).
  const entries = saved.entries.filter((entry) => saved.savedIds.has(entry.jobId));
  const appliedCount = entries.filter((entry) => saved.appliedIds.has(entry.jobId)).length;
  const visible = filter === "applied" ? entries.filter((entry) => saved.appliedIds.has(entry.jobId)) : entries;
  const pill = (active: boolean) =>
    `h-10 rounded-full border-2 border-foreground px-4 text-sm font-bold ${active ? "bg-foreground text-white" : "bg-white text-foreground"}`;

  return (
    <div className="bg-white min-h-screen">
      <section className="bg-gradient-to-b from-green-soft to-white">
        <div className="max-w-[880px] mx-auto px-4 md:px-6 pt-8 pb-6 md:pt-12 md:pb-8">
          <h1 className="font-heading font-bold tracking-[-0.04em] leading-[1.05] text-[32px] md:text-[44px]">Mi cuenta</h1>
          <p className="mt-2 text-base text-[#3d413e]">Hola, {user?.name}. Aquí están las vacantes que guardaste.</p>
        </div>
      </section>

      <div className="max-w-[880px] mx-auto px-4 md:px-6 pb-16 md:pb-24 space-y-6 md:space-y-8">
        <section id="guardadas" aria-labelledby="mis-vacantes" className="scroll-mt-24">
          <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
            <h2 id="mis-vacantes" className="font-heading font-bold text-2xl md:text-[32px] tracking-[-0.03em]">Mis vacantes</h2>
            {entries.length > 0 && (
              <div role="tablist" aria-label="Filtrar mis vacantes" className="flex gap-2">
                <button type="button" role="tab" aria-selected={filter === "saved"} onClick={() => setFilter("saved")} className={pill(filter === "saved")}>
                  Guardadas ({entries.length})
                </button>
                <button type="button" role="tab" aria-selected={filter === "applied"} onClick={() => setFilter("applied")} className={pill(filter === "applied")}>
                  Postuladas ({appliedCount})
                </button>
              </div>
            )}
          </div>

          {saved.mode === "memory" ? (
            <p className="ink-card-sm rounded-2xl bg-[#fdf1d3] p-5 text-[#3d413e]">
              Guardar vacantes en tu cuenta se activa muy pronto. Por ahora, la estrella ☆ las marca solo mientras navegas.
            </p>
          ) : saved.mode === "loading" && entries.length === 0 ? (
            <div aria-busy="true" className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[92px] rounded-2xl border-2 border-foreground/15 bg-white animate-pulse" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="ink-card-sm rounded-2xl bg-green-soft p-6 text-center">
              <p className="font-heading font-bold text-lg">
                {filter === "applied" ? "Aún no marcas ninguna como postulada" : "Aún no guardas vacantes"}
              </p>
              <p className="mt-1.5 text-[#3d413e]">
                {filter === "applied"
                  ? "Toca «Me postulé» en una vacante cuando ya te hayas postulado."
                  : "Toca la estrella ☆ en cualquier vacante y aparecerá aquí."}
              </p>
              <Link to={dashboardPath} className="ink-card-sm ink-lift mt-4 inline-flex h-11 items-center rounded-xl bg-gold-2 px-5 font-bold text-foreground no-underline">
                Ver vacantes →
              </Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {visible.map((entry) => (
                <SavedJobRow
                  key={entry.jobId}
                  entry={entry}
                  applied={saved.appliedIds.has(entry.jobId)}
                  onToggleApplied={() => saved.toggleApplied(entry.jobId)}
                  onRemove={() => saved.remove(entry.jobId)}
                />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="perfil" className="ink-card-sm rounded-2xl bg-white p-5 md:p-6">
          <h2 id="perfil" className="font-heading font-bold text-xl mb-4">Tu perfil</h2>
          <div className="space-y-4">
            <div>
              <p className="font-mono text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Nombre</p>
              {editingName ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    maxLength={255}
                    aria-label="Nombre"
                    className="h-11 w-full rounded-xl border-2 border-foreground bg-[#fbfaf6] px-3 text-base focus:outline-none focus:ring-4 focus:ring-gold-1/60"
                  />
                  {nameError && <p className="text-sm text-destructive">{nameError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveName}
                      disabled={savingName}
                      className="h-10 rounded-xl border-2 border-foreground bg-primary px-4 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {savingName ? "Guardando..." : "Guardar"}
                    </button>
                    <button
                      onClick={() => setEditingName(false)}
                      disabled={savingName}
                      className="h-10 rounded-xl border-2 border-foreground bg-white px-4 text-sm font-bold"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-base">{user?.name}</p>
                  <button onClick={startEditingName} className="text-sm font-bold text-primary">
                    Editar
                  </button>
                </div>
              )}
            </div>
            <div className="h-0.5 bg-foreground/10" />
            <div>
              <p className="font-mono text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Correo</p>
              <p className="text-base break-all">{user?.email}</p>
            </div>

            {PAYWALL_ENABLED && (
              <>
                <div className="h-0.5 bg-foreground/10" />
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-mono text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Plan actual</p>
                    <span className="inline-flex rounded-full border-2 border-foreground bg-[#fdf1d3] px-3 py-0.5 text-sm font-bold">
                      {tier === "pro" ? "Pro" : "Gratis"}
                    </span>
                  </div>
                  {tier === "free" ? (
                    <Link to="/pricing" className="ink-card-sm ink-lift inline-flex h-10 items-center rounded-xl bg-gold-2 px-4 text-sm font-bold text-foreground no-underline">
                      Ver plan Pro · {formatCOP(PRO_MONTHLY_PRICE_COP)} COP/mes
                    </Link>
                  ) : (
                    user?.subscriptionEnd && <p className="text-sm text-[#3d413e]">Renueva el {dateLabel(user.subscriptionEnd)}</p>
                  )}
                </div>
              </>
            )}
          </div>
        </section>

        {PAYWALL_ENABLED && (
          <section aria-labelledby="pagos" className="ink-card-sm rounded-2xl bg-white p-5 md:p-6">
            <h2 id="pagos" className="font-heading font-bold text-xl mb-4">Historial de pagos</h2>
            {loadingTransactions ? (
              <p className="text-sm text-muted-foreground">Cargando...</p>
            ) : transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no tienes pagos registrados.</p>
            ) : (
              <ul className="space-y-3">
                {transactions.map((t) => {
                  const status = STATUS_LABEL[t.status] || {
                    label: t.status,
                    className: "bg-ink-faint/10 text-muted-foreground border-ink-faint/30"
                  };
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-3 pb-3 border-b border-foreground/10 last:border-0 last:pb-0">
                      <div>
                        <p className="text-sm">
                          {formatCOP(Math.round(t.amountInCents / 100))} {t.currency} · {PLAN_LABEL[t.plan] || t.plan}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">{dateLabel(t.createdAt)}</p>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-mono font-semibold border ${status.className}`}>{status.label}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        <button
          onClick={handleLogout}
          className="ink-card-sm ink-lift w-full h-12 rounded-xl bg-white text-base font-bold text-foreground"
        >
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

function SavedJobRow({
  entry,
  applied,
  onToggleApplied,
  onRemove
}: {
  entry: SavedJobEntry;
  applied: boolean;
  onToggleApplied: () => void;
  onRemove: () => void;
}) {
  const color = getSourceColor(entry.source || "");
  const title = <span className="font-heading font-bold text-base md:text-lg leading-snug line-clamp-2">{entry.title}</span>;
  return (
    // Phone: actions in a row under the job; desktop: a column on the right.
    <li className={`ink-card-sm rounded-2xl bg-white p-4 flex flex-col md:flex-row gap-3 ${entry.available ? "" : "opacity-70"}`}>
      <div className="flex gap-3 min-w-0 flex-1">
      <CompanyAvatar name={entry.company || entry.source || "?"} logoUrl={null} className="w-10 h-10 text-base shrink-0" />
      <div className="min-w-0 flex-1">
        {entry.available ? (
          <Link
            to={buildJobPath({ jobId: entry.jobId, title: entry.title, location: entry.location || "" })}
            state={{ jobOrigin: { label: "Mi cuenta", path: "/cuenta" } }}
            className="text-foreground no-underline hover:text-primary"
          >
            {title}
          </Link>
        ) : (
          title
        )}
        <p className="mt-0.5 text-sm text-[#3d413e] truncate">
          {[entry.company, entry.location].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
          {entry.source && (
            <span className="rounded-full px-2 py-0.5" style={{ backgroundColor: color.bg, color: color.text }}>{entry.source}</span>
          )}
          {!entry.available && <span className="rounded-full px-2 py-0.5 bg-[#f1f2f0] text-[#3d413e]">Ya no disponible</span>}
          <span className="text-muted-foreground">Guardada el {dateLabel(entry.savedAt)}</span>
        </div>
      </div>
      </div>
      <div className="shrink-0 flex md:flex-col items-center md:items-end justify-between md:justify-start gap-2 pl-[52px] md:pl-0">
        <button
          type="button"
          onClick={onToggleApplied}
          aria-pressed={applied}
          className={`inline-flex h-9 items-center gap-1.5 rounded-full border-2 border-foreground px-3 text-xs font-bold ${applied ? "bg-primary text-white" : "bg-white text-foreground"}`}
        >
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          {applied ? "Postulada" : "Marcar postulada"}
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Quitar ${entry.title} de mis vacantes`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-foreground/20 text-[#3d413e] hover:border-foreground"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}
