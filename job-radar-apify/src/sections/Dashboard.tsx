import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { PRO_MONTHLY_PRICE_COP, formatCOP } from "../config.js";
import { JobCard } from "../components/JobCard.js";
import { PaywallCard } from "../components/PaywallCard.js";
import { FilterBar, FilterState } from "../components/FilterBar.js";
import { StatsBar } from "../components/StatsBar.js";
import { useAuth } from "../auth/auth-provider.js";

type CheckoutBannerState = "confirming" | "success" | "pending" | null;

const ROLE_STOPWORDS = new Set(["de", "la", "el", "los", "las", "en", "y", "del", "para"]);

// role_origin only records which of the 30 searched roles happened to
// discover a job's URL first (the dedup upsert never updates it on later
// re-discovery), and some sources match keyword variants loosely enough that
// a totally unrelated posting can end up permanently stamped with the wrong
// role_origin. Filtering on that field alone let jobs like "Jefe de
// enfermería" show up under a "QA Engineer" filter. Requiring the title to
// actually contain a meaningful word from the role name is a real relevance
// check instead of trusting that noisy stored field.
function jobMatchesRole(role: string, job: any): boolean {
  const title = (job.title || "").toLowerCase();
  const words = role
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !ROLE_STOPWORDS.has(w));
  return words.some((w) => title.includes(w));
}

