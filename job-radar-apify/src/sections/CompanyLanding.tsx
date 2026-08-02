import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ReputationBadges, ReputationEntryProps } from "../components/ReputationBadges.js";
import { CategoryJobRow } from "../components/CategoryJobRow.js";
import { CompanyReviewForm } from "../components/CompanyReviewForm.js";
import { CompanyReviewsList, CompanyReviewsDataProps } from "../components/CompanyReviewsList.js";
import { MonoLabel } from "../components/MonoLabel.js";
import { useAuth } from "../auth/auth-provider.js";
import { usePageMeta } from "../lib/use-page-meta.js";
import { Button } from "../components/ui/button.js";
import { Job } from "../sources/types.js";
import { ArrowLeft } from "lucide-react";

const EMPTY_REVIEWS: CompanyReviewsDataProps = { average: null, count: 0, entries: [], myReview: null };

type LoadState = "loading" | "found" | "not-found";

// Reached from JobDetailPanel/JobCard's company-name link
// (buildCompanyPath(job.company)) — dashboard navigation, not an
// SEO-driven page like JobLanding/CategoryLanding (see the "empresas"
// note in docs/COMPANY-REPUTATION-PLAN.md). No SSR yet: a direct load or
// refresh already falls through to the generic SPA fallback in server.ts
// (any extensionless path serves index.html), same as /dashboard did
// before it got its own SSR.
export default function CompanyLanding() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { accessToken, loading: authLoading } = useAuth();

  const [companyName, setCompanyName] = useState<string | null>(null);
  const [reputation, setReputation] = useState<ReputationEntryProps[]>([]);
  const [userReviews, setUserReviews] = useState<CompanyReviewsDataProps>(EMPTY_REVIEWS);
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
    setState("loading");
    const headers: HeadersInit = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
    fetch(`/api/companies/${encodeURIComponent(slug)}`, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setCompanyName(data.companyName);
          setReputation(data.reputation || []);
          setUserReviews(data.userReviews || EMPTY_REVIEWS);
          setJobs(data.jobs || []);
          setTotal(data.total || 0);
          setState("found");
        } else {
          setState("not-found");
        }
      })
      .catch(() => setState("not-found"));
  }, [slug, accessToken, authLoading]);

  usePageMeta({
    title: companyName ? `${companyName} | BuscoTrabajo` : "Cargando empresa... | BuscoTrabajo",
    description: companyName
      ? `Reputación y vacantes activas de ${companyName} en BuscoTrabajo.`
      : "Cargando información de la empresa."
  });

  const initial = (companyName || "?").trim().charAt(0).toUpperCase() || "?";

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
              <Button onClick={() => navigate("/dashboard")}>Ver todas las vacantes</Button>
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
              <div className="shrink-0 w-14 h-14 rounded-lg bg-gradient-to-br from-gold-1 to-gold-2 text-gold-ink font-heading font-semibold text-2xl flex items-center justify-center">
                {initial}
              </div>
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

            {/* Native BuscoTrabajo reviews — a visually separate block from
                ReputationBadges above (external, aggregated sources) so the
                two are never read as one merged number (same "never
                normalize across sources" principle already applied to
                Merco/GPTW/Computrabajo). */}
            <div className="mb-6">
              <MonoLabel>RESEÑAS DE BUSCOTRABAJO</MonoLabel>
              <div className="mt-3 rounded-lg border border-border bg-card p-4 space-y-4">
                <CompanyReviewForm
                  slug={slug!}
                  myReview={userReviews.myReview}
                  onUpdate={setUserReviews}
                />
                <div className="h-px bg-border" />
                <CompanyReviewsList data={userReviews} />
              </div>
            </div>

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
