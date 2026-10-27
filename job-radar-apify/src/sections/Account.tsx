import { useState, useEffect, type ComponentType } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { Bookmark, Check, CircleCheck, CreditCard, LogOut, Search, Trash2, UserRound } from "lucide-react";
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

// Each section of the back office is a hash, so the existing links
// (/cuenta#guardadas from the bottom nav and the dashboard) keep working.
type SectionId = "guardadas" | "postuladas" | "perfil" | "pagos";
const SECTIONS: SectionId[] = PAYWALL_ENABLED
  ? ["guardadas", "postuladas", "perfil", "pagos"]
  : ["guardadas", "postuladas", "perfil"];
const SECTION_META: Record<SectionId, { label: string; Icon: ComponentType<{ className?: string }> }> = {
  guardadas: { label: "Guardadas", Icon: Bookmark },
  postuladas: { label: "Postuladas", Icon: CircleCheck },
  perfil: { label: "Perfil", Icon: UserRound },
  pagos: { label: "Pagos", Icon: CreditCard }
};

// A long list renders in pages so 200 saved jobs don't become one endless scroll.
const PAGE_SIZE = 20;

// "Mi cuenta": a back office with the sections on the left (Guardadas,
// Postuladas, Perfil) and "Cerrar sesión" at the bottom of that menu.
// Plan and payment history only render while the paywall is on
// (PAYWALL_ENABLED); the product is free today, so they're hidden, not
// deleted (owner decision 2026-10-25).
// RequireAuth (see App.tsx) already guarantees a resolved, authenticated
// session before this ever renders — no loading/redirect guard needed here.
export default function Account() {
  const { user, tier, accessToken, logout, updateProfileName } = useAuth();
  const saved = useSavedJobs();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(user?.name || "");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(PAYWALL_ENABLED);
  const dashboardPath = getEffectiveCountry("/cuenta") === "VE" ? "/ve/dashboard" : "/dashboard";

  const hashSection = hash.replace("#", "") as SectionId;
  const section: SectionId = SECTIONS.includes(hashSection) ? hashSection : "guardadas";

  // Search and paging belong to the list being looked at; a new section
  // starts at the top (ScrollToTop only reacts to pathname, not the hash).
  useEffect(() => {
    setQuery("");
    setShown(PAGE_SIZE);
    window.scrollTo(0, 0);
  }, [section]);

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
  const appliedEntries = entries.filter((entry) => saved.appliedIds.has(entry.jobId));
  const counts: Partial<Record<SectionId, number>> = { guardadas: entries.length, postuladas: appliedEntries.length };
  const listed = section === "postuladas" ? appliedEntries : entries;
  const needle = query.trim().toLocaleLowerCase("es");
  const matching = needle
    ? listed.filter((entry) =>
        [entry.title, entry.company, entry.location].some((field) => field?.toLocaleLowerCase("es").includes(needle))
      )
    : listed;
  const visible = matching.slice(0, shown);

  const navItem = (active: boolean) =>
    `flex h-11 items-center justify-center md:justify-start gap-1.5 md:gap-2.5 whitespace-nowrap rounded-xl px-2 md:px-3 text-[13px] md:text-sm font-bold no-underline transition-colors ${
      active ? "bg-foreground text-white" : "text-foreground hover:bg-green-soft"
    }`;
  const panelHeader = "p-4 md:p-5 border-b-2 border-foreground/10";
  const panelTitle = "font-heading font-bold text-2xl md:text-[28px] tracking-[-0.03em] leading-tight";

  return (
    <div className="bg-[#fbfaf6] min-h-screen">
      <div className="max-w-[1240px] mx-auto px-4 md:px-6 py-6 md:py-8 md:grid md:grid-cols-[240px_minmax(0,1fr)] md:gap-6">
        {/* Desktop: a sticky column whose last item is "Cerrar sesión".
            Phone: the same sections as a swipeable row above the panel. */}
        <aside className="md:sticky md:top-[82px] md:self-start md:h-[calc(100vh-114px)] md:min-h-[360px]">
          <nav aria-label="Secciones de mi cuenta" className="ink-card-sm rounded-2xl bg-white p-2 md:p-3 md:h-full md:flex md:flex-col">
            <div className="hidden md:block px-2 pt-1 pb-3 mb-2 border-b-2 border-foreground/10">
              <p className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mi cuenta</p>
              <p className="mt-1 font-heading font-bold text-base leading-tight truncate">{user?.name}</p>
              <p className="text-xs text-[#3d413e] truncate">{user?.email}</p>
            </div>
            <ul
              className="grid md:flex md:flex-col gap-1 md:flex-1"
              style={{ gridTemplateColumns: `repeat(${SECTIONS.length}, minmax(0, 1fr))` }}
            >
              {SECTIONS.map((id) => {
                const { label, Icon } = SECTION_META[id];
                const count = counts[id];
                return (
                  <li key={id}>
                    <Link
                      to={{ hash: `#${id}` }}
                      replace
                      aria-current={section === id ? "page" : undefined}
                      className={navItem(section === id)}
                    >
                      <Icon className="hidden sm:block h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="md:flex-1">{label}</span>
                      {count !== undefined && saved.mode === "account" && (
                        <span className={`font-mono text-xs ${section === id ? "text-white/80" : "text-muted-foreground"}`}>{count}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="hidden md:block border-t-2 border-foreground/10 pt-2 mt-2">
              <button
                type="button"
                onClick={handleLogout}
                className="flex h-11 w-full items-center gap-2.5 rounded-xl px-3 text-sm font-bold text-foreground hover:bg-[#f1f2f0]"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Cerrar sesión
              </button>
            </div>
          </nav>
        </aside>

        <div className="mt-4 md:mt-0 min-w-0">
          {(section === "guardadas" || section === "postuladas") && (
            <section aria-labelledby="mis-vacantes" className="ink-card-sm rounded-2xl bg-white">
              <header className={`${panelHeader} flex flex-wrap items-center justify-between gap-3`}>
                <div>
                  <h1 id="mis-vacantes" className={panelTitle}>
                    {section === "postuladas" ? "Postuladas" : "Guardadas"}
                  </h1>
                  <p className="text-sm text-[#3d413e]">
                    {section === "postuladas"
                      ? "Las vacantes que marcaste como postuladas."
                      : "Las vacantes que guardaste para revisar después."}
                  </p>
                </div>
                {listed.length > 5 && (
                  <label className="relative w-full sm:w-64">
                    <span className="sr-only">Buscar en mis vacantes</span>
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setShown(PAGE_SIZE);
                      }}
                      placeholder="Buscar cargo o empresa"
                      className="h-10 w-full rounded-xl border-2 border-foreground bg-[#fbfaf6] pl-9 pr-3 text-sm focus:outline-none focus:ring-4 focus:ring-gold-1/60"
                    />
                  </label>
                )}
              </header>

              {saved.mode === "memory" ? (
                <p className="m-4 md:m-5 rounded-xl bg-[#fdf1d3] p-4 text-[#3d413e]">
                  Guardar vacantes en tu cuenta se activa muy pronto. Por ahora, la estrella ☆ las marca solo mientras navegas.
                </p>
              ) : saved.mode === "loading" && entries.length === 0 ? (
                <div aria-busy="true" className="divide-y-2 divide-foreground/5">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-[68px] animate-pulse bg-[#f6f5f0]" />
                  ))}
                </div>
              ) : listed.length === 0 ? (
                <div className="p-6 md:p-10 text-center">
                  <p className="font-heading font-bold text-lg">
                    {section === "postuladas" ? "Aún no marcas ninguna como postulada" : "Aún no guardas vacantes"}
                  </p>
                  <p className="mt-1.5 text-[#3d413e]">
                    {section === "postuladas"
                      ? "Toca «Me postulé» en una vacante cuando ya te hayas postulado."
                      : "Toca «Guardar» en cualquier vacante y aparecerá aquí."}
                  </p>
                  <Link to={dashboardPath} className="ink-card-sm ink-lift mt-4 inline-flex h-11 items-center rounded-xl bg-gold-2 px-5 font-bold text-foreground no-underline">
                    Ver vacantes →
                  </Link>
                </div>
              ) : matching.length === 0 ? (
                <p className="p-6 text-center text-[#3d413e]">Ninguna vacante coincide con «{query.trim()}».</p>
              ) : (
                <>
                  <ul className="divide-y-2 divide-foreground/5">
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
                  <footer className="flex flex-wrap items-center justify-between gap-3 px-4 md:px-5 py-3 border-t-2 border-foreground/10 text-sm text-[#3d413e]">
                    <span>
                      Mostrando {visible.length} de {matching.length}
                    </span>
                    {visible.length < matching.length && (
                      <button
                        type="button"
                        onClick={() => setShown((n) => n + PAGE_SIZE)}
                        className="h-9 rounded-full border-2 border-foreground bg-white px-4 text-sm font-bold text-foreground"
                      >
                        Ver más
                      </button>
                    )}
                  </footer>
                </>
              )}
            </section>
          )}

          {section === "perfil" && (
            <section aria-labelledby="perfil-title" className="ink-card-sm rounded-2xl bg-white">
              <header className={panelHeader}>
                <h1 id="perfil-title" className={panelTitle}>Perfil</h1>
                <p className="text-sm text-[#3d413e]">Tus datos en BuscoTrabajo.</p>
              </header>
              <div className="p-4 md:p-5 space-y-4 max-w-xl">
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
          )}

          {PAYWALL_ENABLED && section === "pagos" && (
            <section aria-labelledby="pagos-title" className="ink-card-sm rounded-2xl bg-white">
              <header className={panelHeader}>
                <h1 id="pagos-title" className={panelTitle}>Historial de pagos</h1>
              </header>
              <div className="p-4 md:p-5">
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
              </div>
            </section>
          )}

          {/* Phone: the menu is a row on top, so "Cerrar sesión" sits at the end of the page. */}
          <button
            type="button"
            onClick={handleLogout}
            className="md:hidden ink-card-sm mt-6 w-full h-12 rounded-xl bg-white inline-flex items-center justify-center gap-2 text-base font-bold text-foreground"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Cerrar sesión
          </button>
        </div>
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
  const title = <span className="font-heading font-bold text-[15px] leading-snug line-clamp-2 lg:line-clamp-1">{entry.title}</span>;
  return (
    // A dense table-like row; phone: actions in a row under the job.
    <li className={`px-4 md:px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 hover:bg-[#fbfaf6] ${entry.available ? "" : "opacity-70"}`}>
      <div className="flex gap-3 min-w-0 flex-1 items-center">
        <CompanyAvatar name={entry.company || entry.source || "?"} logoUrl={null} className="w-9 h-9 text-sm shrink-0" />
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
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[#3d413e]">
            <span className="truncate max-w-full">{[entry.company, entry.location].filter(Boolean).join(" · ")}</span>
            {entry.source && (
              <span className="rounded-full px-2 py-0.5 font-mono text-[11px]" style={{ backgroundColor: color.bg, color: color.text }}>{entry.source}</span>
            )}
            {!entry.available && <span className="rounded-full px-2 py-0.5 font-mono text-[11px] bg-[#f1f2f0]">Ya no disponible</span>}
          </div>
        </div>
      </div>
      <span className="hidden lg:block shrink-0 w-[124px] whitespace-nowrap font-mono text-[11px] text-muted-foreground">{dateLabel(entry.savedAt)}</span>
      <div className="shrink-0 flex items-center justify-between sm:justify-end gap-2 pl-12 sm:pl-0">
        <button
          type="button"
          onClick={onToggleApplied}
          aria-pressed={applied}
          className={`inline-flex h-8 sm:w-[168px] items-center justify-center gap-1.5 whitespace-nowrap rounded-full border-2 border-foreground px-3 text-xs font-bold ${applied ? "bg-primary text-white" : "bg-white text-foreground"}`}
        >
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          {applied ? "Postulada" : "Marcar postulada"}
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Quitar ${entry.title} de mis vacantes`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-foreground/20 text-[#3d413e] hover:border-foreground"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}
