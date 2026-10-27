import { useState, useEffect } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { ReputationBadges, ReputationEntryProps } from "../components/ReputationBadges.js";
import { CompanyAvatar } from "../components/CompanyAvatar.js";
import { ContentCta } from "../components/ContentPage.js";
import { buildLocationLabel } from "../countries/index.js";
import { getModalityLabel } from "../lib/job-filters.js";
import { getSourceColor } from "../lib/source-colors.js";
import { jobDateLabel } from "../lib/job-date-label.js";
import { useAuth } from "../auth/auth-provider.js";
import { usePageMeta } from "../lib/use-page-meta.js";
import { buildCompanyMeta, buildCompanyPath, buildJobPath } from "../lib/job-seo.js";
import { fetchCompanyPage, type CompanyPagePayload, type CompanyPreview } from "../lib/company-page-client.js";
import { Button } from "../components/ui/button.js";
import { Job } from "../sources/types.js";
import { ArrowLeft, ExternalLink } from "lucide-react";

type LoadState = "loading" | "found" | "not-found";

// Shape of the company payload the server inlines for anonymous SSR.
type SsrCompanyWindow = Window & {
  __SSR_COMPANY__?: {
    slug?: string;
    country?: string;
    companyName: string | null;
    logoUrl?: string | null;
    reputation?: ReputationEntryProps[];
    officialCareersUrl?: string | null;
    jobs?: Job[];
    total?: number;
  };
};

