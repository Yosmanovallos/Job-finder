import { useState, useEffect, useRef } from "react";

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
];

interface JobItem {
  jobId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  dateText: string;
  source: string;
}

function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="2,7 5.5,10.5 12,3" />
    </svg>
  );
}

function XIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <line x1="2" y1="2" x2="12" y2="12" />
      <line x1="12" y1="2" x2="2" y2="12" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
      <circle cx="7" cy="7" r="5" />
      <line x1="11" y1="11" x2="14" y2="14" />
    </svg>
  );
}

function JobCard({ job }: { job: JobItem }) {
  return (
    <div
      className="rounded-xl border p-4 transition-all duration-150 ease-out text-left"
      style={{
        backgroundColor: "#131519",
        borderColor: "#262A31",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "#3A404A";
        (e.currentTarget as HTMLDivElement).style.backgroundColor = "#1B1E24";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = "#262A31";
        (e.currentTarget as HTMLDivElement).style.backgroundColor = "#131519";
      }}
    >
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
              color: "#646B75",
              backgroundColor: "#1B1E24",
              border: "1px solid #262A31",
            }}
          >
            {job.dateText || "Reciente"}
          </span>
          <span
            className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
              color: "#34D399",
              backgroundColor: "rgba(52,211,153,0.10)",
              border: "1px solid rgba(52,211,153,0.20)",
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#34D399" }} />
            Verificada
          </span>
        </div>
        <span
          className="text-xs px-2.5 py-0.5 rounded-full font-medium"
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
            color: "#34D399",
            backgroundColor: "#1B1E24",
            border: "1px solid #262A31",
          }}
        >
          {job.source}
        </span>
      </div>

      <h3 className="text-base font-semibold mb-1.5 leading-snug" style={{ color: "#F4F5F7" }}>
        {job.title}
      </h3>

      <div className="flex items-center gap-2 mb-3 text-sm" style={{ color: "#9AA1AC" }}>
        <span className="font-medium" style={{ color: "#F4F5F7" }}>{job.company || "Empresa confidencial"}</span>
        <span style={{ color: "#646B75" }}>·</span>
        <span>{job.location || "Colombia"}</span>
      </div>

      <div className="flex items-center justify-between border-t border-[#262A31] pt-3 mt-2">
        <span className="text-xs" style={{ fontFamily: "monospace", color: "#646B75" }}>
          Sincronizada a Notion
        </span>
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs px-3 py-1.5 rounded-md font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 flex items-center gap-1"
          style={{
            color: "#0A0B0D",
            backgroundColor: "#34D399",
            textDecoration: "none",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "#6EE7B7";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "#34D399";
          }}
        >
          Aplicar ↗
        </a>
      </div>
    </div>
  );
}

