import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import { Search } from "lucide-react";
import { PageHero, ContentCta } from "../components/ContentPage.js";
import { TINTS } from "../lib/brand-tints.js";
import { CompanyAvatar } from "../components/CompanyAvatar.js";
import { usePageMeta } from "../lib/use-page-meta.js";
import { companiesDirectoryMeta } from "../lib/page-meta.js";
import { buildCompanyPath } from "../lib/job-seo.js";
import { getCountryConfig } from "../countries/index.js";

// Shape of the first-page payload the server inlines for anonymous SSR.
type SsrCompaniesWindow = Window & {
  __SSR_COMPANIES__?: { country?: string; companies?: CompanyResult[]; total?: number; hasMore?: boolean };
};

interface CompanyResult {
  company: string;
  count: number;
  logoUrl: string | null;
}

const PAGE_SIZE = 48;
const SEARCH_DEBOUNCE_MS = 350;

// /empresas — a directory over all 5,525+ distinct companies in the corpus
// (see FilterBar.tsx's "Empresa" section, which searches the same
// GET /api/companies/search endpoint but only ever shows one small page —
// this is the "explorar todas las empresas" browsing surface, reusing that
// endpoint's offset/limit paging instead of its own copy). Each card is
// just name + count; clicking goes to the existing /empresas/:slug page
// (CompanyLanding.tsx), which already renders that company's reputation
// and job list — nothing here duplicates that.
export default function CompaniesDirectory() {
  // /empresas (Colombia, default) vs /ve/empresas (Venezuela) — same
  // path-prefix pattern as Dashboard.tsx/Landing.
  const location = useLocation();
  const country = location.pathname.startsWith("/ve") ? "VE" : "CO";
  const countryName = getCountryConfig(country).name;

  const directoryMeta = companiesDirectoryMeta(countryName);
  usePageMeta({ title: directoryMeta.title, description: directoryMeta.description });

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [companies, setCompanies] = useState<CompanyResult[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const requestIdRef = useRef(0);
  // Next page offset, tracked apart from companies.length because appended
  // pages are de-duplicated (a company can shift across a page boundary when
  // counts change between requests), and a synchronous in-flight flag: the
  // isLoadingMore state only updates after a render, so two observer
  // callbacks in a row used to fetch — and append — the same page twice.
  const nextOffsetRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const buildQuery = useCallback(
    (offset: number) => {
      const params = new URLSearchParams();
      if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
      params.set("country", country);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      return params.toString();
    },
    [debouncedSearch, country]
  );

  // Reset + fetch the first page whenever the (debounced) search changes.
  useEffect(() => {
    const myRequestId = ++requestIdRef.current;

    // server.ts's /empresas (and /ve/empresas) route embeds this exact
    // first-page response directly in the HTML — same shortcut
    // Dashboard.tsx/CompanyLanding.tsx already use for their own SSR
    // payloads. Only trusted for the untouched, first-load case (no
    // search typed yet, country matches this mount) — any real search
    // query or country mismatch falls through to the normal fetch below.
    // Deleted immediately after one read.
    const ssrCompanies = (window as SsrCompaniesWindow).__SSR_COMPANIES__;
    delete (window as SsrCompaniesWindow).__SSR_COMPANIES__;
    if (ssrCompanies && ssrCompanies.country === country && debouncedSearch.trim() === "") {
      const ssrList = Array.isArray(ssrCompanies.companies) ? ssrCompanies.companies : [];
      nextOffsetRef.current = ssrList.length;
      setCompanies(ssrList);
      setTotal(ssrCompanies.total || 0);
      setHasMore(!!ssrCompanies.hasMore);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setCompanies([]);
    nextOffsetRef.current = 0;

    fetch(`/api/companies/search?${buildQuery(0)}`)
      .then((res) => (res.ok ? res.json() : { companies: [], total: 0, hasMore: false }))
      .then((data) => {
        if (myRequestId !== requestIdRef.current) return;
        const firstPage = Array.isArray(data.companies) ? data.companies : [];
        nextOffsetRef.current = firstPage.length;
        setCompanies(firstPage);
        setTotal(data.total || 0);
        setHasMore(!!data.hasMore);
      })
      .catch(() => {
        if (myRequestId !== requestIdRef.current) return;
        setCompanies([]);
        setTotal(0);
        setHasMore(false);
      })
      .finally(() => {
        if (myRequestId === requestIdRef.current) setIsLoading(false);
      });
  }, [buildQuery]);

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || !hasMore) return;
    const myRequestId = requestIdRef.current;
    const offset = nextOffsetRef.current;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    fetch(`/api/companies/search?${buildQuery(offset)}`)
      .then((res) => (res.ok ? res.json() : { companies: [], hasMore: false }))
      .then((data) => {
        if (myRequestId !== requestIdRef.current) return;
        const pageItems: CompanyResult[] = Array.isArray(data.companies) ? data.companies : [];
        nextOffsetRef.current = offset + pageItems.length;
        setCompanies((prev) => {
          const seen = new Set(prev.map((c) => c.company));
          return [...prev, ...pageItems.filter((c) => !seen.has(c.company))];
        });
        setHasMore(!!data.hasMore && pageItems.length > 0);
      })
      .catch(() => {})
      .finally(() => {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      });
  }, [buildQuery, hasMore]);

  // Same stale-observer guard as Dashboard.tsx's infinite scroll: loadMore's
  // identity changes every time companies.length/hasMore update, so the
  // IntersectionObserver itself is only created once per loading cycle and
  // always calls the latest loadMore via this ref.
  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  }, [loadMore]);

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

  const dashboardPath = country === "VE" ? "/ve/dashboard" : "/dashboard";

  return (
    <div className="bg-white">
      <PageHero
        eyebrow="Empresas"
        heading={directoryMeta.heading}
        aside={
          <form
            role="search"
            onSubmit={(e) => e.preventDefault()}
            className="ink-card rounded-[18px] md:rounded-[22px] bg-white p-3 md:p-4 md:shadow-[6px_6px_0_hsl(var(--foreground))]"
          >
            <label htmlFor="company-search" className="block mb-2 font-mono text-xs font-semibold tracking-wider text-muted-foreground">
              BUSCAR EMPRESA
            </label>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground pointer-events-none" aria-hidden="true" />
              <input
                id="company-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar empresa..."
                className="w-full h-[54px] md:h-[60px] rounded-xl md:rounded-[14px] border-2 border-foreground bg-[#fbfaf6] pl-12 pr-4 text-[17px] focus:outline-none focus:ring-4 focus:ring-gold-1/60"
              />
            </div>
          </form>
        }
      >
        <p>
          {total > 0
            ? `${total.toLocaleString("es-CO")} empresas con vacantes activas ahora mismo.`
            : "Busca cualquier empresa por nombre."}{" "}
          Haz clic en una para ver su reputación y vacantes.
        </p>
      </PageHero>

      <section className="max-w-[1240px] w-full mx-auto px-4 md:px-6 py-8 md:py-12">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="rounded-2xl border-2 border-foreground/15 bg-white p-4 animate-pulse flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-muted shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-3/4 rounded bg-muted" />
                  <div className="h-2.5 w-1/2 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : companies.length === 0 ? (
          <p className="ink-card-sm rounded-2xl bg-[#fdf1d3] p-5 text-[#3d413e]">Sin empresas que coincidan con tu búsqueda.</p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {companies.map((c, index) => {
              const tint = TINTS[index % TINTS.length]!;
              return (
                <li key={c.company}>
                  <Link
                    to={buildCompanyPath(c.company, country)}
                    className="ink-card-sm ink-lift h-full flex items-center gap-3 rounded-2xl bg-white p-4 text-foreground no-underline"
                  >
                    <CompanyAvatar name={c.company} logoUrl={c.logoUrl} className="w-12 h-12 text-lg" />
                    <span className="min-w-0 flex-1">
                      <strong className="block font-heading font-bold text-[15px] md:text-base truncate">{c.company}</strong>
                      <span className="mt-1 inline-block rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold" style={{ backgroundColor: tint.bg, color: tint.sub }}>
                        {c.count.toLocaleString("es-CO")} vacante{c.count === 1 ? "" : "s"} activa{c.count === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span aria-hidden="true" className="font-bold text-muted-foreground">→</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <div ref={sentinelRef} className="h-4" />
        {isLoadingMore && (
          <p className="text-center text-xs font-mono text-ink-faint py-4">Cargando más empresas...</p>
        )}
      </section>

      {!hasMore && !isLoading ? <ContentCta to={dashboardPath} /> : null}
    </div>
  );
}
