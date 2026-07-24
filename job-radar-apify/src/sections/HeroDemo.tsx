import { useState, useEffect, useRef } from "react";
import { JobCard } from "../components/JobCard.js";
import { PaywallCard } from "../components/PaywallCard.js";
import { FilterBar, FilterState } from "../components/FilterBar.js";
import { StatsBar } from "../components/StatsBar.js";
import { useAuth } from "../auth/auth-provider.js";
import { startPaymentCheckout } from "../payments/checkout.js";

const timeRanges = [
  { label: "24 horas", value: "24h" },
  { label: "48 horas", value: "48h" },
  { label: "7 días", value: "7d" },
  { label: "30 días", value: "30d" },
];

const sources = [
  "LinkedIn Jobs",
  "Computrabajo",
  "Elempleo",
  "Magneto",
  "Torre",
  "GetOnBoard",
  "RemoteOK",
  "Remotive",
  "Workana",
  "WeRemoto",
  "Indeed",
  "Glassdoor"
];

function SearchIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
      <circle cx="7" cy="7" r="5" />
      <line x1="11" y1="11" x2="14" y2="14" />
    </svg>
  );
}

export default function HeroDemo() {
  const { tier, upgradeToPro, user } = useAuth();
  const [query, setQuery] = useState("");
  const [activeRange, setActiveRange] = useState("48h");
  const [isLoading, setIsLoading] = useState(false);
  const [allJobs, setAllJobs] = useState<any[]>([]);
  const [filteredJobs, setFilteredJobs] = useState<any[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [checkedSources, setCheckedSources] = useState<number>(0);
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(new Set());

  const inputRef = useRef<HTMLInputElement>(null);

  // Load existing jobs on initial render
  useEffect(() => {
    fetchJobs();
  }, []);

  async function fetchJobs() {
    try {
      const res = await fetch('/api/jobs');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.jobs)) {
          setAllJobs(data.jobs);
          setFilteredJobs(data.jobs);
        }
      }
    } catch (e) {}
  }

  // Connect SSE for real-time logs
  useEffect(() => {
    const eventSource = new EventSource('/api/events');

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'log') {
          setLogs((prev) => [...prev.slice(-15), data.message]);
          
          if (data.message.includes('Finalizado') || data.message.includes('finalizado')) {
            setIsLoading(false);
            fetchJobs();
          }
        }
      } catch (e) {}
    };

    return () => {
      eventSource.close();
    };
  }, []);

  // Filter handler (Instant local execution < 50ms)
  const handleFilterChange = (filters: FilterState) => {
    let result = [...allJobs];

    if (filters.search.trim()) {
      const s = filters.search.toLowerCase();
      result = result.filter(j => 
        (j.title && j.title.toLowerCase().includes(s)) ||
        (j.company && j.company.toLowerCase().includes(s)) ||
        (j.location && j.location.toLowerCase().includes(s))
      );
    }

    if (filters.source && filters.source !== 'all') {
      result = result.filter(j => 
        j.source === filters.source || 
        (Array.isArray(j.sources) && j.sources.includes(filters.source)) ||
        (Array.isArray(j.alsoIn) && j.alsoIn.includes(filters.source))
      );
    }

    if (filters.modality && filters.modality !== 'all') {
      const m = filters.modality.toLowerCase();
      result = result.filter(j => {
        const loc = (j.location || '').toLowerCase();
        if (m === 'remoto') return loc.includes('remoto') || loc.includes('remote');
        if (m === 'hibrido') return loc.includes('híbrido') || loc.includes('hibrido');
        if (m === 'presencial') return !loc.includes('remoto') && !loc.includes('remote') && !loc.includes('híbrido');
        return true;
      });
    }

    if (filters.savedOnly) {
      result = result.filter(j => savedJobIds.has(j.jobId));
    }

    setFilteredJobs(result);
  };

  const handleSaveToggle = (jobId: string) => {
    const next = new Set(savedJobIds);
    if (next.has(jobId)) next.delete(jobId);
    else next.add(jobId);
    setSavedJobIds(next);
  };

  const handleUnlockPro = async () => {
    const res = await startPaymentCheckout({
      planId: 'plan_pro_monthly',
      currency: 'COP',
      amount: 14900,
      userEmail: user?.email || 'usuario@jobradar.app'
    });
    if (res.success) {
      upgradeToPro();
      alert('🎉 ¡Felicidades! Tu suscripción Pro ha sido activada exitosamente. Todas las vacantes han sido desbloqueadas.');
    }
  };

  async function handleSearch() {
    if (!query.trim() || isLoading) return;
    setIsLoading(true);
    setLogs([`Iniciando escaneo para "${query}" (${activeRange})...`]);

    let count = 0;
    const timer = setInterval(() => {
      count++;
      setCheckedSources(count);
      if (count >= sources.length) clearInterval(timer);
    }, 400);

    try {
      await fetch('/api/run-scraper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: [query],
          dateRange: activeRange
        })
      });
    } catch (err) {
      setLogs((prev) => [...prev, 'Error de conexión con el servidor.']);
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSearch();
  }

  const isRecentJob = (job: any) => {
    if (!job.publishedAt) return true;
    const ageMs = Date.now() - new Date(job.publishedAt).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    return ageHours <= 48;
  };

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
          backgroundSize: "64px 64px",
        }}
      />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20">
        {/* User Tier Status Banner */}
        <div className="flex items-center justify-between gap-4 mb-6 p-3 rounded-xl bg-[#131519] border border-[#262A31] text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${tier === 'pro' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span className="text-slate-300">
              Estado de Cuenta: <strong className={tier === 'pro' ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                {tier === 'pro' ? '🌟 Suscriptor Pro (Acceso Total Ilimitado)' : 'FREE (Vacantes >48h Gratuitas / 0-48h Bloqueadas)'}
              </strong>
            </span>
          </div>

          {tier === 'free' && (
            <button
              onClick={handleUnlockPro}
              className="px-3 py-1 rounded bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold font-sans text-xs transition-all shadow"
            >
              🔓 Desbloquear Pro por $14.900 COP
            </button>
          )}
        </div>

        {/* Hero title */}
        <h1
          className="text-center text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-white mb-4"
          style={{ fontFamily: "'Space Grotesk', sans-serif" }}
        >
          Encuentra todas las vacantes de Colombia{" "}
          <span style={{ color: "#34D399" }}>en un solo lugar</span>
        </h1>

        <p className="text-center text-base sm:text-lg text-slate-400 max-w-2xl mx-auto mb-10">
          Escaneamos 12 portales simultáneamente en tiempo real. Deduplicado automático por SHA256.
        </p>

        {/* Search Bar */}
        <div className="max-w-3xl mx-auto mb-8">
          <div className="flex flex-col sm:flex-row items-stretch gap-2 p-2 rounded-2xl border border-[#262A31] bg-[#131519] shadow-2xl">
            <div className="relative flex-1 flex items-center">
              <span className="absolute left-4 text-slate-400">
                <SearchIcon />
              </span>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ej. Analista de Datos, QA Engineer, Project Manager..."
                className="w-full bg-transparent pl-11 pr-4 py-3 text-slate-100 placeholder-slate-500 text-sm focus:outline-none font-sans"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={activeRange}
                onChange={(e) => setActiveRange(e.target.value)}
                className="px-3 py-3 bg-[#0A0B0D] border border-[#262A31] rounded-xl text-xs text-slate-300 font-mono focus:outline-none"
              >
                {timeRanges.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>

              <button
                onClick={handleSearch}
                disabled={isLoading}
                className="px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 whitespace-nowrap"
              >
                {isLoading ? "Escaneando..." : "Escanear Vacantes"}
              </button>
            </div>
          </div>
        </div>

        {/* Terminal Logs (if running) */}
        {logs.length > 0 && (
          <div className="max-w-3xl mx-auto mb-8 p-4 rounded-xl bg-[#0A0B0D] border border-[#262A31] font-mono text-xs text-emerald-400 space-y-1 max-h-40 overflow-y-auto">
            {logs.map((log, idx) => (
              <div key={idx}>▸ {log}</div>
            ))}
          </div>
        )}

        {/* FilterBar & StatsBar */}
        <div className="mt-8">
          <StatsBar 
            totalJobs={allJobs.length}
            filteredJobs={filteredJobs.length}
            duplicatesRemoved={Math.max(0, allJobs.length - filteredJobs.length)}
          />

          <FilterBar onFilterChange={handleFilterChange} />

          {/* Job List Grid with 48h Freshness Paywall Rule */}
          {filteredJobs.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredJobs.map((job) => {
                const isLocked = tier !== 'pro' && isRecentJob(job);
                return isLocked ? (
                  <PaywallCard
                    key={job.jobId || job.url}
                    job={job}
                    onUnlockClick={handleUnlockPro}
                  />
                ) : (
                  <JobCard
                    key={job.jobId || job.url}
                    job={{
                      ...job,
                      isSaved: savedJobIds.has(job.jobId)
                    }}
                    onSaveToggle={handleSaveToggle}
                  />
                );
              })}
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
