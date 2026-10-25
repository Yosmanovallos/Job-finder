import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { JobDetailPanel } from "../components/JobDetailPanel.js";
import { PaywallCard } from "../components/PaywallCard.js";
import { ApplyGateModal } from "../components/ApplyGateModal.js";
import { useAuth } from "../auth/auth-provider.js";
import { usePageMeta } from "../lib/use-page-meta.js";
import { buildJobMeta } from "../lib/job-seo.js";
import { Button } from "../components/ui/button.js";
import { ArrowLeft } from "lucide-react";
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

  const [load, setLoad] = useState<{ id?: string; job: Job | null; state: LoadState }>(() => {
    const snapshot = readSsrJob(id, window.__SSR_JOB__);
    return { id, job: snapshot, state: snapshot ? "found" : "loading" };
  });
  const job = load.id === id ? load.job : null;
  const state = load.id === id ? load.state : "loading";
  const [retry, setRetry] = useState(0);
  const [isSaved, setIsSaved] = useState(false);
  const [isApplied, setIsApplied] = useState(false);
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

  return (
    <section className="relative w-full min-h-screen" style={{ backgroundColor: "#fafafa" }}>
      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-20">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Ver todas las vacantes
        </Link>

        {state === "loading" && (
          <div className="rounded-xl p-5 border border-[#e6e8e4] bg-[#ffffff] animate-pulse space-y-3">
            <div className="h-4 w-3/4 rounded bg-[#f1f2f0]" />
            <div className="h-3 w-1/2 rounded bg-[#f1f2f0]" />
            <div className="h-3 w-2/3 rounded bg-[#f1f2f0]" />
          </div>
        )}

        {state === "not-found" && (
          <div className="text-center py-16 px-4 rounded-2xl border border-[#e6e8e4] bg-[#ffffff] text-muted-foreground font-mono">
            <span className="text-3xl block mb-2">🔍</span>
            Esta vacante ya no está disponible.
            <div className="mt-4">
              <Button onClick={() => navigate("/dashboard")}>Ver otras vacantes</Button>
            </div>
          </div>
        )}

        {state === "error" && (
          <div role="alert" className="rounded-xl p-5 border border-[#e6e8e4] bg-[#ffffff]">
            <p>No pudimos actualizar la vacante. Intenta de nuevo.</p>
            <Button onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>
          </div>
        )}

        {(state === "found" || state === "error") &&
          job &&
          (job.isLocked ? (
            <PaywallCard job={job} onUnlockClick={() => navigate("/pricing")} />
          ) : (
            <JobDetailPanel
              job={{ ...job, isSaved, isApplied }}
              onSaveToggle={() => setIsSaved((v) => !v)}
              onAppliedToggle={() => setIsApplied((v) => !v)}
              onApplyClick={setApplyGateJob}
              headingLevel="h1"
            />
          ))}
      </div>

      {applyGateJob && <ApplyGateModal job={applyGateJob} onClose={() => setApplyGateJob(null)} />}
    </section>
  );
}
