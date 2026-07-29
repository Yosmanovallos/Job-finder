import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { PRO_MONTHLY_PRICE_COP, formatCOP, PAYWALL_ENABLED } from "../config.js";
import { JobCard } from "../components/JobCard.js";
import { PaywallCard } from "../components/PaywallCard.js";
import { ApplyGateModal } from "../components/ApplyGateModal.js";
import { JobListItem } from "../components/JobListItem.js";
import { JobDetailPanel } from "../components/JobDetailPanel.js";
import { FilterBar, FilterState, EMPTY_FILTERS, CITY_OPTIONS } from "../components/FilterBar.js";
import { StatsBar } from "../components/StatsBar.js";
import { useAuth } from "../auth/auth-provider.js";
import { usePageMeta } from "../lib/use-page-meta.js";
import { Input } from "../components/ui/input.js";
import { Button } from "../components/ui/button.js";
import { Search, SlidersHorizontal, Unlock, ArrowUpRight, X } from "lucide-react";

type CheckoutBannerState = "confirming" | "success" | "pending" | null;

const PAGE_SIZE = 24;
// Debounce the free-text search box so we don't fire a request per keystroke
// — everything else (checkboxes/radios) triggers immediately since those are
// discrete, deliberate clicks.
const SEARCH_DEBOUNCE_MS = 350;

