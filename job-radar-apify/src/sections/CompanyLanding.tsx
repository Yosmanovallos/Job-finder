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
import { buildCompanyMeta, buildJobPath } from "../lib/job-seo.js";
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

  const [companyName, setCompanyName] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [reputation, setReputation] = useState<ReputationEntryProps[]>([]);
  const [officialCareersUrl, setOfficialCareersUrl] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    if (!slug) {
      setState("not-found");
      return;
    }
    // Waits for auth-provider's initial session resolution before firing —
    // otherwise this fires once with accessToken=null, then again once the
    // session resolves, and the second run's setState("loading") drops an
    // already-rendered page back to the skeleton for every logged-in visitor.
    if (authLoading) return;

    // server.ts's /empresas/:slug (and /ve/empresas/:slug) route embeds this
    // exact response directly in the HTML — same shortcut Dashboard.tsx
    // already uses for window.__SSR_JOBS__. Only trusted when BOTH slug and
    // country match this mount (never just "one of the two countries", same
    // reasoning as Dashboard's ssrJobs.country check) and only when
    // anonymous (!accessToken) — SSR always renders the tier:"free" masked
    // view, so a signed-in visitor still needs the real fetch below to get
    // their own unmasked tier. Deleted immediately after one read so a later
    // slug/filter change can never reuse stale data.
    const ssrCompany = (window as SsrCompanyWindow).__SSR_COMPANY__;
    delete (window as SsrCompanyWindow).__SSR_COMPANY__;
    if (ssrCompany && ssrCompany.slug === slug && ssrCompany.country === country && !accessToken) {
      setCompanyName(ssrCompany.companyName);
      setLogoUrl(ssrCompany.logoUrl || null);
      setReputation(ssrCompany.reputation || []);
      setOfficialCareersUrl(ssrCompany.officialCareersUrl || null);
      setJobs(ssrCompany.jobs || []);
      setTotal(ssrCompany.total || 0);
      setState("found");
      return;
    }

    setState("loading");
    const headers: HeadersInit = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
    fetch(`/api/companies/${encodeURIComponent(slug)}?country=${country}`, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setCompanyName(data.companyName);
          setLogoUrl(data.logoUrl || null);
          setReputation(data.reputation || []);
          setOfficialCareersUrl(data.officialCareersUrl || null);
          setJobs(data.jobs || []);
          setTotal(data.total || 0);
          setState("found");
        } else {
          setState("not-found");
        }
      })
      .catch(() => setState("not-found"));
  }, [slug, accessToken, authLoading, country]);

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
    <div className="bg-white">
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

          {state === "loading" && (
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

          {state === "found" && companyName && (
            <div className="flex flex-wrap items-center gap-5 md:gap-8">
              <CompanyAvatar
                name={companyName}
                logoUrl={logoUrl}
                className="ink-card-sm md:ink-card w-16 h-16 md:w-24 md:h-24 text-2xl md:text-4xl rounded-2xl bg-white"
              />
              <div className="min-w-0 flex-[1_1_320px]">
                <h1 className="font-heading font-bold tracking-[-0.04em] leading-[1.05] text-[30px] md:text-[clamp(38px,4.5vw,58px)] break-words">
                  {companyName}
                </h1>
                <div className="mt-3 md:mt-4 flex flex-wrap items-center gap-2.5">
                  <span className="ink-card-sm inline-flex items-center gap-2 rounded-full bg-[#fdf1d3] px-3 py-1 text-sm font-semibold shadow-none">
                    <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-primary" />
                    {total.toLocaleString("es-CO")} vacante{total === 1 ? "" : "s"} activa{total === 1 ? "" : "s"}
                  </span>
                  {/* Employers whose own vacancies can't be read: a link to
                      their careers site, nothing copied
                      (src/data/official-careers-links.ts). */}
                  {officialCareersUrl && (
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
