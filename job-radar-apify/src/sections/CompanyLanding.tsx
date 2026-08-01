import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ReputationBadges, ReputationEntryProps } from "../components/ReputationBadges.js";
import { CategoryJobRow } from "../components/CategoryJobRow.js";
import { usePageMeta } from "../lib/use-page-meta.js";
import { Button } from "../components/ui/button.js";
import { Job } from "../sources/types.js";
import { ArrowLeft } from "lucide-react";

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

  const [companyName, setCompanyName] = useState<string | null>(null);
  const [reputation, setReputation] = useState<ReputationEntryProps[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    if (!slug) {
      setState("not-found");
      return;
    }
    setState("loading");
    fetch(`/api/companies/${encodeURIComponent(slug)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setCompanyName(data.companyName);
          setReputation(data.reputation || []);
          setJobs(data.jobs || []);
          setTotal(data.total || 0);
          setState("found");
        } else {
          setState("not-found");
        }
      })
      .catch(() => setState("not-found"));
  }, [slug]);

  usePageMeta({
    title: companyName ? `${companyName} | BuscoTrabajo` : "Cargando empresa... | BuscoTrabajo",
    description: companyName
      ? `Reputación y vacantes activas de ${companyName} en BuscoTrabajo.`
      : "Cargando información de la empresa."
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

        {state === "not-found" && (
          <div className="text-center py-16 px-4 rounded-2xl border border-[#e6e8e4] bg-[#ffffff] text-muted-foreground font-mono">
            <span className="text-3xl block mb-2">🔍</span>
            No encontramos esta empresa.
            <div className="mt-4">
              <Button onClick={() => navigate("/dashboard")}>Ver todas las vacantes</Button>
            </div>
          </div>
        )}

        {state === "loading" && (
          <div className="rounded-xl p-5 border border-[#e6e8e4] bg-[#ffffff] animate-pulse space-y-3">
            <div className="h-4 w-3/4 rounded bg-[#f1f2f0]" />
            <div className="h-3 w-1/2 rounded bg-[#f1f2f0]" />
          </div>
        )}

        {state === "found" && companyName && (
          <>
            <h1 className="font-heading font-semibold text-2xl text-foreground mb-2">{companyName}</h1>
            <p className="text-sm text-muted-foreground mb-6">
              {total} vacante{total === 1 ? "" : "s"} activa{total === 1 ? "" : "s"}.
            </p>

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