export default function Dashboard() {
  usePageMeta({
    title: "Vacantes de Empleo en Colombia | BuscoTrabajo",
    description:
      "Explora vacantes actualizadas de LinkedIn, Computrabajo, Elempleo y más, filtradas y sin duplicados. Gratis para vacantes con más de 48h publicadas."
  });

  const { tier, isAuthenticated, accessToken, user, refreshTier } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // The landing hero's search box and quick chips ("Últimas 48h", "Remoto",
  // "Bogotá") link here with query params — read once on mount so following
  // that link actually lands on the matching results instead of the
  // unfiltered dashboard.
  const [filters, setFilters] = useState<FilterState>(() => ({
    ...EMPTY_FILTERS,
    search: searchParams.get("search") || "",
    modality: searchParams.get("modality") || "all",
    freshness: searchParams.get("freshness") || "all",
    cities: searchParams.get("cities") ? [searchParams.get("cities") as string] : []
  }));
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get("search") || "");
  const [jobs, setJobs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(new Set());
  const [appliedJobIds, setAppliedJobIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [checkoutBanner, setCheckoutBanner] = useState<CheckoutBannerState>(null);
  // Job the apply-gate modal is currently open for (null = closed). Shared
  // between the mobile JobCard list and the desktop detail panel so both
  // trigger the exact same modal instead of each owning a copy.
  const [applyGateJob, setApplyGateJob] = useState<any | null>(null);
  // Set once the apply_job=<id> effect (below) resolves — renders a banner
  // with a real, user-clicked link to the job the visitor registered to
  // apply for, since auto-opening it isn't reliable (see that effect).
  const [applyContinueJob, setApplyContinueJob] = useState<any | null>(null);
  // Filters live behind this "Filtros" sheet at every breakpoint now (see
  // the top bar below) — a persistent sidebar column would put filters,
  // list and detail side by side as three separate columns, which is what
  // we're moving away from.
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  // Desktop split-pane (list + sticky detail panel) vs. the mobile stacked
  // JobCard list are genuinely different DOM trees, not just different CSS
  // — rendering both simultaneously (one hidden via Tailwind's
  // `hidden`/`lg:hidden`) doubles the mounted components (and their hooks)
  // per job, which gets slower the further an infinite-scrolled list grows.
  // This mirrors the `lg` breakpoint (1024px) so only one tree ever mounts.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches
  );
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsDesktop(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

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

  // loadMore's identity changes on every jobs-length/hasMore update (it's a
  // useCallback closing over both). The observer effects below must NOT
  // depend on it directly — recreating an IntersectionObserver re-checks
  // the sentinel's current position immediately, and while a fresh batch
  // of cards is still settling into the DOM that recheck can read stale
  // (pre-layout) geometry and report "still intersecting" one more time —
  // cascading into a runaway loop of loads. A ref keeps the observer itself
  // stable across the whole mount while still always calling the latest
  // loadMore.
  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  }, [loadMore]);

  // Infinite scroll, shared by both the mobile stacked list and the desktop
  // split-pane (both use normal page flow, no inner scroll container): fetch
  // the next page once the bottom-of-page sentinel enters the viewport. It
  // only exists in the DOM once the first page has loaded (inside the
  // `visibleJobs.length > 0` branch, which is cleared during every refetch)
  // — re-run on `isLoading` flipping false so the observer re-attaches to
  // the fresh DOM node each time, instead of depending on `loadMore` itself
  // (see loadMoreRef comment above).
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMoreRef.current();
      },
      { rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isLoading]);

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

  // A user who registered from the apply-gate modal comes back here with
  // ?apply_job=<id> — re-fetch that one job directly (not from the
  // paginated `jobs` list, which may not even include it once loaded).
  // Deliberately does NOT call window.open() here: this fires after an
  // OAuth redirect + an async fetch, both of which strip the browser's
  // "user activation" flag, so an auto-opened tab would be silently
  // popup-blocked in every major browser — worse than doing nothing, since
  // the user would have no idea it failed. A real button the user clicks
  // themselves always carries a fresh user gesture, so target="_blank"
  // works reliably there instead.
  const appliedAutoOpenRef = useRef(false);
  useEffect(() => {
    const applyJobId = searchParams.get("apply_job");
    if (!applyJobId || appliedAutoOpenRef.current) return;
    appliedAutoOpenRef.current = true;

    const headers: Record<string, string> = {};
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

    fetch(`/api/jobs/${encodeURIComponent(applyJobId)}`, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.job?.url) setApplyContinueJob(data.job);
      })
      .catch(() => {})
      .finally(() => {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete("apply_job");
            return next;
          },
          { replace: true }
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

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

  // Desktop split-pane: which job the right-hand detail panel shows. Only
  // meaningful at lg+ (mobile keeps the old stacked JobCard list, no
  // detail pane) but tracked unconditionally since it's cheap either way.
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  useEffect(() => {
    if (visibleJobs.length === 0) {
      setSelectedJobId(null);
      return;
    }
    if (selectedJobId && visibleJobs.some((j) => j.jobId === selectedJobId)) return;
    const firstUnlocked = visibleJobs.find((j) => !j.isLocked) || visibleJobs[0];
    setSelectedJobId(firstUnlocked.jobId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleJobs]);
  const selectedJob = visibleJobs.find((j) => j.jobId === selectedJobId) || null;

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
    <section className="relative w-full min-h-screen" style={{ backgroundColor: "#fafafa" }}>
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

        {applyContinueJob && (
          <div className="flex items-center justify-between gap-4 mb-4 p-3 rounded-xl bg-primary/10 border border-primary/30 text-xs font-mono">
            <span className="text-foreground">
              ¡Cuenta lista! Continúa a{" "}
              <strong className="text-primary">{applyContinueJob.title}</strong>.
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <Button asChild size="sm">
                <a
                  href={applyContinueJob.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setApplyContinueJob(null)}
                >
                  Continuar a la vacante <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              </Button>
              <button
                type="button"
                onClick={() => setApplyContinueJob(null)}
                aria-label="Cerrar"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
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
                <strong
                  className={tier === "pro" ? "text-primary font-bold" : "text-accent font-bold"}
                >
                  {tier === "pro"
                    ? `🌟 Suscriptor Pro (${user?.email})`
                    : isAuthenticated
                      ? "FREE (Vacantes >48h Gratuitas / 0-48h Bloqueadas)"
                      : "Explorando sin cuenta (Vacantes >48h Gratuitas)"}
                </strong>
              </span>
            </div>

            {tier === "free" && (
              <Button variant="gold" size="sm" onClick={() => navigate("/pricing")}>
                <Unlock className="h-3.5 w-3.5" />
                Desbloquear Pro por {formatCOP(PRO_MONTHLY_PRICE_COP)} COP
              </Button>
            )}
          </div>
        )}

        {/* Top search bar + filters trigger — sticky so the user can always
            get to search/filters without scrolling back up, on mobile
            (where this doubles as the filters entry point) and desktop
            alike. Same rounded-full/gold-focus treatment as the landing
            hero's search input, for a consistent feel. Solid background so
            content scrolling underneath doesn't show through, and its own
            padding (not a negative-margin bleed trick) so nothing below it
            can end up visually clipped. */}
        <div className="sticky top-16 z-40 bg-background pt-3 pb-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint pointer-events-none" />
              <Input
                type="text"
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                placeholder="Título, empresa o palabra clave..."
                className="h-12 pl-11 rounded-full bg-card border-border-strong shadow-sm focus-visible:border-gold-2 focus-visible:ring-4 focus-visible:ring-gold-1/40"
              />
            </div>

            {/* lg+: a few quick filters live inline right next to search —
                everything else (fuente/portal, rol buscado, mis vacantes)
                stays behind the "Filtros" sheet below, since a 200-role
                checkbox list has no reasonable inline form. */}
            <select
              value={filters.freshness}
              onChange={(e) => setFilters((f) => ({ ...f, freshness: e.target.value }))}
              className="hidden lg:block h-12 rounded-full border border-border-strong bg-card px-4 text-sm shadow-sm"
              aria-label="Fecha de publicación"
            >
              <option value="all">Cualquier fecha</option>
              <option value="24h">Últimas 24 horas</option>
              <option value="48h">Últimas 48 horas</option>
              <option value="7d">Última semana</option>
            </select>
            <select
              value={filters.modality}
              onChange={(e) => setFilters((f) => ({ ...f, modality: e.target.value }))}
              className="hidden lg:block h-12 rounded-full border border-border-strong bg-card px-4 text-sm shadow-sm"
              aria-label="Modalidad"
            >
              <option value="all">Cualquier modalidad</option>
              <option value="remoto">100% remoto</option>
              <option value="hibrido">Híbrido</option>
              <option value="presencial">Presencial</option>
            </select>
            <select
              value={filters.cities[0] || "all"}
              onChange={(e) =>
                setFilters((f) => ({ ...f, cities: e.target.value === "all" ? [] : [e.target.value] }))
              }
              className="hidden lg:block h-12 rounded-full border border-border-strong bg-card px-4 text-sm shadow-sm"
              aria-label="Ciudad"
            >
              <option value="all">Cualquier ciudad</option>
              {CITY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <div className="relative shrink-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setMobileFiltersOpen((v) => !v)}
                className="relative h-12 rounded-full px-5 shadow-sm"
              >
                <SlidersHorizontal className="h-4 w-4" />
                Filtros
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-mono font-bold flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </Button>

              {/* lg+: an anchored dropdown right under the button — keeps
                  the list/detail visible behind it instead of replacing the
                  whole screen. Below lg there's no room for a floating
                  panel that size, so mobile keeps the full-screen sheet
                  (rendered separately below). */}
              {mobileFiltersOpen && isDesktop && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMobileFiltersOpen(false)} />
                  {/* FilterBar already renders its own card (border, title,
                      "Limpiar todo") — this wrapper only positions/sizes/
                      scrolls it, no second header on top of that one. */}
                  <div className="absolute right-0 top-full mt-2 w-[26rem] max-h-[70vh] overflow-y-auto rounded-xl shadow-xl z-20">
                    <FilterBar filters={filters} onFilterChange={setFilters} />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Below lg: full-screen filter sheet (there's no room for a
            floating popover at that width). */}
        {mobileFiltersOpen && !isDesktop && (
          <div className="fixed inset-0 z-[60] bg-[#fafafa] flex flex-col">
            {/* Just the close affordance — FilterBar's own card already has
                the "Filtros" heading and "Limpiar todo", right below. */}
            <div className="flex items-center justify-end px-4 py-3 border-b border-[#e6e8e4] bg-[#ffffff] shrink-0">
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                aria-label="Cerrar filtros"
                className="w-9 h-9 rounded-lg border border-[#e6e8e4] flex items-center justify-center text-lg"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 max-w-xl w-full mx-auto">
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

        <div>
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
                {isDesktop ? (
                  /* Desktop split-pane: compact clickable list on the left,
                     sticky detail panel on the right — same master-detail
                     pattern JobLeads/LinkedIn Jobs use. Both columns follow
                     normal page flow (no inner overflow-y-auto column) so
                     there's a single native scrollbar for the whole page —
                     same as the plain stacked list always had. */
                  <div className="grid grid-cols-[380px_1fr] gap-4 items-start">
                    <div className="space-y-3">
                      {visibleJobs.map((job) =>
                        job.isLocked ? (
                          <PaywallCard
                            key={job.jobId || job.url}
                            job={job}
                            onUnlockClick={() => navigate("/pricing")}
                          />
                        ) : (
                          <JobListItem
                            key={job.jobId || job.url}
                            job={job}
                            selected={job.jobId === selectedJobId}
                            onClick={() => setSelectedJobId(job.jobId)}
                          />
                        )
                      )}
                    </div>

                    {/* top-40 (160px), not top-32 (128px): the sticky
                        search bar above sits at top-16 (64px) and is
                        76px tall, so its own bottom edge lands at 140px.
                        Anything less than that here and the search bar's
                        opaque z-40 background paints over the top of this
                        card while scrolled, wiping out its color strip —
                        this leaves a clean 20px gap below it instead. */}
                    <div className="sticky top-40">
                      {selectedJob?.isLocked ? (
                        <div className="rounded-lg border border-border bg-card p-8 text-center">
                          <p className="text-sm text-muted-foreground mb-4">
                            Esta vacante es reciente y está reservada para suscriptores Pro.
                          </p>
                          <Button variant="gold" onClick={() => navigate("/pricing")}>
                            <Unlock className="h-3.5 w-3.5" />
                            Desbloquear Pro
                          </Button>
                        </div>
                      ) : (
                        <JobDetailPanel
                          job={
                            selectedJob
                              ? {
                                  ...selectedJob,
                                  isSaved: savedJobIds.has(selectedJob.jobId),
                                  isApplied: appliedJobIds.has(selectedJob.jobId)
                                }
                              : null
                          }
                          onSaveToggle={handleSaveToggle}
                          onAppliedToggle={handleAppliedToggle}
                          onApplyClick={setApplyGateJob}
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  /* Mobile / below-lg: stacked full-card list — there's no
                     room for a second pane, so each card carries its own
                     actions (as it always has). */
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
                          onApplyClick={setApplyGateJob}
                        />
                      )
                    )}
                  </div>
                )}

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

      {applyGateJob && (
        <ApplyGateModal job={applyGateJob} onClose={() => setApplyGateJob(null)} />
      )}
    </section>
  );
}
