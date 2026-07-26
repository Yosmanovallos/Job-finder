import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { PRO_MONTHLY_PRICE_COP, formatCOP, PAYWALL_ENABLED } from "../config.js";
import { JobCard } from "../components/JobCard.js";
import { PaywallCard } from "../components/PaywallCard.js";
import { FilterBar, FilterState, EMPTY_FILTERS } from "../components/FilterBar.js";
import { StatsBar } from "../components/StatsBar.js";
import { useAuth } from "../auth/auth-provider.js";

type CheckoutBannerState = "confirming" | "success" | "pending" | null;

const PAGE_SIZE = 24;
// Debounce the free-text search box so we don't fire a request per keystroke
// — everything else (checkboxes/radios) triggers immediately since those are
// discrete, deliberate clicks.
const SEARCH_DEBOUNCE_MS = 350;

export default function Dashboard() {
  const { tier, isAuthenticated, accessToken, user, refreshTier } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [jobs, setJobs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(new Set());
  const [appliedJobIds, setAppliedJobIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [checkoutBanner, setCheckoutBanner] = useState<CheckoutBannerState>(null);
  // Filters render inline as a sidebar on desktop, but on mobile they used to
  // stack above the job list — pushing every result below the fold behind a
  // wall of accordions. Below lg they now live behind this toggle instead.
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const sentinelRef = useRef<HTMLDivElement>(null);
  // Guards the fetch effect against a stale response landing after a newer
  // filter change already started a fresh request (fast typing/clicking).
  const requestIdRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [filters.search]);

  const effectiveFilters = useMemo(
    () => ({ ...filters, search: debouncedSearch }),
    [filters, debouncedSearch]
  );
  const filterKey = JSON.stringify(effectiveFilters);

  const buildQuery = useCallback(
    (offset: number) => {
      const params = new URLSearchParams();
      if (effectiveFilters.search.trim()) params.set("search", effectiveFilters.search.trim());
      effectiveFilters.sources.forEach((s) => params.append("sources", s));
      effectiveFilters.cities.forEach((c) => params.append("cities", c));
      if (effectiveFilters.modality !== "all") params.set("modality", effectiveFilters.modality);
      if (effectiveFilters.freshness !== "all") params.set("freshness", effectiveFilters.freshness);
      effectiveFilters.selectedRoles.forEach((r) => params.append("roles", r));
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      return params.toString();
    },
    [effectiveFilters]
  );

  // Personal filters (saved/applied) aren't persisted server-side today, so
  // they only ever apply to whatever's already been loaded in this session —
  // scrolling further wouldn't surface more matches, so infinite scroll is
  // paused while either is active instead of pretending to paginate them.
  const personalFilterActive = filters.savedOnly || filters.appliedOnly;

  // Reset + fetch the first page whenever a filter changes.
  useEffect(() => {
    const myRequestId = ++requestIdRef.current;
    setIsLoading(true);
    setJobs([]);

    const headers: Record<string, string> = {};
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

    fetch(`/api/jobs?${buildQuery(0)}`, { headers })
      .then((res) => (res.ok ? res.json() : { jobs: [], total: 0, hasMore: false }))
      .then((data) => {
        if (myRequestId !== requestIdRef.current) return;
        setJobs(Array.isArray(data.jobs) ? data.jobs : []);
        setTotal(data.total || 0);
        setHasMore(!!data.hasMore);
      })
      .catch(() => {
        if (myRequestId !== requestIdRef.current) return;
        setJobs([]);
        setTotal(0);
        setHasMore(false);
      })
      .finally(() => {
        if (myRequestId === requestIdRef.current) setIsLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, filterKey]);

  const loadMore = useCallback(() => {
    if (isLoadingMore || !hasMore || personalFilterActive) return;
    const myRequestId = requestIdRef.current;
    setIsLoadingMore(true);

    const headers: Record<string, string> = {};
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

    fetch(`/api/jobs?${buildQuery(jobs.length)}`, { headers })
      .then((res) => (res.ok ? res.json() : { jobs: [], hasMore: false }))
      .then((data) => {
        if (myRequestId !== requestIdRef.current) return;
        setJobs((prev) => [...prev, ...(Array.isArray(data.jobs) ? data.jobs : [])]);
        setHasMore(!!data.hasMore);
      })
      .catch(() => {})
      .finally(() => setIsLoadingMore(false));
  }, [accessToken, buildQuery, jobs.length, hasMore, isLoadingMore, personalFilterActive]);

  // Infinite scroll: fetch the next page once the sentinel at the bottom of
  // the list enters the viewport.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  // Wompi redirects back here with ?checkout=return after the sandbox
  // payment. The webhook that actually flips the tier to 'pro' can take a
  // moment to land, so we poll a few times instead of just trusting a
  // single stale read right after the redirect.
  useEffect(() => {
    if (searchParams.get("checkout") !== "return") return;

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("checkout");
        return next;
      },
      { replace: true }
    );

    if (tier === "pro") {
      setCheckoutBanner("success");
      return;
    }

    setCheckoutBanner("confirming");
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts += 1;
      await refreshTier();
      if (attempts >= 5) {
        clearInterval(interval);
        setCheckoutBanner((prev) => (prev === "confirming" ? "pending" : prev));
      }
    }, 2000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (checkoutBanner === "confirming" && tier === "pro") {
      setCheckoutBanner("success");
    }
  }, [tier, checkoutBanner]);

  useEffect(() => {
    if (checkoutBanner === "success") {
      const timeout = setTimeout(() => setCheckoutBanner(null), 6000);
      return () => clearTimeout(timeout);
    }
  }, [checkoutBanner]);

  const handleSaveToggle = (jobId: string) => {
    const next = new Set(savedJobIds);
    if (next.has(jobId)) next.delete(jobId);
    else next.add(jobId);
    setSavedJobIds(next);
  };

  const handleAppliedToggle = (jobId: string) => {
    const next = new Set(appliedJobIds);
    if (next.has(jobId)) next.delete(jobId);
    else next.add(jobId);
    setAppliedJobIds(next);
  };

  const visibleJobs = jobs.filter((j) => {
    if (filters.savedOnly && !savedJobIds.has(j.jobId)) return false;
    if (filters.appliedOnly && !appliedJobIds.has(j.jobId)) return false;
    return true;
  });

  const activeFilterCount =
    filters.sources.length +
    filters.cities.length +
    filters.selectedRoles.length +
    (filters.modality !== "all" ? 1 : 0) +
    (filters.freshness !== "all" ? 1 : 0) +
    (filters.savedOnly ? 1 : 0) +
    (filters.appliedOnly ? 1 : 0);

  useEffect(() => {
    document.body.style.overflow = mobileFiltersOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileFiltersOpen]);

  return (
    <section
      className="relative w-full overflow-x-hidden min-h-screen"
      style={{ backgroundColor: "#fafafa" }}
    >
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-20">
        {checkoutBanner && (
          <div
            className={`mb-4 p-3 rounded-xl text-xs font-mono flex items-center gap-2 ${
              checkoutBanner === "success"
                ? "bg-primary/10 border border-primary/30 text-primary"
                : "bg-accent/10 border border-accent/30 text-accent"
            }`}
          >
            {checkoutBanner === "confirming" && (
              <>
                <span className="w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                Confirmando tu pago con Wompi...
              </>
            )}
            {checkoutBanner === "success" && <>🎉 ¡Listo! Ya eres suscriptor Pro.</>}
            {checkoutBanner === "pending" && (
              <>
                ⏳ Tu pago sigue en proceso de confirmación — puede tardar unos minutos. Si no se
                actualiza, recarga la página más tarde o revisa el historial de pagos en{" "}
                <Link to="/cuenta" className="underline">
                  Mi cuenta
                </Link>
                .
              </>
            )}
          </div>
        )}

        {PAYWALL_ENABLED && (
          <div className="flex items-center justify-between gap-4 mb-6 p-3 rounded-xl bg-[#ffffff] border border-[#e6e8e4] text-xs font-mono">
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${tier === "pro" ? "bg-primary animate-pulse" : "bg-accent"}`}
              />
              <span className="text-foreground">
                Estado de Cuenta:{" "}
                <strong className={tier === "pro" ? "text-primary font-bold" : "text-accent font-bold"}>
                  {tier === "pro"
                    ? `🌟 Suscriptor Pro (${user?.email})`
                    : isAuthenticated
                      ? "FREE (Vacantes >48h Gratuitas / 0-48h Bloqueadas)"
                      : "Explorando sin cuenta (Vacantes >48h Gratuitas)"}
                </strong>
              </span>
            </div>

            {tier === "free" && (
              <button
                onClick={() => navigate("/pricing")}
                className="px-3 py-1 rounded bg-accent hover:bg-accent text-primary-foreground font-bold font-sans text-xs transition-all shadow"
              >
                🔓 Desbloquear Pro por {formatCOP(PRO_MONTHLY_PRICE_COP)} COP
              </button>
            )}
          </div>
        )}

        {/* Top search bar + mobile filters trigger */}
        <div className="mb-4 flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint">🔍</span>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder="Título, empresa o palabra clave..."
              className="w-full pl-11 pr-4 py-3 bg-[#ffffff] border border-[#e6e8e4] rounded-xl text-foreground placeholder-slate-500 text-sm focus:outline-none focus:border-primary/50"
            />
          </div>
          <button
            type="button"
            onClick={() => setMobileFiltersOpen(true)}
            className="lg:hidden shrink-0 relative px-4 py-3 rounded-xl border border-[#e6e8e4] bg-[#ffffff] text-sm font-medium text-foreground"
          >
            🔧 Filtros
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-mono font-bold flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          <div className="hidden lg:block">
            <FilterBar filters={filters} onFilterChange={setFilters} />
          </div>

          {/* Mobile filter sheet — full-screen overlay instead of an inline
              block, so the job list is never pushed below a wall of
              accordions on small screens. */}
          {mobileFiltersOpen && (
            <div className="lg:hidden fixed inset-0 z-50 bg-[#fafafa] flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#e6e8e4] bg-[#ffffff] shrink-0">
                <h2 className="font-heading font-semibold text-base text-foreground">Filtros</h2>
                <button
                  type="button"
                  onClick={() => setMobileFiltersOpen(false)}
                  aria-label="Cerrar filtros"
                  className="w-9 h-9 rounded-lg border border-[#e6e8e4] flex items-center justify-center text-lg"
                >
                  ×
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <FilterBar filters={filters} onFilterChange={setFilters} />
              </div>
              <div className="shrink-0 p-4 border-t border-[#e6e8e4] bg-[#ffffff]">
                <button
                  type="button"
                  onClick={() => setMobileFiltersOpen(false)}
                  className="w-full py-3 rounded-lg bg-primary text-primary-foreground font-semibold text-sm"
                >
                  Ver {total} resultado{total === 1 ? "" : "s"}
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 min-w-0">
            <StatsBar totalJobs={total} filteredJobs={visibleJobs.length} />

            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-xl p-5 border border-[#e6e8e4] bg-[#ffffff] animate-pulse space-y-3"
                  >
                    <div className="h-4 w-3/4 rounded bg-[#f1f2f0]" />
                    <div className="h-3 w-1/2 rounded bg-[#f1f2f0]" />
                    <div className="h-3 w-2/3 rounded bg-[#f1f2f0]" />
                  </div>
                ))}
              </div>
            ) : visibleJobs.length > 0 ? (
              <>
                <div className="space-y-3">
                  {visibleJobs.map((job) =>
                    job.isLocked ? (
                      <PaywallCard
                        key={job.jobId || job.url}
                        job={job}
                        onUnlockClick={() => navigate("/pricing")}
                      />
                    ) : (
                      <JobCard
                        key={job.jobId || job.url}
                        job={{
                          ...job,
                          isSaved: savedJobIds.has(job.jobId),
                          isApplied: appliedJobIds.has(job.jobId)
                        }}
                        onSaveToggle={handleSaveToggle}
                        onAppliedToggle={handleAppliedToggle}
                      />
                    )
                  )}
                </div>

                {!personalFilterActive && (
                  <div ref={sentinelRef} className="h-10 flex items-center justify-center mt-4">
                    {isLoadingMore && (
                      <span className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    )}
                    {!hasMore && jobs.length > 0 && (
                      <span className="text-xs font-mono text-ink-faint">
                        Ya viste todas las vacantes que coinciden.
                      </span>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-16 px-4 rounded-2xl border border-[#e6e8e4] bg-[#ffffff] text-muted-foreground font-mono">
                <span className="text-3xl block mb-2">🔍</span>
                No se encontraron vacantes con los filtros seleccionados.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