// Reached from JobDetailPanel/JobCard's company-name link
// (buildCompanyPath(job.company)) — and, since SEO-IMPROVEMENT-PLAN.md
// §1.16, also a real SSR-backed landing page in its own right
// (server.ts's /empresas/:slug branch), same pattern as
// JobLanding/CategoryLanding/Dashboard.
export default function CompanyLanding() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // /empresas/:slug (Colombia, default) vs /ve/empresas/:slug (Venezuela) —
  // same path-prefix pattern as Dashboard.tsx. Sent to the API so a slug
  // that only resolves via the other country's jobs correctly 404s here
  // instead of showing a cross-country company page (see server.ts's
  // /api/companies/:slug country scoping).
  const country = location.pathname.startsWith("/ve") ? "VE" : "CO";
  const { accessToken, loading: authLoading } = useAuth();

  // server.ts's /empresas/:slug (and /ve/empresas/:slug) route embeds this
  // exact response in the HTML. It's painted on the first render, before
  // the auth session resolves: waiting for the session left a short
  // skeleton on screen, the footer rose into view and then jumped (CLS
  // 1.1 in 1 of 4 Lighthouse runs, 2026-10-27). Only trusted when BOTH
  // slug and country match this mount (same reasoning as Dashboard's
  // ssrJobs.country check), and read once so a later slug can never reuse
  // it. SSR is the anonymous view; a signed-in visitor refetches below
  // without dropping back to the skeleton.
  const [page, setPage] = useState<{ slug?: string; data: CompanyPagePayload | null; state: LoadState; fromSsr?: boolean }>(() => {
    const ssrCompany = (window as SsrCompanyWindow).__SSR_COMPANY__;
    delete (window as SsrCompanyWindow).__SSR_COMPANY__;
    if (ssrCompany && ssrCompany.companyName && ssrCompany.slug === slug && ssrCompany.country === country) {
      const data: CompanyPagePayload = {
        companyName: ssrCompany.companyName,
        logoUrl: ssrCompany.logoUrl || null,
        reputation: ssrCompany.reputation || [],
        officialCareersUrl: ssrCompany.officialCareersUrl || null,
        jobs: ssrCompany.jobs || [],
        total: ssrCompany.total || 0
      };
      return { slug, data, state: "found", fromSsr: true };
    }
    return { slug, data: null, state: "loading" };
  });
  const current = page.slug === slug ? page : { slug, data: null, state: "loading" as LoadState };
  const state = current.state;
  const companyName = current.data?.companyName ?? null;
  const logoUrl = current.data?.logoUrl ?? null;
  const reputation = current.data?.reputation ?? [];
  const officialCareersUrl = current.data?.officialCareersUrl ?? null;
  const jobs = current.data?.jobs ?? [];
  const total = current.data?.total ?? 0;
  const showingSsr = page.slug === slug && page.fromSsr === true;

  useEffect(() => {
    if (!slug) {
      setPage({ slug, data: null, state: "not-found" });
      return;
    }
    // Waits for auth-provider's initial session resolution: with no session
    // the SSR view above is already the right one; with one, the refetch
    // gets the visitor's own tier.
    if (authLoading) return;
    if (showingSsr && !accessToken) return;

    let cancelled = false;
    setPage((prev) => (prev.slug === slug && prev.data ? prev : { slug, data: null, state: "loading" }));
    // Usually already in flight: the link that brought the visitor here
    // prefetched it on hover/press (company-page-client.ts).
    fetchCompanyPage(slug, country, accessToken)
      .then((data) => {
        if (cancelled) return;
        setPage(data ? { slug, data, state: "found" } : { slug, data: null, state: "not-found" });
      })
      .catch(() => {
        if (cancelled) return;
        // A failed refresh keeps whatever is already on screen.
        setPage((prev) => (prev.slug === slug && prev.data ? prev : { slug, data: null, state: "not-found" }));
      });
    return () => {
      cancelled = true;
    };
    // Dependencies intentionally exclude showingSsr: it only matters for the
    // first run after mount.
  }, [slug, accessToken, authLoading, country]);

  // A company link passes what it already shows (name, logo, count), so
  // the header paints at once while the jobs load. Only trusted for the
  // slug it was built for.
  const linkPreview = (location.state as { companyPreview?: CompanyPreview } | null)?.companyPreview;
  const preview = linkPreview && slug && buildCompanyPath(linkPreview.companyName, country).endsWith(`/${slug}`) ? linkPreview : null;
  const headerName = state === "found" ? companyName : state === "loading" ? preview?.companyName ?? null : null;
  const headerLogo = state === "found" ? logoUrl : preview?.logoUrl ?? null;
  const headerTotal = state === "found" ? total : preview?.count ?? 0;

  // Same builder as server.ts's SSR head, so title/description don't change
  // when React mounts.
  const companyMeta = companyName ? buildCompanyMeta(companyName, total, country) : null;
  usePageMeta({
    title: companyMeta ? companyMeta.title : "Cargando empresa... | BuscoTrabajo",
    description: companyMeta ? companyMeta.description : "Cargando información de la empresa."
  });

  const directoryPath = country === "VE" ? "/ve/empresas" : "/empresas";
  const dashboardPath = country === "VE" ? "/ve/dashboard" : "/dashboard";

  return (
    // While loading, the page keeps a screen's height so the footer never
    // rises into view and jumps when the content arrives.
    <div className={`bg-white ${state === "loading" ? "min-h-screen" : ""}`}>
      <section className="bg-gradient-to-b from-green-soft to-white">
        <div className="max-w-[1240px] mx-auto px-4 md:px-6 pt-6 pb-8 md:pt-12 md:pb-14">
          <nav aria-label="Ruta" className="mb-5 md:mb-7 flex flex-wrap items-center gap-2 text-sm font-semibold">
            <Link to={directoryPath} className="ink-card-sm ink-lift inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-foreground no-underline">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Empresas
            </Link>
            <Link to={dashboardPath} className="rounded-full px-3 py-1.5 text-[#3d413e] hover:text-foreground">
              Ver todas las vacantes
            </Link>
          </nav>

          {state === "loading" && !headerName && (
            <div className="flex items-center gap-4 md:gap-6 animate-pulse">
              <div className="w-16 h-16 md:w-24 md:h-24 rounded-2xl bg-white border-2 border-foreground/20" />
              <div className="flex-1 space-y-3">
                <div className="h-8 w-2/3 rounded-lg bg-foreground/10" />
                <div className="h-5 w-40 rounded-full bg-foreground/10" />
              </div>
            </div>
          )}

          {state === "not-found" && (
            <div className="ink-card rounded-3xl bg-white p-8 md:p-12 text-center">
              <p className="font-heading font-bold text-2xl md:text-3xl">No encontramos esta empresa</p>
              <p className="mt-2 text-[#3d413e]">Puede que ya no tenga vacantes activas en {country === "VE" ? "Venezuela" : "Colombia"}.</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2.5">
                <Button onClick={() => navigate(dashboardPath)}>Ver todas las vacantes</Button>
                <Button variant="outline" onClick={() => navigate(directoryPath)}>Explorar empresas</Button>
              </div>
            </div>
          )}

          {headerName && (
            <div className="flex flex-wrap items-center gap-5 md:gap-8">
              <CompanyAvatar
                name={headerName}
                logoUrl={headerLogo}
                className="ink-card-sm md:ink-card w-16 h-16 md:w-24 md:h-24 text-2xl md:text-4xl rounded-2xl bg-white"
              />
              <div className="min-w-0 flex-[1_1_320px]">
                <h1 className="font-heading font-bold tracking-[-0.04em] leading-[1.05] text-[30px] md:text-[clamp(38px,4.5vw,58px)] break-words">
                  {headerName}
                </h1>
                <div className="mt-3 md:mt-4 flex flex-wrap items-center gap-2.5">
                  <span className="ink-card-sm inline-flex items-center gap-2 rounded-full bg-[#fdf1d3] px-3 py-1 text-sm font-semibold shadow-none">
                    <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-primary" />
                    {headerTotal.toLocaleString("es-CO")} vacante{headerTotal === 1 ? "" : "s"} activa{headerTotal === 1 ? "" : "s"}
                  </span>
                  {/* Employers whose own vacancies can't be read: a link to
                      their careers site, nothing copied
                      (src/data/official-careers-links.ts). */}
                  {state === "found" && officialCareersUrl && (
                    <a
                      href={officialCareersUrl}
                      target="_blank"
                      rel="nofollow noopener noreferrer"
                      className="ink-card-sm ink-lift inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1 text-sm font-semibold text-foreground no-underline"
                    >
                      Ver todas sus vacantes en su portal oficial
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {state === "loading" && headerName && (
        <section aria-busy="true" className="max-w-[1240px] w-full mx-auto px-4 md:px-6 py-8 md:py-12">
          <div className="h-7 md:h-9 w-2/3 max-w-md rounded-lg bg-foreground/10 animate-pulse mb-4 md:mb-6" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            {Array.from({ length: Math.min(Math.max(headerTotal, 2), 6) }).map((_, i) => (
              <div key={i} className="h-[120px] rounded-2xl border-2 border-foreground/15 bg-white animate-pulse" />
            ))}
          </div>
        </section>
      )}

      {state === "found" && companyName && (
        <>
          {reputation.length > 0 && (
            <section className="sr-host max-w-[1240px] w-full mx-auto px-4 md:px-6 pt-2 md:pt-4">
              <div className="sr ink-card-sm md:ink-card rounded-2xl md:rounded-3xl bg-[#e8f1fb] p-5 md:p-7">
                <h2 className="font-heading font-bold text-xl md:text-2xl tracking-[-0.02em] text-[#082f5c] mb-3">Reputación de {companyName}</h2>
                <ReputationBadges entries={reputation} />
              </div>
            </section>
          )}

          <section className="sr-host max-w-[1240px] w-full mx-auto px-4 md:px-6 py-8 md:py-12">
            <h2 className="sr font-heading font-bold text-[24px] md:text-[36px] leading-tight tracking-[-0.03em] mb-4 md:mb-6">
              Vacantes activas de {companyName}
            </h2>
            {jobs.length === 0 ? (
              <p className="sr ink-card-sm rounded-2xl bg-[#fdf1d3] p-5 text-[#3d413e]">
                Sin vacantes activas de esta empresa por ahora.
              </p>
            ) : (
              <ul className="sr-stagger grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                {jobs.map((job) => (
                  <li key={job.jobId} className="sr">
                    <CompanyJobCard job={job} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <ContentCta to={dashboardPath} />
        </>
      )}
    </div>
  );
}

// Internal link to /empleos/:id (the company page is a hub for its jobs,
// same as the category pages), in the homepage's card style.
function CompanyJobCard({ job }: { job: Job }) {
  const modality = getModalityLabel(job.location);
  const color = getSourceColor(job.source);
  return (
    <Link
      to={buildJobPath(job)}
      className="ink-card-sm ink-lift h-full rounded-2xl bg-white p-4 md:p-5 flex flex-col gap-2.5 text-foreground no-underline"
    >
      <h3 className="font-heading font-bold text-base md:text-lg leading-snug line-clamp-2">{job.title}</h3>
      <p className="text-sm text-[#3d413e] truncate">{buildLocationLabel(job)}</p>
      <div className="mt-auto flex flex-wrap gap-1.5">
        <span className="rounded-full px-2 py-0.5 font-mono text-[11px]" style={{ backgroundColor: color.bg, color: color.text }}>{job.source}</span>
        {modality ? <span className="rounded-full px-2 py-0.5 font-mono text-[11px] bg-[#efe9fd] text-[#6d28d9]">{modality}</span> : null}
        <span className="rounded-full px-2 py-0.5 font-mono text-[11px] bg-green-soft text-primary">{jobDateLabel(job)}</span>
      </div>
    </Link>
  );
}