export default function Dashboard() {
  const { tier, isAuthenticated, accessToken, user, refreshTier } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [allJobs, setAllJobs] = useState<any[]>([]);
  const [filteredJobs, setFilteredJobs] = useState<any[]>([]);
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(new Set());
  const [appliedJobIds, setAppliedJobIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [checkoutBanner, setCheckoutBanner] = useState<CheckoutBannerState>(null);

  useEffect(() => {
    fetchJobs();
    // Re-fetch whenever auth/tier resolves so Pro sessions get unmasked data
  }, [accessToken]);

  // Wompi redirects back here with ?checkout=return after the sandbox
  // payment. The webhook that actually flips the tier to 'pro' can take a
  // moment to land, so we poll a few times instead of just trusting a
  // single stale read right after the redirect.
  useEffect(() => {
    if (searchParams.get("checkout") !== "return") return;

    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("checkout");
        return next;
      },
      { replace: true }
    );

    if (tier === "pro") {
      setCheckoutBanner("success");
      return;
    }

    setCheckoutBanner("confirming");
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts += 1;
      await refreshTier();
      // `tier` here is stale-closed; re-read via a fresh call isn't possible
      // without a ref, so this just caps the polling window and lets the
      // effect below promote "confirming" -> "success" once tier updates.
      if (attempts >= 5) {
        clearInterval(interval);
        // Still not "success" after the whole window means the webhook
        // never landed — stop silently spinning forever and say so instead
        // (previously stuck on "Confirmando..." with no way out). The
        // functional update is a no-op if the other effect already flipped
        // this to "success" in the meantime.
        setCheckoutBanner((prev) => (prev === "confirming" ? "pending" : prev));
      }
    }, 2000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (checkoutBanner === "confirming" && tier === "pro") {
      setCheckoutBanner("success");
    }
  }, [tier, checkoutBanner]);

  useEffect(() => {
    if (checkoutBanner === "success") {
      const timeout = setTimeout(() => setCheckoutBanner(null), 6000);
      return () => clearTimeout(timeout);
    }
  }, [checkoutBanner]);

  async function fetchJobs() {
    setIsLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
      const res = await fetch("/api/jobs", { headers });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.jobs)) {
          setAllJobs(data.jobs);
          setFilteredJobs(data.jobs);
        }
      }
    } catch (e) {
      // no-op — an empty list with the "no results" state below is enough signal
    } finally {
      setIsLoading(false);
    }
  }

  const handleFilterChange = (filters: FilterState) => {
    let result = [...allJobs];

    if (filters.search.trim()) {
      const s = filters.search.toLowerCase();
      result = result.filter(
        (j) =>
          (j.title && j.title.toLowerCase().includes(s)) ||
          (j.company && j.company.toLowerCase().includes(s)) ||
          (j.location && j.location.toLowerCase().includes(s))
      );
    }

    if (filters.source && filters.source !== "all") {
      result = result.filter(
        (j) =>
          j.source === filters.source ||
          (Array.isArray(j.sources) && j.sources.includes(filters.source)) ||
          (Array.isArray(j.alsoIn) && j.alsoIn.includes(filters.source))
      );
    }

    if (filters.modality && filters.modality !== "all") {
      const m = filters.modality.toLowerCase();
      result = result.filter((j) => {
        const loc = (j.location || "").toLowerCase();
        if (m === "remoto") return loc.includes("remoto") || loc.includes("remote");
        if (m === "hibrido") return loc.includes("híbrido") || loc.includes("hibrido");
        if (m === "presencial")
          return !loc.includes("remoto") && !loc.includes("remote") && !loc.includes("híbrido");
        return true;
      });
    }

    if (filters.freshness && filters.freshness !== "all") {
      const maxAgeHours =
        filters.freshness === "24h" ? 24 : filters.freshness === "48h" ? 48 : 24 * 7;
      result = result.filter((j) => {
        if (!j.publishedAt) return false;
        const ageHours = (Date.now() - new Date(j.publishedAt).getTime()) / (1000 * 60 * 60);
        return ageHours <= maxAgeHours;
      });
    }

    if (filters.selectedRoles && filters.selectedRoles.length > 0) {
      result = result.filter((j) => filters.selectedRoles.some((role) => jobMatchesRole(role, j)));
    }

    if (filters.savedOnly) {
      result = result.filter((j) => savedJobIds.has(j.jobId));
    }

    if (filters.appliedOnly) {
      result = result.filter((j) => appliedJobIds.has(j.jobId));
    }

    setFilteredJobs(result);
  };

  const handleSaveToggle = (jobId: string) => {
    const next = new Set(savedJobIds);
    if (next.has(jobId)) next.delete(jobId);
    else next.add(jobId);
    setSavedJobIds(next);
  };

  const handleAppliedToggle = (jobId: string) => {
    const next = new Set(appliedJobIds);
    if (next.has(jobId)) next.delete(jobId);
    else next.add(jobId);
    setAppliedJobIds(next);
  };

  return (
    <section
      className="relative w-full overflow-x-hidden min-h-screen"
      style={{ backgroundColor: "#0A0B0D" }}
    >
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-20">
        {checkoutBanner && (
          <div
            className={`mb-4 p-3 rounded-xl text-xs font-mono flex items-center gap-2 ${
              checkoutBanner === "success"
                ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
                : "bg-amber-500/10 border border-amber-500/30 text-amber-300"
            }`}
          >
            {checkoutBanner === "confirming" && (
              <>
                <span className="w-3 h-3 rounded-full border-2 border-amber-300 border-t-transparent animate-spin" />
                Confirmando tu pago con Wompi...
              </>
            )}
            {checkoutBanner === "success" && <>🎉 ¡Listo! Ya eres suscriptor Pro.</>}
            {checkoutBanner === "pending" && (
              <>
                ⏳ Tu pago sigue en proceso de confirmación — puede tardar unos minutos. Si no se
                actualiza, recarga la página más tarde o revisa el historial de pagos en{" "}
                <Link to="/cuenta" className="underline">
                  Mi cuenta
                </Link>
                .
              </>
            )}
          </div>
        )}

        {/* User Tier Status Banner */}
        <div className="flex items-center justify-between gap-4 mb-6 p-3 rounded-xl bg-[#131519] border border-[#262A31] text-xs font-mono">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${tier === "pro" ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`}
            />
            <span className="text-slate-300">
              Estado de Cuenta:{" "}
              <strong
                className={
                  tier === "pro" ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"
                }
              >
                {tier === "pro"
                  ? `🌟 Suscriptor Pro (${user?.email})`
                  : isAuthenticated
                    ? "FREE (Vacantes >48h Gratuitas / 0-48h Bloqueadas)"
                    : "Explorando sin cuenta (Vacantes >48h Gratuitas)"}
              </strong>
            </span>
          </div>

          {tier === "free" && (
            <button
              onClick={() => navigate("/pricing")}
              className="px-3 py-1 rounded bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold font-sans text-xs transition-all shadow"
            >
              🔓 Desbloquear Pro por {formatCOP(PRO_MONTHLY_PRICE_COP)} COP
            </button>
          )}
        </div>

        <div className="mt-4">
          <StatsBar totalJobs={allJobs.length} filteredJobs={filteredJobs.length} />

          <FilterBar onFilterChange={handleFilterChange} />

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl p-5 border border-[#262A31] bg-[#131519] animate-pulse space-y-3"
                >
                  <div className="h-3 w-24 rounded bg-[#1F232B]" />
                  <div className="h-4 w-3/4 rounded bg-[#1F232B]" />
                  <div className="h-3 w-1/2 rounded bg-[#1F232B]" />
                  <div className="h-3 w-2/3 rounded bg-[#1F232B]" />
                </div>
              ))}
            </div>
          ) : filteredJobs.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredJobs.map((job) =>
                job.isLocked ? (
                  <PaywallCard
                    key={job.jobId || job.url}
                    job={job}
                    onUnlockClick={() => navigate("/pricing")}
                  />
                ) : (
                  <JobCard
                    key={job.jobId || job.url}
                    job={{
                      ...job,
                      isSaved: savedJobIds.has(job.jobId),
                      isApplied: appliedJobIds.has(job.jobId)
                    }}
                    onSaveToggle={handleSaveToggle}
                    onAppliedToggle={handleAppliedToggle}
                  />
                )
              )}
            </div>
          ) : (
            <div className="text-center py-16 px-4 rounded-2xl border border-[#262A31] bg-[#131519] text-slate-400 font-mono">
              <span className="text-3xl block mb-2">🔍</span>
              No se encontraron vacantes con los filtros seleccionados.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
