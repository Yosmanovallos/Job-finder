import { useState, useEffect } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { CategoryJobRow } from "../components/CategoryJobRow.js";
import { ContentCta } from "../components/ContentPage.js";
import { usePageMeta } from "../lib/use-page-meta.js";
import {
  resolveCategoryPath,
  buildCategoryPath,
  type ResolvedCategory,
  buildCategoryMeta,
  cityHubPlaces,
  buildCategoryInsights,
  buildCategoryInternalLinks,
  buildRelatedCityLinks,
  buildCategorySectionHeadings,
  buildCategoryStatsCopy,
  type CategoryInsights
} from "../lib/job-seo.js";
import { isVePrefixed } from "../lib/country-context.js";
import { Button } from "../components/ui/button.js";
import { Job } from "../sources/types.js";
import { ArrowLeft } from "lucide-react";
import type { NewTodayBlock } from "../lib/recent-jobs.js";
import { IntentAnswerBlock } from "../components/IntentAnswerBlock.js";
import { INTENT_LINKS_HEADING, isIntentAnswer, type IntentAnswer, type IntentLink } from "../lib/intent-pages.js";

function isIntentLinks(value: unknown): value is IntentLink[] {
  return Array.isArray(value) && value.every((link) => typeof link?.href === "string" && typeof link?.label === "string");
}

// What the server rendered while INTENT_PAGES_ENABLED=false: the CO
// "Remoto" city bucket (ADR 0012 §10).
const LEGACY_REMOTE: ResolvedCategory = { kind: "ciudad", label: "Remoto", country: "CO" };

// The server embeds the block it rendered; only a well-formed one is shown,
// so the hydrated DOM links exactly what the server HTML linked.
function isNewTodayBlock(value: unknown): value is NewTodayBlock {
  const block = value as NewTodayBlock | undefined;
  return Boolean(block && typeof block.heading === "string" && Array.isArray(block.links) && block.links.length > 0);
}

type LoadState = "loading" | "found" | "not-found";

