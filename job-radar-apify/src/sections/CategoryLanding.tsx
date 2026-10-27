import { useState, useEffect } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { CategoryJobRow } from "../components/CategoryJobRow.js";
import { ContentCta } from "../components/ContentPage.js";
import { usePageMeta } from "../lib/use-page-meta.js";
import {
  resolveCategorySlug,
  buildCategoryMeta,
  buildCategoryInsights,
  buildCategoryInternalLinks,
  buildRelatedCityLinks,
  buildCategorySectionHeadings,
  type CategoryInsights
} from "../lib/job-seo.js";
import { isVePrefixed } from "../lib/country-context.js";
import { Button } from "../components/ui/button.js";
import { Job } from "../sources/types.js";
import { ArrowLeft } from "lucide-react";

type LoadState = "loading" | "found" | "not-found";

interface SsrCategoryPayload {
  slug: string;
  country: string;
  jobs?: Job[];
  total?: number;
  insights?: CategoryInsights;
}

declare global {
  interface Window {
    __SSR_CATEGORY__?: SsrCategoryPayload;
  }
}

const PAGE_LIMIT = 60;

interface CategoryPageState {
  id?: string;
  jobs: Job[];
  total: number;
  insights: CategoryInsights | null;
  state: LoadState;
  fromSsr?: boolean;
}

