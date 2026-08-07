import { useState, useEffect } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { ReputationBadges, ReputationEntryProps } from "../components/ReputationBadges.js";
import { CompanyAvatar } from "../components/CompanyAvatar.js";
import { CategoryJobRow } from "../components/CategoryJobRow.js";
import { useAuth } from "../auth/auth-provider.js";
import { usePageMeta } from "../lib/use-page-meta.js";
import { Button } from "../components/ui/button.js";
import { Job } from "../sources/types.js";
import { ArrowLeft } from "lucide-react";

type LoadState = "loading" | "found" | "not-found";

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
    const ssrCompany = (window as any).__SSR_COMPANY__;
    delete (window as any).__SSR_COMPANY__;
    if (ssrCompany && ssrCompany.slug === slug && ssrCompany.country === country && !accessToken) {
      setCompanyName(ssrCompany.companyName);
      setLogoUrl(ssrCompany.logoUrl || null);
      setReputation(ssrCompany.reputation || []);
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
          setJobs(data.jobs || []);
          setTotal(data.total || 0);
          setState("found");
        } else {
          setState("not-found");
        }
      })
      .catch(() => setState("not-found"));
  }, [slug, accessToken, authLoading, country]);

  usePageMeta({
    title: companyName ? `${companyName} | BuscoTrabajo` : "Cargando empresa... | BuscoTrabajo",
    description: companyName
      ? `Reputación y vacantes activas de ${companyName} en BuscoTrabajo.`
      : "Cargando información de la empresa."
  });

  return (
    <section className="relative w-full min-h-screen bg-background">
      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-20">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Ver todas las vacantes
        </Link>

        {state === "not-found" && (
          <div className="text-center py-16 px-4 rounded-2xl border border-border bg-card text-muted-foreground font-mono">
            <span className="text-3xl block mb-2">🔍</span>
            No encontramos esta empresa.
            <div className="mt-4">
              <Button onClick={() => navigate(country === "VE" ? "/ve/dashboard" : "/dashboard")}>
                Ver todas las vacantes
              </Button>
            </div>
          </div>
        )}

        {state === "loading" && (
          <div className="rounded-xl p-5 border border-border bg-card animate-pulse space-y-3">
            <div className="h-4 w-3/4 rounded bg-muted" />
            <div className="h-3 w-1/2 rounded bg-muted" />
          </div>
        )}

        {state === "found" && companyName && (
          <>
            <div className="hud-corners flex items-center gap-4 rounded-xl border border-border bg-card p-5 sm:p-6 mb-6">
              <CompanyAvatar name={companyName} logoUrl={logoUrl} className="w-14 h-14 text-2xl" />
              <div className="min-w-0">
                <h1 className="font-heading font-semibold text-2xl text-foreground leading-snug break-words">
                  {companyName}
                </h1>
                <p className="text-sm font-mono text-muted-foreground mt-1">
                  <span className="text-primary font-semibold">{total}</span> vacante
                  {total === 1 ? "" : "s"} activa{total === 1 ? "" : "s"}
                </p>
              </div>
            </div>

            {reputation.length > 0 && (
              <div className="mb-6">
                <ReputationBadges entries={reputation} />
              </div>
            )}

            {jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin vacantes activas de esta empresa por ahora.
              </p>
            ) : (
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