interface SsrCategoryPayload {
  slug: string;
  country: string;
  jobs?: Job[];
  total?: number;
  insights?: CategoryInsights;
  /** SEO Fase B «Nuevas hoy» (src/lib/recent-jobs.ts); absent when no job qualifies. */
  newToday?: NewTodayBlock;
  /** Intent pages only (ADR 0012). */
  intent?: string;
  indexable?: boolean;
  answer?: IntentAnswer;
  /** City hubs: intent pages that pass the guard. */
  intentLinks?: IntentLink[];
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
  newToday?: NewTodayBlock | null;
  answer?: IntentAnswer | null;
  intentLinks?: IntentLink[];
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
  const { id, slug } = useParams<{ id: string; slug?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // Only affects "rol" categories (a city match already carries its own
  // country regardless of prefix — see job-seo.ts's ResolvedCategory) but
  // cheap to compute unconditionally, same pattern as every other
  // country-aware component in this app.
  const requestCountry = isVePrefixed(location.pathname) ? "VE" : "CO";
  const dashboardPath = requestCountry === "VE" ? "/ve/dashboard" : "/dashboard";

  // Same resolution as server.ts: a second segment only matters for a
  // whitelisted city × intent pair (/empleos/bogota/sin-experiencia).
  const resolved = id ? resolveCategoryPath(slug ? [id, slug] : [id], requestCountry) : null;
  const pageKey = resolved?.kind === "intencion" && resolved.city ? `${id}/${slug}` : id;
  // With the rollback flag on, the server sends the legacy remote payload
  // (no `intent` field): keep rendering what it rendered.
  const [legacyRemote] = useState(() => {
    const ssr = window.__SSR_CATEGORY__;
    return Boolean(resolved?.kind === "intencion" && resolved.intent === "remoto" && ssr && ssr.slug === pageKey && !ssr.intent);
  });
  const category = legacyRemote && resolved?.intent === "remoto" ? LEGACY_REMOTE : resolved;

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
    if (category && ssrCategory && ssrCategory.slug === pageKey && ssrCategory.country === category.country) {
      delete window.__SSR_CATEGORY__;
      const jobs = Array.isArray(ssrCategory.jobs) ? ssrCategory.jobs : [];
      const total = ssrCategory.total || 0;
      return {
        id: pageKey,
        jobs,
        total,
        insights: ssrCategory.insights || buildCategoryInsights(category, total, jobs),
        state: "found",
        fromSsr: true,
        newToday: isNewTodayBlock(ssrCategory.newToday) ? ssrCategory.newToday : null,
        answer: isIntentAnswer(ssrCategory.answer) ? ssrCategory.answer : null,
        intentLinks: isIntentLinks(ssrCategory.intentLinks) ? ssrCategory.intentLinks : []
      };
    }
    return { id: pageKey, jobs: [], total: 0, insights: null, state: category ? "loading" : "not-found" };
  });
  const current: CategoryPageState =
    page.id === pageKey ? page : { id: pageKey, jobs: [], total: 0, insights: null, state: category ? "loading" : "not-found" };
  const { jobs, total, insights, state, newToday, answer, intentLinks = [] } = current;

  useEffect(() => {
    if (!category) {
      setPage({ id: pageKey, jobs: [], total: 0, insights: null, state: "not-found" });
      return;
    }
    if (page.id === pageKey && page.fromSsr) return;

    let cancelled = false;
    setPage({ id: pageKey, jobs: [], total: 0, insights: null, state: "loading" });
    if (category.kind === "intencion") {
      // Intent pages: the server's own whitelisted fallback, same cache and
      // same answer block as the SSR page (ADR 0012 §6).
      fetch(`/api/intent-page?path=${encodeURIComponent(buildCategoryPath(category))}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (cancelled) return;
          if (!data) {
            setPage({ id: pageKey, jobs: [], total: 0, insights: null, state: "not-found" });
            return;
          }
          const nextJobs = data.jobs || [];
          const nextTotal = data.total || 0;
          setPage({
            id: pageKey,
            jobs: nextJobs,
            total: nextTotal,
            insights: data.insights || buildCategoryInsights(category, nextTotal, nextJobs),
            state: "found",
            newToday: isNewTodayBlock(data.newToday) ? data.newToday : null,
            answer: isIntentAnswer(data.answer) ? data.answer : null
          });
        })
        .catch(() => {
          if (!cancelled) setPage({ id: pageKey, jobs: [], total: 0, insights: null, state: "not-found" });
        });
      return () => {
        cancelled = true;
      };
    }
    const params = new URLSearchParams();
    // Same places as the SSR hub (cityHubFilters: aliases such as Puerto
    // Ordaz for Ciudad Guayana included); /api/jobs reads repeated `cities`.
    if (category.kind === "ciudad") {
      for (const place of cityHubPlaces(category.label)) params.append("cities", place);
    } else {
      params.set("roles", category.label);
    }
    params.set("country", category.country);
    params.set("limit", String(PAGE_LIMIT));

    fetch(`/api/jobs?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data) {
          const nextJobs = data.jobs || [];
          const nextTotal = data.total || 0;
          setPage({ id: pageKey, jobs: nextJobs, total: nextTotal, insights: buildCategoryInsights(category, nextTotal, nextJobs), state: "found" });
        } else {
          setPage({ id: pageKey, jobs: [], total: 0, insights: null, state: "not-found" });
        }
      })
      .catch(() => {
        if (!cancelled) setPage({ id: pageKey, jobs: [], total: 0, insights: null, state: "not-found" });
      });
    return () => {
      cancelled = true;
    };
    // Dependencies intentionally limited to the list below: `category` is
    // derived from them, and `page` only gates the first SSR-backed run.
  }, [id, slug, requestCountry]);

  const meta = category ? buildCategoryMeta(category, total) : null;
  const internalLinks = category ? buildCategoryInternalLinks(category) : [];
  const relatedCityLinks = category ? buildRelatedCityLinks(category) : [];
  const sectionHeadings = category ? buildCategorySectionHeadings(category) : null;
  const statsCopy = category && insights ? buildCategoryStatsCopy(category, insights) : null;
  usePageMeta({
    title: meta?.title ?? "Cargando vacantes... | BuscoTrabajo",
    description: meta?.description ?? "Cargando vacantes de esta categoría."
  });

  // Job cards pass this page as their origin, so the job page's back link
  // returns here.
  const origin = category
    ? {
        label: category.kind === "ciudad" ? `Empleos en ${category.label}` : category.kind === "intencion" && meta ? meta.heading : category.label,
        path: location.pathname
      }
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
          {answer && (
            <div className="max-w-[1240px] w-full mx-auto px-4 md:px-6 pb-8 text-sm leading-relaxed [&_h2]:font-heading [&_h2]:font-bold [&_h2]:text-xl [&_h2]:mb-3 [&_dt]:font-bold [&_dd]:mb-2 [&_dd]:text-[#3d413e]">
              <IntentAnswerBlock answer={answer} />
            </div>
          )}
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
                    <dd className="mt-1.5 md:mt-1 font-heading font-bold text-[26px] md:text-[34px] leading-none tracking-[-0.03em]">{insights.freshLast7DaysLabel}</dd>
                  </div>
                </dl>

                <div className="mt-5 space-y-2 text-sm leading-relaxed text-[#3d413e]">
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

          {newToday && (
            <section
              data-category-new-today
              aria-label={newToday.heading}
              className="sr-host max-w-[1240px] w-full mx-auto px-4 md:px-6 pt-8 md:pt-12"
            >
              <h2 className="sr font-heading font-bold text-[24px] md:text-[36px] leading-tight tracking-[-0.03em] mb-4 md:mb-6">
                {newToday.heading}
              </h2>
              <ul className="sr grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
                {newToday.links.map((link) => (
                  <li key={link.path} className="ink-card-sm rounded-2xl bg-white p-4 text-sm leading-relaxed">
                    <Link to={link.path} className="font-bold text-foreground">
                      {link.title}
                    </Link>
                    <span className="block text-[#3d413e]">
                      {link.company} · {link.location}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {statsCopy && (
            <section
              data-category-stats
              aria-label={statsCopy.heading}
              className="sr-host max-w-[1240px] w-full mx-auto px-4 md:px-6 pt-8 md:pt-12"
            >
              <h2 className="sr font-heading font-bold text-[24px] md:text-[36px] leading-tight tracking-[-0.03em] mb-2 md:mb-3">
                {statsCopy.heading}
              </h2>
              <p className="sr text-sm md:text-base leading-relaxed text-[#3d413e] max-w-[900px]">{statsCopy.summary}</p>
              {(statsCopy.companies.length > 0 || statsCopy.roles.length > 0) && (
                <div className="sr mt-4 md:mt-5 grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                  {statsCopy.companies.length > 0 && (
                    <div className="ink-card-sm rounded-2xl bg-white p-5">
                      <h3 className="font-heading font-bold text-lg leading-tight">{statsCopy.companiesHeading}</h3>
                      <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-[#3d413e]">
                        {statsCopy.companies.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {statsCopy.roles.length > 0 && (
                    <div className="ink-card-sm rounded-2xl bg-green-soft p-5">
                      <h3 className="font-heading font-bold text-lg leading-tight">{statsCopy.rolesHeading}</h3>
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {statsCopy.roles.map((role) => (
                          <li key={role.href}>
                            <Link
                              to={role.href}
                              className="ink-card-sm ink-lift inline-flex rounded-full bg-white px-3.5 py-1.5 text-sm font-bold text-foreground no-underline"
                            >
                              {role.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {statsCopy.salary && (
                <p className="sr mt-4 ink-card-sm rounded-2xl bg-[#fdf1d3] p-4 text-sm leading-relaxed text-[#3d413e]">{statsCopy.salary}</p>
              )}
              <p className="sr mt-3 text-xs leading-relaxed text-muted-foreground">{statsCopy.basis}</p>
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
          {intentLinks.length > 0 && (
            <nav
              data-intent-links
              aria-label={INTENT_LINKS_HEADING}
              className="sr-host max-w-[1240px] w-full mx-auto px-4 md:px-6 pb-8 md:pb-12"
            >
              <h2 className="sr font-heading font-bold text-[24px] md:text-[36px] leading-tight tracking-[-0.03em] mb-4 md:mb-6">
                {INTENT_LINKS_HEADING}
              </h2>
              <ul className="sr flex flex-wrap gap-2">
                {intentLinks.map((link) => (
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
            </nav>
          )}
          <ContentCta to={dashboardPath} />
        </>
      )}
    </div>
  );
}
