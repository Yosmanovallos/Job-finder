import { useState, useEffect, useRef } from "react";

// Section-specific data
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

const mockJobs = [
  {
    id: 1,
    age: "hace 2 h",
    title: "Analista de Datos Senior",
    company: "Grupo Éxito",
    companyInitial: "G",
    location: "Medellín, Colombia",
    salary: "$4.500.000 – $6.000.000",
    mode: "Híbrido",
    contract: "Indefinido",
    primarySource: "LinkedIn Jobs",
    alsoIn: ["Computrabajo", "Magneto"],
  },
  {
    id: 2,
    age: "hace 5 h",
    title: "UX Designer",
    company: "Bancolombia",
    companyInitial: "B",
    location: "Bogotá, Colombia",
    salary: "$5.000.000 – $7.500.000",
    mode: "Remoto",
    contract: "Indefinido",
    primarySource: "Torre",
    alsoIn: ["GetOnBoard", "LinkedIn Jobs"],
  },
  {
    id: 3,
    age: "hace 11 h",
    title: "Cuidadora de Adultos Mayores",
    company: "Clínica Las Américas",
    companyInitial: "C",
    location: "Medellín, Colombia",
    salary: "$1.800.000 – $2.200.000",
    mode: "Presencial",
    contract: "Término fijo",
    primarySource: "Elempleo",
    alsoIn: ["Computrabajo"],
  },
];

// CheckIcon SVG
function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="2,7 5.5,10.5 12,3" />
    </svg>
  );
}

// XIcon SVG
function XIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <line x1="2" y1="2" x2="12" y2="12" />
      <line x1="12" y1="2" x2="2" y2="12" />
    </svg>
  );
}

// SearchIcon SVG
function SearchIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
    >
      <circle cx="7" cy="7" r="5" />
      <line x1="11" y1="11" x2="14" y2="14" />
    </svg>
  );
}

// Job Card Component
function JobCard({
  job,
  dimmed,
}: {
  job: (typeof mockJobs)[0];
  dimmed: boolean;
}) {
  return (
    <div
      className="rounded-xl border p-4 transition-all duration-150 ease-out group"
      style={{
        backgroundColor: dimmed ? "rgba(19,21,25,0.5)" : "#131519",
        borderColor: "#262A31",
        opacity: dimmed ? 0.45 : 1,
      }}
      onMouseEnter={(e) => {
        if (!dimmed) {
          (e.currentTarget as HTMLDivElement).style.borderColor = "#3A404A";
          (e.currentTarget as HTMLDivElement).style.backgroundColor = "#1B1E24";
        }
      }}
      onMouseLeave={(e) => {
        if (!dimmed) {
          (e.currentTarget as HTMLDivElement).style.borderColor = "#262A31";
          (e.currentTarget as HTMLDivElement).style.backgroundColor = "#131519";
        }
      }}
    >
      {/* Top row */}
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{
              fontFamily:
                "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
              color: "#646B75",
              backgroundColor: "#1B1E24",
              border: "1px solid #262A31",
            }}
          >
            {job.age}
          </span>
          <span
            className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
            style={{
              fontFamily:
                "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
              color: "#34D399",
              backgroundColor: "rgba(52,211,153,0.10)",
              border: "1px solid rgba(52,211,153,0.20)",
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: "#34D399" }}
            />
            Verificada
          </span>
        </div>
        <button
          className="flex items-center justify-center w-7 h-7 rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2"
          style={{
            color: "#646B75",
            minWidth: "28px",
          }}
          aria-label="Descartar vacante"
          tabIndex={dimmed ? -1 : 0}
        >
          <XIcon size={12} />
        </button>
      </div>

      {/* Title */}
      <h3
        className="text-base font-semibold mb-1.5 leading-snug"
        style={{ color: "#F4F5F7" }}
      >
        {job.title}
      </h3>

      {/* Company line */}
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-5 h-5 rounded flex items-center justify-center text-xs font-semibold flex-shrink-0"
          style={{
            backgroundColor: "#1B1E24",
            color: "#9AA1AC",
            border: "1px solid #262A31",
            fontFamily:
              "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
          }}
        >
          {job.companyInitial}
        </div>
        <span className="text-sm" style={{ color: "#9AA1AC" }}>
          {job.company}
        </span>
        <span style={{ color: "#646B75" }}>·</span>
        <span className="text-sm" style={{ color: "#9AA1AC" }}>
          {job.location}
        </span>
      </div>

      {/* Metadata */}
      <div
        className="text-xs mb-3"
        style={{
          fontFamily:
            "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
          color: "#646B75",
        }}
      >
        {job.salary} · {job.mode} · {job.contract}
      </div>

      {/* Source chips */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        <span
          className="text-xs px-2 py-0.5 rounded-full"
          style={{
            fontFamily:
              "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
            color: "#9AA1AC",
            backgroundColor: "#1B1E24",
            border: "1px solid #262A31",
          }}
        >
          {job.primarySource}
        </span>
        <span
          className="text-xs"
          style={{
            color: "#646B75",
            fontFamily:
              "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
          }}
        >
          también en:
        </span>
        {job.alsoIn.map((src) => (
          <span
            key={src}
            className="text-xs px-2 py-0.5 rounded-full"
            style={{
              fontFamily:
                "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
              color: "#646B75",
              backgroundColor: "transparent",
              border: "1px solid #262A31",
            }}
          >
            {src}
          </span>
        ))}
      </div>

      {/* Bottom row */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          className="text-xs px-3 py-1.5 rounded-md border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 min-h-[36px]"
          style={{
            color: "#9AA1AC",
            borderColor: "#262A31",
            backgroundColor: "transparent",
          }}
          tabIndex={dimmed ? -1 : 0}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              "#1B1E24";
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              "#3A404A";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              "transparent";
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              "#262A31";
          }}
        >
          Guardar
        </button>
        <button
          className="text-xs px-3 py-1.5 rounded-md border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 min-h-[36px]"
          style={{
            color: "#9AA1AC",
            borderColor: "#262A31",
            backgroundColor: "transparent",
          }}
          tabIndex={dimmed ? -1 : 0}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              "#1B1E24";
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              "#3A404A";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor =
              "transparent";
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              "#262A31";
          }}
        >
          Marcar aplicada
        </button>
        <a
          href="#top"
          className="text-xs ml-auto transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 min-h-[36px] flex items-center"
          style={{ color: "#34D399" }}
          tabIndex={dimmed ? -1 : 0}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.color = "#6EE7B7";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLAnchorElement).style.color = "#34D399";
          }}
        >
          Aplicar →
        </a>
      </div>
    </div>
  );
}

