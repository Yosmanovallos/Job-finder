import { useState, useEffect } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { JobDetailPanel } from "../components/JobDetailPanel.js";
import { PaywallCard } from "../components/PaywallCard.js";
import { ApplyGateModal } from "../components/ApplyGateModal.js";
import { useAuth } from "../auth/auth-provider.js";
import { usePageMeta } from "../lib/use-page-meta.js";
import { buildJobMeta } from "../lib/job-seo.js";
import { Button } from "../components/ui/button.js";
import { ArrowLeft } from "lucide-react";
import { isVePrefixed } from "../lib/country-context.js";
import { readJobOrigin } from "../lib/job-origin.js";
import { useSavedJobs } from "../lib/saved-jobs.js";
import { jobAnalyticsParams, trackEvent } from "../lib/analytics.js";
import { readSsrJob, isMissingJobResponse } from "../lib/job-page-state.js";
import type { Job } from "../sources/types.js";

type LoadState = "loading" | "found" | "not-found" | "error";

// Client-side counterpart of server.ts's /empleos/:id/:slug SSR route —
// what visitors and rendering crawlers see after React mounts.
// Deliberately does NOT call usePageMeta until
// the job has actually loaded: calling it earlier with a placeholder title
// would let the post-hydration DOM disagree with what the server already
// sent, and Googlebot's rendering pass reads the DOM after JS runs.
export default function JobLanding() {
  const { id } = useParams<{ id: string }>();
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const country = isVePrefixed(location.pathname) ? "VE" : "CO";
  const dashboardPath = country === "VE" ? "/ve/dashboard" : "/dashboard";
  // A company/city/role page that linked here; otherwise back to the
  // dashboard (a job opened from search or a shared link).
  const origin = readJobOrigin(location.state);

  const [load, setLoad] = useState<{ id?: string; job: Job | null; state: LoadState }>(() => {
    const snapshot = readSsrJob(id, window.__SSR_JOB__);
    return { id, job: snapshot, state: snapshot ? "found" : "loading" };
  });
  const job = load.id === id ? load.job : null;
  const state = load.id === id ? load.state : "loading";
  const [retry, setRetry] = useState(0);
  const { savedIds, appliedIds, toggleSaved, toggleApplied } = useSavedJobs();
  const [applyGateJob, setApplyGateJob] = useState<Job | null>(null);

  useEffect(() => {
    if (!id) {
      setLoad({ id, job: null, state: "not-found" });
      return;
    }
    const snapshot = !accessToken ? readSsrJob(id, window.__SSR_JOB__) : null;
    if (snapshot) {
      setLoad({ id, job: snapshot, state: "found" });
      trackEvent("view_job", { ...jobAnalyticsParams(snapshot, "job_page"), surface: "job_page" });
      return;
    }
    const controller = new AbortController();
    setLoad((current) =>
      current.id === id && current.job
        ? { ...current, state: "found" }
        : { id, job: null, state: "loading" }
    );
    const headers: Record<string, string> = {};
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

    fetch(`/api/jobs/${encodeURIComponent(id)}`, { headers, signal: controller.signal })
      .then(async (res) => {
        if (isMissingJobResponse(res.status)) return null;
        if (!res.ok) throw new Error("Job detail temporarily unavailable");
        const data = (await res.json()) as { job?: Job };
        if (!data.job || typeof data.job.jobId !== "string" || !data.job.title) {
          throw new Error("Invalid job detail response");
        }
        return data;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data?.job) {
          setLoad({ id, job: data.job, state: "found" });
          trackEvent("view_job", {
            ...jobAnalyticsParams(data.job, "job_page"),
            surface: "job_page"
          });
        } else {
          setLoad({ id, job: null, state: "not-found" });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setLoad((current) => ({
            id,
            job: current.id === id ? current.job : null,
            state: "error"
          }));
      });
    return () => controller.abort();
  }, [id, accessToken, retry]);

  // Calling this unconditionally (never behind an `if`) matters: React
  // requires the same hooks in the same order on every render. It re-runs
  // its effect once `job` resolves and the real title/description replace
  // this placeholder — a brief placeholder write, not a wrong final one.
  const meta = job ? buildJobMeta(job) : null;
  usePageMeta(
    meta
      ? {
          title: meta.title,
          description: meta.description
        }
      : null
  );

  // Same page shell as the company and category pages: ink breadcrumb on a
  // soft-green band, then the dashboard's ink detail card.
  return (
    <div className="bg-white min-h-screen">
      <section className="bg-gradient-to-b from-green-soft to-white">
        <div className="max-w-[880px] mx-auto px-4 md:px-6 pt-6 pb-4 md:pt-10 md:pb-6">
          <nav aria-label="Ruta" className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <Link
              to={origin?.path ?? dashboardPath}
              className="ink-card-sm ink-lift inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-foreground no-underline max-w-full"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{origin ? origin.label : "Ver todas las vacantes"}</span>
            </Link>
            {origin ? (
              <Link to={dashboardPath} className="rounded-full px-3 py-1.5 text-[#3d413e] hover:text-foreground">
                Ver todas las vacantes
              </Link>
            ) : null}
          </nav>
        </div>
      </section>

      <div className="max-w-[880px] mx-auto px-4 md:px-6 pb-16 md:pb-24">
        {state === "loading" && (
          <div aria-busy="true" className="rounded-2xl border-2 border-foreground/15 bg-white p-6 animate-pulse space-y-4 min-h-[60vh]">
            <div className="flex gap-3">
              <div className="w-11 h-11 rounded-lg bg-foreground/10" />
              <div className="flex-1 space-y-2">
                <div className="h-5 w-3/4 rounded bg-foreground/10" />
                <div className="h-4 w-1/2 rounded bg-foreground/10" />
              </div>
            </div>
            <div className="h-12 rounded-xl bg-foreground/10" />
            <div className="h-3 w-full rounded bg-foreground/10" />
            <div className="h-3 w-5/6 rounded bg-foreground/10" />
          </div>
        )}

        {state === "not-found" && (
          <div className="ink-card rounded-3xl bg-white p-8 md:p-12 text-center">
            <p className="font-heading font-bold text-2xl md:text-3xl">Esta vacante ya no está disponible.</p>
            <p className="mt-2 text-[#3d413e]">Venció o la fuente la cerró. Hay muchas otras activas.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-2.5">
              <Button onClick={() => navigate(dashboardPath)}>Ver otras vacantes</Button>
              {origin ? (
                <Button variant="outline" onClick={() => navigate(origin.path)}>
                  Volver a {origin.label}
                </Button>
              ) : null}
            </div>
          </div>
        )}

        {state === "error" && (
          <div role="alert" className="ink-card-sm mb-4 rounded-2xl bg-[#fdf1d3] p-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[#3d413e]">No pudimos actualizar la vacante. Intenta de nuevo.</p>
            <Button onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>
          </div>
        )}

        {(state === "found" || state === "error") &&
          job &&
          (job.isLocked ? (
            <PaywallCard job={job} onUnlockClick={() => navigate("/pricing")} />
          ) : (
            <JobDetailPanel
              job={{ ...job, isSaved: savedIds.has(job.jobId), isApplied: appliedIds.has(job.jobId) }}
              onSaveToggle={toggleSaved}
              onAppliedToggle={toggleApplied}
              onApplyClick={setApplyGateJob}
              headingLevel="h1"
              country={country}
              variant="ink"
            />
          ))}
      </div>

      {applyGateJob && <ApplyGateModal job={applyGateJob} onClose={() => setApplyGateJob(null)} />}
    </div>
  );
}