export default function HeroDemo() {
  const [query, setQuery] = useState("");
  const [activeRange, setActiveRange] = useState("48h");
  const [isLoading, setIsLoading] = useState(false);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [checkedSources, setCheckedSources] = useState<number>(0);

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
          setJobs(data.jobs);
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

  async function handleSearch() {
    if (!query.trim() || isLoading) return;
    setIsLoading(true);
    setLogs([`Iniciando escaneo para "${query}" (${activeRange})...`]);

    // Simulate incremental source check visual
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

      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(52,211,153,0.07) 0%, transparent 70%)",
        }}
      />

      <div
        className="relative mx-auto px-4 md:px-8 lg:px-16 py-20 md:py-28 flex flex-col items-center text-center"
        style={{ maxWidth: "1200px" }}
      >
        <div
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-8 text-xs font-mono"
          style={{
            color: "#34D399",
            backgroundColor: "rgba(52,211,153,0.10)",
            border: "1px solid rgba(52,211,153,0.25)",
          }}
        >
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{
              backgroundColor: "#34D399",
              animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite",
            }}
          />
          Escáner en vivo con verificación WAF & Notion Sync
        </div>

        <h1
          className="font-semibold mb-5 tracking-tight leading-none"
          style={{
            fontSize: "clamp(2rem, 5vw, 3.5rem)",
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
            color: "#F4F5F7",
            maxWidth: "820px",
          }}
        >
          Deja de llegar tarde a las vacantes
        </h1>

        <p
          className="mb-10 text-base md:text-lg leading-relaxed"
          style={{
            color: "#9AA1AC",
            maxWidth: "620px",
            lineHeight: 1.65,
          }}
        >
          Escribe el rol que buscas. Job Radar consulta más de 10 portales a la vez, elimina duplicados, verifica que cada oferta siga activa y te entrega solo lo publicado en las últimas horas.
        </p>

        <div
          className="w-full rounded-2xl p-5 md:p-6 shadow-2xl"
          style={{
            maxWidth: "780px",
            backgroundColor: "#131519",
            border: "1px solid #262A31",
          }}
        >
          <div
            className="flex items-center justify-between mb-4 font-mono text-xs"
            style={{ color: "#646B75" }}
          >
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "#34D399" }} />
              job-radar / búsqueda en vivo
            </div>
            {isLoading && <span className="text-[#34D399] animate-pulse">Escaneando portales...</span>}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#646B75" }}>
                <SearchIcon />
              </span>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ej: cuidadora de abuelos o abuelas, analista de datos, UX designer"
                className="w-full pl-9 pr-4 py-3 rounded-lg text-sm transition-all duration-150 focus-visible:outline-none focus-visible:ring-2"
                style={{
                  backgroundColor: "#1B1E24",
                  border: "1px solid #262A31",
                  color: "#F4F5F7",
                  minHeight: "44px",
                }}
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={!query.trim() || isLoading}
              className="px-6 py-3 rounded-lg text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 sm:w-auto w-full flex items-center justify-center gap-2"
              style={{
                backgroundColor: "#34D399",
                color: "#0A0B0D",
                minHeight: "44px",
              }}
            >
              {isLoading ? (
                <>
                  <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  Escaneando...
                </>
              ) : (
                "🚀 Ejecutar Scraper"
              )}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-5">
            <span className="text-xs font-mono text-[#646B75] mr-1">Rango:</span>
            {timeRanges.map((range) => {
              const isActive = activeRange === range.value;
              return (
                <button
                  key={range.value}
                  onClick={() => setActiveRange(range.value)}
                  className="px-3 py-1.5 rounded-full text-xs font-mono transition-all duration-150"
                  style={{
                    backgroundColor: isActive ? "rgba(52,211,153,0.10)" : "transparent",
                    border: isActive ? "1px solid rgba(52,211,153,0.35)" : "1px solid #262A31",
                    color: isActive ? "#34D399" : "#646B75",
                  }}
                >
                  {range.label}
                </button>
              );
            })}
          </div>

          {/* Terminal Logs Window */}
          {logs.length > 0 && (
            <div className="mb-5 p-3 rounded-lg text-left font-mono text-xs max-h-36 overflow-y-auto" style={{ backgroundColor: "#0A0B0D", border: "1px solid #262A31", color: "#34D399" }}>
              <div className="text-[#646B75] mb-1">=== Consola de Escaneo ===</div>
              {logs.map((log, idx) => (
                <div key={idx} className="whitespace-pre-wrap">{log}</div>
              ))}
            </div>
          )}

          {/* Job List */}
          <div className="flex items-center justify-between mb-3 text-xs font-mono text-[#646B75]">
            <span>{jobs.length} vacantes encontradas · Sincronizadas</span>
            <span className="text-[#34D399]">100% Activas</span>
          </div>

          <div className="flex flex-col gap-3 max-h-[500px] overflow-y-auto pr-1">
            {jobs.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-[#262A31] rounded-xl text-[#646B75] font-mono text-xs">
                No hay vacantes cargadas aún. Realiza una búsqueda arriba para comenzar.
              </div>
            ) : (
              jobs.map((job) => <JobCard key={job.jobId} job={job} />)
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
