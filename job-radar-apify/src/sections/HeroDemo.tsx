import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { JobCard } from "../components/JobCard.js";
import { PaywallCard } from "../components/PaywallCard.js";

export default function HeroDemo() {
  const navigate = useNavigate();
  const [previewJobs, setPreviewJobs] = useState<any[]>([]);

  // Public preview: unauthenticated read of the corpus, same masking rules
  // free users get — no scrape is triggered by visiting the landing page.
  useEffect(() => {
    fetch("/api/jobs")
      .then((res) => (res.ok ? res.json() : { jobs: [] }))
      .then((data) => setPreviewJobs(Array.isArray(data.jobs) ? data.jobs.slice(0, 4) : []))
      .catch(() => {});
  }, []);

  return (
    <section
      id="hero-demo"
      className="relative w-full overflow-x-hidden"
      style={{ backgroundColor: "#0A0B0D" }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          backgroundImage:
            "linear-gradient(rgba(38,42,49,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(38,42,49,0.35) 1px, transparent 1px)",
          backgroundSize: "64px 64px"
        }}
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20">
        <h1
          className="text-center text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white mb-4"
          style={{ fontFamily: "'Space Grotesk', sans-serif" }}
        >
          Encuentra todas las vacantes de Colombia{" "}
          <span style={{ color: "#34D399" }}>en un solo lugar</span>
        </h1>

        <p className="text-center text-base sm:text-lg text-slate-400 max-w-2xl mx-auto mb-10">
          Escaneamos 12 portales simultáneamente. Deduplicado automático por SHA256.
        </p>

        <div className="flex justify-center mb-12">
          <Link
            to="/dashboard"
            className="px-8 py-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-base transition-all shadow-lg shadow-emerald-500/20"
          >
            Ver el Dashboard completo →
          </Link>
        </div>

        {previewJobs.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {previewJobs.map((job) =>
              job.isLocked ? (
                <PaywallCard
                  key={job.jobId || job.url}
                  job={job}
                  onUnlockClick={() => navigate("/pricing")}
                />
              ) : (
                <JobCard key={job.jobId || job.url} job={job} />
              )
            )}
          </div>
        )}
      </div>
    </section>
  );
}
