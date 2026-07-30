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

type LoadState = "loading" | "found" | "not-found";

// Client-side counterpart of server.ts's /empleos/:id/:slug SSR route —
// what a real visitor sees after React hydrates (a crawler only ever sees
// the server-rendered HTML). Deliberately does NOT call usePageMeta until
// the job has actually loaded: calling it earlier with a placeholder title
// would let the post-hydration DOM disagree with what the server already
// sent, and Googlebot's rendering pass reads the DOM after JS runs.
export default function JobLanding() {
  const { id } = useParams<{ id: string }>();
  const { accessToken, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [job, setJob] = useState<any | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [isSaved, setIsSaved] = useState(false);
  const [isApplied, setIsApplied] = useState(false);
  const [applyGateJob, setApplyGateJob] = useState<any | null>(null);

  useEffect(() => {
    if (!id) {
      setState("not-found");
      return;
    }
    setState("loading");
    const headers: Record<string, string> = {};
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

    fetch(`/api/jobs/${encodeURIComponent(id)}`, { headers })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.job) {
          setJob(data.job);
          setState("found");
        } else {
          setState("not-found");
        }
      })
      .catch(() => setState("not-found"));
  }, [id, accessToken]);

  // Calling this unconditionally (never behind an `if`) matters: React
  // requires the same hooks in the same order on every render. It re-runs
  // its effect once `job` resolves and the real title/description replace
  // this placeholder — a brief placeholder write, not a wrong final one.
  const meta = job ? buildJobMeta(job) : null;
  usePageMeta({
    title: meta?.title ?? "Cargando vacante... | BuscoTrabajo",
    description: meta?.description ?? "Cargando el detalle de esta vacante."
  });

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

        {state === "found" &&
          job &&
          (job.isLocked ? (
            <PaywallCard job={job} onUnlockClick={() => navigate("/pricing")} />
          ) : (
            <JobDetailPanel
              job={{ ...job, isSaved, isApplied }}
              onSaveToggle={() => setIsSaved((v) => !v)}
              onAppliedToggle={() => setIsApplied((v) => !v)}
              onApplyClick={setApplyGateJob}
            />
          ))}
      </div>

      {applyGateJob && <ApplyGateModal job={applyGateJob} onClose={() => setApplyGateJob(null)} />}
    </section>
  );
}
