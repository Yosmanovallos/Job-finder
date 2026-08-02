import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { MonoLabel } from "../components/MonoLabel.js";
import { Input } from "../components/ui/input.js";
import { usePageMeta } from "../lib/use-page-meta.js";
import { buildCompanyPath } from "../lib/job-seo.js";

interface CompanyResult {
  company: string;
  count: number;
}

const PAGE_SIZE = 48;
const SEARCH_DEBOUNCE_MS = 350;

function initialFor(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

// /empresas — a directory over all 5,525+ distinct companies in the corpus
// (see FilterBar.tsx's "Empresa" section, which searches the same
// GET /api/companies/search endpoint but only ever shows one small page —
// this is the "explorar todas las empresas" browsing surface, reusing that
// endpoint's offset/limit paging instead of its own copy). Each card is
// just name + count; clicking goes to the existing /empresas/:slug page
// (CompanyLanding.tsx), which already renders that company's reputation,
// native reviews and job list — nothing here duplicates that.
export default function CompaniesDirectory() {
  usePageMeta({
    title: "Empresas | BuscoTrabajo",
    description: "Explora empresas con vacantes activas en BuscoTrabajo — su reputación, reseñas y ofertas."
  });

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [companies, setCompanies] = useState<CompanyResult[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const requestIdRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const buildQuery = useCallback(
    (offset: number) => {
      const params = new URLSearchParams();
      if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      return params.toString();
    },
    [debouncedSearch]
  );

  // Reset + fetch the first page whenever the (debounced) search changes.
  useEffect(() => {
    const myRequestId = ++requestIdRef.current;
    setIsLoading(true);
    setCompanies([]);

    fetch(`/api/companies/search?${buildQuery(0)}`)
      .then((res) => (res.ok ? res.json() : { companies: [], total: 0, hasMore: false }))
      .then((data) => {
        if (myRequestId !== requestIdRef.current) return;
        setCompanies(Array.isArray(data.companies) ? data.companies : []);
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
    if (isLoadingMore || !hasMore) return;
    const myRequestId = requestIdRef.current;
    setIsLoadingMore(true);

    fetch(`/api/companies/search?${buildQuery(companies.length)}`)
      .then((res) => (res.ok ? res.json() : { companies: [], hasMore: false }))
      .then((data) => {
        if (myRequestId !== requestIdRef.current) return;
        setCompanies((prev) => [...prev, ...(Array.isArray(data.companies) ? data.companies : [])]);
        setHasMore(!!data.hasMore);
      })
      .catch(() => {})
      .finally(() => setIsLoadingMore(false));
  }, [buildQuery, companies.length, hasMore, isLoadingMore]);

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

  return (
    <section className="relative w-full min-h-screen bg-background">
      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-20">
        <MonoLabel>EMPRESAS</MonoLabel>
        <h1 className="mt-2 font-heading font-semibold text-2xl sm:text-3xl text-foreground">
          Explora empresas con vacantes activas
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {total > 0
            ? `${total.toLocaleString("es-CO")} empresas con vacantes activas ahora mismo.`
            : "Busca cualquier empresa por nombre."}{" "}
          Haz clic en una para ver su reputación, reseñas y vacantes.
        </p>

        <div className="relative mt-6 mb-8 max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint pointer-events-none" />
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar empresa..."
            className="h-12 pl-11 rounded-full bg-card border-border-strong shadow-sm focus-visible:border-gold-2 focus-visible:ring-4 focus-visible:ring-gold-1/40"
          />
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="rounded-lg border border-border bg-card p-4 animate-pulse flex items-center gap-3"
              >
                <div className="w-11 h-11 rounded-lg bg-muted shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-3/4 rounded bg-muted" />
                  <div className="h-2.5 w-1/2 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : companies.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin empresas que coincidan con tu búsqueda.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {companies.map((c) => (
              <Link
                key={c.company}
                to={buildCompanyPath(c.company)}
                className="hud-corners flex items-center gap-3 rounded-lg border border-border bg-card p-4 hover:border-border-strong transition-colors"
              >
                <div className="shrink-0 w-11 h-11 rounded-lg bg-gradient-to-br from-gold-1 to-gold-2 text-gold-ink font-heading font-semibold text-lg flex items-center justify-center">
                  {initialFor(c.company)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-heading font-semibold text-sm text-foreground truncate">
                    {c.company}
                  </p>
                  <p className="text-xs font-mono text-muted-foreground mt-0.5">
                    <span className="text-primary font-semibold">{c.count}</span> vacante
                    {c.count === 1 ? "" : "s"} activa{c.count === 1 ? "" : "s"}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}

        <div ref={sentinelRef} className="h-4" />
        {isLoadingMore && (
          <p className="text-center text-xs font-mono text-ink-faint py-4">Cargando más empresas...</p>
        )}
      </div>
    </section>
  );
}