export default function HeroDemo() {
  const [query, setQuery] = useState("");
  const [activeRange, setActiveRange] = useState("24h");
  const [phase, setPhase] = useState<"idle" | "loading" | "results">("idle");
  const [checkedSources, setCheckedSources] = useState<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isIdle = phase === "idle";
  const isLoading = phase === "loading";
  const isResults = phase === "results";

  function handleSearch() {
    if (!query.trim()) return;
    setPhase("loading");
    setCheckedSources(0);

    const totalSources = sources.length;
    const interval = 1600 / totalSources;

    let count = 0;
    const tick = () => {
      count += 1;
      setCheckedSources(count);
      if (count < totalSources) {
        timerRef.current = setTimeout(tick, interval);
      } else {
        timerRef.current = setTimeout(() => {
          setPhase("results");
        }, 200);
      }
    };
    timerRef.current = setTimeout(tick, interval);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSearch();
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <section
      id="hero-demo"
      className="relative w-full overflow-x-hidden"
      style={{ backgroundColor: "#0A0B0D" }}
    >
      {/* Grid lines decoration */}
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          backgroundImage:
            "linear-gradient(rgba(38,42,49,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(38,42,49,0.35) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />

      {/* Radial glow */}
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
        {/* Status chip */}
        <div
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-8 text-xs"
          style={{
            fontFamily:
              "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
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
          Ahora con verificación de vigencia en tiempo real
        </div>

        {/* H1 */}
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

        {/* Lead paragraph */}
        <p
          className="mb-10 text-base md:text-lg leading-relaxed"
          style={{
            color: "#9AA1AC",
            maxWidth: "620px",
            lineHeight: 1.65,
          }}
        >
          Escribe el rol que buscas. Job Radar consulta más de 10 portales a la
          vez, elimina duplicados, verifica que cada oferta siga activa y te
          entrega solo lo publicado en las últimas horas.
        </p>

        {/* Demo panel */}
        <div
          className="w-full rounded-2xl p-5 md:p-6"
          style={{
            maxWidth: "720px",
            backgroundColor: "#131519",
            border: "1px solid #262A31",
          }}
        >
          {/* Panel header micro-label */}
          <div
            className="flex items-center gap-2 mb-4"
            style={{
              fontFamily:
                "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
              fontSize: "0.8125rem",
              color: "#646B75",
            }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: "#34D399" }}
            />
            job-radar / búsqueda
          </div>

          {/* Input + button row */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <span
                className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: "#646B75" }}
              >
                <SearchIcon />
              </span>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ej: analista de datos, cuidadora de adultos mayores, UX designer"
                className="w-full pl-9 pr-4 py-3 rounded-lg text-sm transition-all duration-150 focus-visible:outline-none focus-visible:ring-2"
                style={{
                  backgroundColor: "#1B1E24",
                  border: "1px solid #262A31",
                  color: "#F4F5F7",
                  fontFamily: "inherit",
                  minHeight: "44px",
                }}
                aria-label="Rol que buscas"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={!query.trim() || isLoading}
              className="px-5 py-3 rounded-lg text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 disabled:pointer-events-none sm:w-auto w-full"
              style={{
                backgroundColor: "#34D399",
                color: "#0A0B0D",
                minHeight: "44px",
              }}
              onMouseEnter={(e) => {
                if (!e.currentTarget.disabled)
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                    "#6EE7B7";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  "#34D399";
              }}
            >
              {isLoading ? "Buscando…" : "Buscar"}
            </button>
          </div>

          {/* Time range chips */}
          <div className="flex flex-wrap gap-2 mb-5">
            {timeRanges.map((range) => {
              const isActive = activeRange === range.value;
              return (
                <button
                  key={range.value}
                  onClick={() => setActiveRange(range.value)}
                  className="px-3 py-1.5 rounded-full text-xs transition-all duration-150 focus-visible:outline-none focus-visible:ring-2"
                  style={{
                    fontFamily:
                      "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                    backgroundColor: isActive
                      ? "rgba(52,211,153,0.10)"
                      : "transparent",
                    border: isActive
                      ? "1px solid rgba(52,211,153,0.35)"
                      : "1px solid #262A31",
                    color: isActive ? "#34D399" : "#646B75",
                    minHeight: "32px",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLButtonElement).style.borderColor =
                        "#3A404A";
                      (e.currentTarget as HTMLButtonElement).style.color =
                        "#9AA1AC";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      (e.currentTarget as HTMLButtonElement).style.borderColor =
                        "#262A31";
                      (e.currentTarget as HTMLButtonElement).style.color =
                        "#646B75";
                    }
                  }}
                >
                  {range.label}
                </button>
              );
            })}
          </div>

          {/* Loading state */}
          {isLoading && (
            <div
              className="mb-4 p-4 rounded-lg"
              style={{
                backgroundColor: "#0A0B0D",
                border: "1px solid #262A31",
              }}
            >
              <div
                className="text-xs mb-3"
                style={{
                  fontFamily:
                    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                  color: "#646B75",
                }}
              >
                consultando fuentes…
              </div>
              <div className="flex flex-col gap-1.5">
                {sources.map((src, i) => {
                  const done = i < checkedSources;
                  const active = i === checkedSources;
                  return (
                    <div
                      key={src}
                      className="flex items-center gap-2 transition-opacity duration-150"
                      style={{ opacity: done || active ? 1 : 0.3 }}
                    >
                      <span
                        className="w-4 h-4 flex items-center justify-center flex-shrink-0"
                        style={{ color: done ? "#34D399" : "#646B75" }}
                      >
                        {done ? (
                          <CheckIcon size={12} />
                        ) : (
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{
                              backgroundColor: active ? "#34D399" : "#646B75",
                            }}
                          />
                        )}
                      </span>
                      <span
                        className="text-xs"
                        style={{
                          fontFamily:
                            "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                          color: done ? "#9AA1AC" : "#646B75",
                        }}
                      >
                        {src}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Results header when loaded */}
          {isResults && (
            <div
              className="flex items-center justify-between mb-3"
              style={{
                fontFamily:
                  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                fontSize: "0.8125rem",
              }}
            >
              <span style={{ color: "#646B75" }}>
                3 vacantes encontradas · deduplicadas
              </span>
              <span
                className="px-2 py-0.5 rounded-full text-xs"
                style={{
                  color: "#34D399",
                  backgroundColor: "rgba(52,211,153,0.10)",
                  border: "1px solid rgba(52,211,153,0.20)",
                }}
              >
                verificadas
              </span>
            </div>
          )}

          {/* Job cards */}
          <div className="flex flex-col gap-3">
            {mockJobs.map((job) => (
              <JobCard key={job.id} job={job} dimmed={isIdle} />
            ))}
          </div>
        </div>

        {/* Disclaimer */}
        <p
          className="mt-4 text-xs text-center"
          style={{
            fontFamily:
              "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
            color: "#646B75",
          }}
        >
          Datos de ejemplo. Crea una cuenta para lanzar búsquedas reales.
        </p>
      </div>

      {/* Pulse animation keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation: none !important; transition-duration: 0ms !important; }
        }
      `}</style>
    </section>
  );
}
