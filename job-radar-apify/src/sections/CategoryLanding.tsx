import { useState, useEffect } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { CategoryJobRow } from "../components/CategoryJobRow.js";
import { usePageMeta } from "../lib/use-page-meta.js";
import {
  resolveCategorySlug,
  buildCategoryMeta,
  buildCategoryInsights,
  buildCategoryInternalLinks,
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

// Client-side counterpart of server.ts's /empleos/<slug> (and
// /ve/empleos/<slug> for roles) category branch — what a real visitor sees
// after React hydrates (a crawler only ever sees the server-rendered HTML,
// same split as JobLanding.tsx). Reached via EmpleosRoute.tsx's isUuid()
// dispatch, so `id` here is always a non-UUID category slug, never a jobId.
export default function CategoryLanding() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // Only affects "rol" categories (a city match already carries its own
  // country regardless of prefix — see job-seo.ts's ResolvedCategory) but
  // cheap to compute unconditionally, same pattern as every other
  // country-aware component in this app.
  const requestCountry = isVePrefixed(location.pathname) ? "VE" : "CO";

  const category = id ? resolveCategorySlug(id, requestCountry) : null;

  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [insights, setInsights] = useState<CategoryInsights | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    if (!category) {
      setInsights(null);
      setState("not-found");
      return;
    }

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
    // reused (e.g. this component re-mounting for a different :id via
    // client-side navigation, where there's no matching SSR data at all).
    const ssrCategory = window.__SSR_CATEGORY__;
    if (ssrCategory && ssrCategory.slug === id && ssrCategory.country === category.country) {
      delete window.__SSR_CATEGORY__;
      const nextJobs = Array.isArray(ssrCategory.jobs) ? ssrCategory.jobs : [];
      const nextTotal = ssrCategory.total || 0;
      setJobs(nextJobs);
      setTotal(nextTotal);
      setInsights(ssrCategory.insights || buildCategoryInsights(category, nextTotal, nextJobs));
      setState("found");
      return;
    }

    setState("loading");
    setInsights(null);
    const params = new URLSearchParams();
    params.set(category.kind === "ciudad" ? "cities" : "roles", category.label);
    params.set("country", category.country);
    params.set("limit", String(PAGE_LIMIT));

    fetch(`/api/jobs?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          const nextJobs = data.jobs || [];
          const nextTotal = data.total || 0;
          setJobs(nextJobs);
          setTotal(nextTotal);
          setInsights(buildCategoryInsights(category, nextTotal, nextJobs));
          setState("found");
        } else {
          setInsights(null);
          setState("not-found");
        }
      })
      .catch(() => {
        setInsights(null);
        setState("not-found");
      });
  }, [id, requestCountry]);

  const meta = category ? buildCategoryMeta(category, total) : null;
  const internalLinks = category ? buildCategoryInternalLinks(category) : [];
  usePageMeta({
    title: meta?.title ?? "Cargando vacantes... | BuscoTrabajo",
    description: meta?.description ?? "Cargando vacantes de esta categoría."
  });

  return (
    <section className="relative w-full min-h-screen" style={{ backgroundColor: "#fafafa" }}>
      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-20">
        <Link
          to={requestCountry === "VE" ? "/ve/dashboard" : "/dashboard"}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Ver todas las vacantes
        </Link>

        {state === "not-found" && (
          <div className="text-center py-16 px-4 rounded-2xl border border-[#e6e8e4] bg-[#ffffff] text-muted-foreground font-mono">
            <span className="text-3xl block mb-2">🔍</span>
            Esta categoría no existe.
            <div className="mt-4">
              <Button
                onClick={() => navigate(requestCountry === "VE" ? "/ve/dashboard" : "/dashboard")}
              >
                Ver todas las vacantes
              </Button>
            </div>
          </div>
        )}

        {state !== "not-found" && meta && (
          <>
            <h1 className="font-heading font-semibold text-2xl text-foreground mb-2">
              {meta.heading}
            </h1>
            <p className="text-sm text-muted-foreground mb-6">
              {state === "loading"
                ? "Cargando..."
                : `${total} vacante${total === 1 ? "" : "s"} encontrada${total === 1 ? "" : "s"}.`}
            </p>

            {state === "loading" && (
              <div className="rounded-xl p-5 border border-[#e6e8e4] bg-[#ffffff] animate-pulse space-y-3">
                <div className="h-4 w-3/4 rounded bg-[#f1f2f0]" />
                <div className="h-3 w-1/2 rounded bg-[#f1f2f0]" />
              </div>
            )}

            {state === "found" && total === 0 && (
              <p className="text-sm text-muted-foreground">
                No hay vacantes en esta categoría por ahora.
              </p>
            )}

            {state === "found" && insights && (
              <section
                data-category-overview
                aria-label="Resumen de las vacantes"
                className="mb-8 rounded-2xl border border-[#e6e8e4] bg-white p-5 sm:p-6"
              >
                <p className="text-sm leading-6 text-foreground">{insights.intro}</p>
                <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-[#f7f8f6] p-4">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      Empresas en la muestra
                    </dt>
                    <dd className="mt-1 text-2xl font-semibold text-foreground">
                      {insights.companyCount}
                    </dd>
                  </div>
                  <div className="rounded-xl bg-[#f7f8f6] p-4">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      Fuentes verificables
                    </dt>
                    <dd className="mt-1 text-2xl font-semibold text-foreground">
                      {insights.sources.length}
                    </dd>
                  </div>
                  <div className="rounded-xl bg-[#f7f8f6] p-4">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      Publicadas en 7 días
                    </dt>
                    <dd className="mt-1 text-2xl font-semibold text-foreground">
                      {insights.freshLast7Days}
                    </dd>
                  </div>
                </dl>

                <div className="mt-5 space-y-2 text-sm text-muted-foreground">
                  {insights.topCompanies.length > 0 && (
                    <p>
                      <strong className="text-foreground">Empresas visibles:</strong>{" "}
                      {insights.topCompanies.join(", ")}.
                    </p>
                  )}
                  {insights.sources.length > 0 && (
                    <p>
                      <strong className="text-foreground">Fuentes:</strong>{" "}
                      {insights.sources.join(", ")}.
                    </p>
                  )}
                  {insights.modalities.length > 0 && (
                    <p>
                      <strong className="text-foreground">Modalidades:</strong>{" "}
                      {insights.modalities
                        .map((item) => `${item.label} (${item.count})`)
                        .join(", ")}
                      .
                    </p>
                  )}
                  {insights.latestPublishedLabel && (
                    <p>
                      <strong className="text-foreground">Última publicación visible:</strong>{" "}
                      {insights.latestPublishedLabel}.
                    </p>
                  )}
                </div>

                <nav
                  aria-label="Explorar más empleos"
                  className="mt-5 flex flex-wrap gap-x-4 gap-y-2"
                >
                  {internalLinks.map((link) => (
                    <Link
                      key={link.href}
                      to={link.href}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      {link.label}
                    </Link>
                  ))}
                </nav>
              </section>
            )}

            {state === "found" && jobs.length > 0 && (
              <div className="space-y-3">
                {jobs.map((job) => (
                  <CategoryJobRow key={job.jobId} job={job} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
