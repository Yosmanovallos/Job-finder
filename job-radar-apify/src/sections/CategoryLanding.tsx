import { useState, useEffect } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { CategoryJobRow } from "../components/CategoryJobRow.js";
import { usePageMeta } from "../lib/use-page-meta.js";
import { resolveCategorySlug, buildCategoryMeta } from "../lib/job-seo.js";
import { isVePrefixed } from "../lib/country-context.js";
import { Button } from "../components/ui/button.js";
import { Job } from "../sources/types.js";
import { ArrowLeft } from "lucide-react";

type LoadState = "loading" | "found" | "not-found";

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
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    if (!category) {
      setState("not-found");
      return;
    }
    setState("loading");
    const params = new URLSearchParams();
    params.set(category.kind === "ciudad" ? "cities" : "roles", category.label);
    params.set("country", category.country);
    params.set("limit", String(PAGE_LIMIT));

    fetch(`/api/jobs?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          setJobs(data.jobs || []);
          setTotal(data.total || 0);
          setState("found");
        } else {
          setState("not-found");
        }
      })
      .catch(() => setState("not-found"));
  }, [id, requestCountry]);

  const meta = category ? buildCategoryMeta(category, total) : null;
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
              <Button onClick={() => navigate(requestCountry === "VE" ? "/ve/dashboard" : "/dashboard")}>
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
              {state === "loading" ? "Cargando..." : `${total} vacante${total === 1 ? "" : "s"} encontrada${total === 1 ? "" : "s"}.`}
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