// Client-side counterpart of server.ts's /empleos/<slug> (and
// /ve/empleos/<slug> for roles) category branch — what a real visitor sees
// after React hydrates (a crawler only ever sees the server-rendered HTML,
// same split as JobLanding.tsx). Reached via EmpleosRoute.tsx's isUuid()
// dispatch, so `id` here is always a non-UUID category slug, never a jobId.
// Same page shell as the company page (ink breadcrumb on a soft-green band,
// ink cards), so a job opened from any hub looks the same.
export default function CategoryLanding() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // Only affects "rol" categories (a city match already carries its own
  // country regardless of prefix — see job-seo.ts's ResolvedCategory) but
  // cheap to compute unconditionally, same pattern as every other
  // country-aware component in this app.
  const requestCountry = isVePrefixed(location.pathname) ? "VE" : "CO";
  const dashboardPath = requestCountry === "VE" ? "/ve/dashboard" : "/dashboard";

  const category = id ? resolveCategorySlug(id, requestCountry) : null;

  // server.ts's category branch embeds this exact response (see its
  // comment on window.__SSR_CATEGORY__) — a first anonymous visitor with
  // untouched filters doesn't need the round trip at all, it's the same
  // data. Matters for more than just performance: without this, a
  // transient failure in the redundant client fetch below (rate limit,
  // network hiccup, a crawler giving up waiting) replaced a perfectly
  // real, populated page with a fake "esta categoría no existe" — this
  // is what actually happened in production for /empleos/caracas, caught
  // via Search Console's URL Inspection tool reporting a soft-404 on a
  // page that server-rendered correctly. Checked against BOTH slug and
  // country so a stale payload from a different category never gets
  // reused, and read on the first render (not in an effect) so the page
  // never shows a short skeleton first.
  const [page, setPage] = useState<CategoryPageState>(() => {
    const ssrCategory = window.__SSR_CATEGORY__;
    if (category && ssrCategory && ssrCategory.slug === id && ssrCategory.country === category.country) {
      delete window.__SSR_CATEGORY__;
      const jobs = Array.isArray(ssrCategory.jobs) ? ssrCategory.jobs : [];
      const total = ssrCategory.total || 0;
      return { id, jobs, total, insights: ssrCategory.insights || buildCategoryInsights(category, total, jobs), state: "found", fromSsr: true };
    }
    return { id, jobs: [], total: 0, insights: null, state: category ? "loading" : "not-found" };
  });
  const current: CategoryPageState =
    page.id === id ? page : { id, jobs: [], total: 0, insights: null, state: category ? "loading" : "not-found" };
  const { jobs, total, insights, state } = current;

  useEffect(() => {
    if (!category) {
      setPage({ id, jobs: [], total: 0, insights: null, state: "not-found" });
      return;
    }
    if (page.id === id && page.fromSsr) return;

    let cancelled = false;
    setPage({ id, jobs: [], total: 0, insights: null, state: "loading" });
    const params = new URLSearchParams();
    params.set(category.kind === "ciudad" ? "cities" : "roles", category.label);
    params.set("country", category.country);
    params.set("limit", String(PAGE_LIMIT));

    fetch(`/api/jobs?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data) {
          const nextJobs = data.jobs || [];
          const nextTotal = data.total || 0;
          setPage({ id, jobs: nextJobs, total: nextTotal, insights: buildCategoryInsights(category, nextTotal, nextJobs), state: "found" });
        } else {
          setPage({ id, jobs: [], total: 0, insights: null, state: "not-found" });
        }
      })
      .catch(() => {
        if (!cancelled) setPage({ id, jobs: [], total: 0, insights: null, state: "not-found" });
      });
    return () => {
      cancelled = true;
    };
    // Dependencies intentionally limited to the list below: `category` is
    // derived from them, and `page` only gates the first SSR-backed run.
  }, [id, requestCountry]);

  const meta = category ? buildCategoryMeta(category, total) : null;
  const internalLinks = category ? buildCategoryInternalLinks(category) : [];
  const relatedCityLinks = category ? buildRelatedCityLinks(category) : [];
  const sectionHeadings = category ? buildCategorySectionHeadings(category) : null;
  usePageMeta({
    title: meta?.title ?? "Cargando vacantes... | BuscoTrabajo",
    description: meta?.description ?? "Cargando vacantes de esta categoría."
  });

  // Job cards pass this page as their origin, so the job page's back link
  // returns here.
  const origin = category
    ? { label: category.kind === "ciudad" ? `Empleos en ${category.label}` : category.label, path: location.pathname }
    : undefined;

  return (
    // While loading, the page keeps a screen's height so the footer never
    // rises into view and jumps when the jobs arrive.
    <div className={`bg-white ${state === "loading" ? "min-h-screen" : ""}`}>
      <section className="bg-gradient-to-b from-green-soft to-white">
        <div className="max-w-[1240px] mx-auto px-4 md:px-6 pt-6 pb-8 md:pt-12 md:pb-12">
          <nav aria-label="Ruta" className="mb-5 md:mb-7 flex flex-wrap items-center gap-2 text-sm font-semibold">
            <Link
              to={dashboardPath}
              className="ink-card-sm ink-lift inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-foreground no-underline"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Ver todas las vacantes
            </Link>
          </nav>

          {state === "not-found" && (
            <div className="ink-card rounded-3xl bg-white p-8 md:p-12 text-center">
              <p className="font-heading font-bold text-2xl md:text-3xl">Esta categoría no existe.</p>
              <div className="mt-6">
                <Button onClick={() => navigate(dashboardPath)}>Ver todas las vacantes</Button>
              </div>
            </div>
          )}

          {state !== "not-found" && meta && (
            <>
              {/* 40px on desktop, one line: at the company page's 58px this
                  heading outgrew the server-rendered job list, the page's
                  LCP element (~0.8 s), and became a new LCP at ~3 s. */}
              <h1 className="font-heading font-bold tracking-[-0.04em] leading-[1.05] text-[30px] md:text-[40px]">
                {meta.heading}
              </h1>
              <p className="mt-3 md:mt-4">
                <span className="ink-card-sm inline-flex items-center gap-2 rounded-full bg-[#fdf1d3] px-3 py-1 text-sm font-semibold shadow-none">
                  <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-primary" />
                  {state === "loading"
                    ? "Cargando..."
                    : `${total.toLocaleString("es-CO")} vacante${total === 1 ? "" : "s"} encontrada${total === 1 ? "" : "s"}.`}
                </span>
              </p>
            </>
          )}
        </div>
      </section>

      {state === "loading" && meta && (
        <section aria-busy="true" className="max-w-[1240px] w-full mx-auto px-4 md:px-6 pb-12">
          <div className="h-[260px] rounded-3xl border-2 border-foreground/15 bg-white animate-pulse mb-8" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[120px] rounded-2xl border-2 border-foreground/15 bg-white animate-pulse" />
            ))}
          </div>
        </section>
      )}

      {state === "found" && meta && (
        <>
          {total === 0 && (
            <section className="max-w-[1240px] w-full mx-auto px-4 md:px-6 pb-8">
              <p className="ink-card-sm rounded-2xl bg-[#fdf1d3] p-5 text-[#3d413e]">No hay vacantes en esta categoría por ahora.</p>
            </section>
          )}

          {insights && (
            <section className="sr-host max-w-[1240px] w-full mx-auto px-4 md:px-6">
              <div
                data-category-overview
                aria-label="Resumen de las vacantes"
                className="sr ink-card-sm md:ink-card rounded-2xl md:rounded-3xl bg-white p-5 md:p-7"
              >
                {/* 14px, the size of the previous design: the
                    server-rendered copy of this paragraph (or of the job
                    list) is the page's LCP element (~0.85 s), and a larger
                    React copy would count as a new LCP when the bundle
                    lands (~3 s). */}
                <p className="text-sm leading-6 text-foreground max-w-[900px]">{insights.intro}</p>
                <dl className="mt-5 grid grid-cols-3 gap-2 md:gap-3">
                  <div className="rounded-xl md:rounded-2xl border-2 border-foreground bg-green-soft p-2.5 md:p-4">
                    <dt className="font-mono text-[10px] md:text-xs leading-tight font-semibold uppercase tracking-wide text-primary">Empresas en la muestra</dt>
                    <dd className="mt-1.5 md:mt-1 font-heading font-bold text-[26px] md:text-[34px] leading-none tracking-[-0.03em]">{insights.companyCount}</dd>
                  </div>
                  <div className="rounded-xl md:rounded-2xl border-2 border-foreground bg-[#fdf1d3] p-2.5 md:p-4">
                    <dt className="font-mono text-[10px] md:text-xs leading-tight font-semibold uppercase tracking-wide text-gold-3">Fuentes verificables</dt>
                    <dd className="mt-1.5 md:mt-1 font-heading font-bold text-[26px] md:text-[34px] leading-none tracking-[-0.03em]">{insights.sources.length}</dd>
                  </div>
                  <div className="rounded-xl md:rounded-2xl border-2 border-foreground bg-white p-2.5 md:p-4">
                    <dt className="font-mono text-[10px] md:text-xs leading-tight font-semibold uppercase tracking-wide text-muted-foreground">Publicadas en 7 días</dt>
                    <dd className="mt-1.5 md:mt-1 font-heading font-bold text-[26px] md:text-[34px] leading-none tracking-[-0.03em]">{insights.freshLast7Days}</dd>
                  </div>
                </dl>

                <div className="mt-5 space-y-2 text-sm leading-relaxed text-[#3d413e]">
                  {insights.topCompanies.length > 0 && (
                    <p>
                      <strong className="text-foreground">Empresas visibles:</strong> {insights.topCompanies.join(", ")}.
                    </p>
                  )}
                  {insights.sources.length > 0 && (
                    <p>
                      <strong className="text-foreground">Fuentes:</strong> {insights.sources.join(", ")}.
                    </p>
                  )}
                  {insights.modalities.length > 0 && (
                    <p>
                      <strong className="text-foreground">Modalidades:</strong>{" "}
                      {insights.modalities.map((item) => `${item.label} (${item.count})`).join(", ")}.
                    </p>
                  )}
                  {insights.latestPublishedLabel && (
                    <p>
                      <strong className="text-foreground">Última publicación visible:</strong> {insights.latestPublishedLabel}.
                    </p>
                  )}
                </div>

                {internalLinks.length > 0 && (
                  <nav aria-label="Explorar más empleos" className="mt-5 flex flex-wrap gap-2">
                    {internalLinks.map((link) => (
                      <Link
                        key={link.href}
                        to={link.href}
                        className="ink-card-sm ink-lift rounded-full bg-white px-3.5 py-1.5 text-sm font-bold text-foreground no-underline"
                      >
                        {link.label}
                      </Link>
                    ))}
                  </nav>
                )}
              </div>
            </section>
          )}

          {jobs.length > 0 && (
            <section className="sr-host max-w-[1240px] w-full mx-auto px-4 md:px-6 py-8 md:py-12">
              {sectionHeadings && (
                <h2 className="sr font-heading font-bold text-[24px] md:text-[36px] leading-tight tracking-[-0.03em] mb-4 md:mb-6">
                  {sectionHeadings.jobs}
                </h2>
              )}
              <ul className="sr-stagger grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                {jobs.map((job) => (
                  <li key={job.jobId} className="sr">
                    <CategoryJobRow job={job} origin={origin} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {sectionHeadings && relatedCityLinks.length > 0 && (
            <section
              data-related-cities
              aria-label={sectionHeadings.relatedCities}
              className="sr-host max-w-[1240px] w-full mx-auto px-4 md:px-6 pb-8 md:pb-12"
            >
              <h2 className="sr font-heading font-bold text-[24px] md:text-[36px] leading-tight tracking-[-0.03em] mb-4 md:mb-6">
                {sectionHeadings.relatedCities}
              </h2>
              <ul className="sr flex flex-wrap gap-2">
                {relatedCityLinks.map((link) => (
                  <li key={link.href}>
                    <Link
                      to={link.href}
                      className="ink-card-sm ink-lift inline-flex rounded-full bg-white px-3.5 py-1.5 text-sm font-bold text-foreground no-underline"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <ContentCta to={dashboardPath} />
        </>
      )}
    </div>
  );
}
