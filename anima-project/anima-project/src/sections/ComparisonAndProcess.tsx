import { useState } from "react";

// Comparison table data
const comparisonRows = [
  {
    criterion: "Cobertura",
    manual: "Un portal a la vez",
    radar: "Más de 10 fuentes en paralelo",
  },
  {
    criterion: "Frescura",
    manual: "Lo que alcances a revisar",
    radar: "Filtro de 24 h, 48 h o 7 días",
  },
  {
    criterion: "Duplicados",
    manual: "Los detectas aplicando",
    radar: "Fusionados antes de mostrarlos",
  },
  {
    criterion: "Vigencia del enlace",
    manual: "Descubres al hacer clic",
    radar: "Verificada antes de aparecer",
  },
  {
    criterion: "Tiempo por búsqueda",
    manual: "40–60 minutos",
    radar: "Menos de 2 minutos",
  },
];

// Process steps data
const processSteps = [
  {
    number: "01",
    title: "Describe el rol",
    description:
      "Escribe cómo se llama el puesto que buscas, en tus palabras. No hace falta que uses el término técnico.",
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="4" width="14" height="12" rx="2" />
        <path d="M7 8h6M7 12h4" />
      </svg>
    ),
  },
  {
    number: "02",
    title: "La IA expande la búsqueda",
    description:
      "Genera las variantes equivalentes en español e inglés para que no se te escape ninguna publicación.",
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="10" cy="10" r="3" />
        <path d="M10 3v2M10 15v2M3 10h2M15 10h2M5.05 5.05l1.41 1.41M13.54 13.54l1.41 1.41M5.05 14.95l1.41-1.41M13.54 6.46l1.41-1.41" />
      </svg>
    ),
  },
  {
    number: "03",
    title: "Consulta y limpia",
    description:
      "Recorre las fuentes en paralelo, fusiona duplicados y descarta lo que ya está cerrado.",
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 6h14M6 10h8M9 14h2" />
      </svg>
    ),
  },
  {
    number: "04",
    title: "Recibe y organiza",
    description:
      "Resultados en el dashboard y sincronizados a tu base de datos de Notion, listos para aplicar.",
    icon: (
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="6" height="6" rx="1" />
        <rect x="11" y="3" width="6" height="6" rx="1" />
        <rect x="3" y="11" width="6" height="6" rx="1" />
        <rect x="11" y="11" width="6" height="6" rx="1" />
      </svg>
    ),
  },
];

// Check icon for radar column
function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      style={{ color: "#34D399" }}
    >
      <path d="M3 8l3.5 3.5L13 4" />
    </svg>
  );
}

// Cross icon for manual column
function CrossIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      style={{ color: "#646B75" }}
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export default function ComparisonAndProcess() {
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [hoveredStep, setHoveredStep] = useState<number | null>(null);

  return (
    <section
      id="comparison-and-process"
      className="bg-background py-16 md:py-20 px-4 md:px-8 lg:px-16 overflow-x-hidden"
      style={{ backgroundColor: "#0A0B0D" }}
    >
      <div className="max-w-6xl mx-auto">
        {/* ── COMPARISON BLOCK ── */}
        <div className="mb-16 md:mb-24">
          {/* Section label */}
          <div
            className="mb-6 flex items-center gap-3"
            style={{
              fontFamily:
                "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
            }}
          >
            <span
              className="text-xs uppercase tracking-widest"
              style={{ color: "#646B75" }}
            >
              comparativa
            </span>
            <span
              className="h-px flex-1 max-w-12"
              style={{ backgroundColor: "#262A31" }}
            />
          </div>

          <h2
            className="font-semibold mb-10 leading-tight"
            style={{
              fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
              letterSpacing: "-0.01em",
              color: "#F4F5F7",
              fontFamily:
                "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
            }}
          >
            Frente a buscar a mano
          </h2>

          {/* Desktop table — hidden below lg */}
          <div
            className="hidden lg:block rounded-xl overflow-hidden"
            style={{ border: "1px solid #262A31" }}
          >
            {/* Table header */}
            <div
              className="grid"
              style={{
                gridTemplateColumns: "1fr 1fr 1fr",
                backgroundColor: "#131519",
                borderBottom: "1px solid #262A31",
              }}
            >
              <div
                className="px-6 py-4 text-xs uppercase tracking-widest"
                style={{
                  color: "#646B75",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                  borderRight: "1px solid #262A31",
                }}
              >
                criterio
              </div>
              <div
                className="px-6 py-4 text-xs uppercase tracking-widest"
                style={{
                  color: "#646B75",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                  borderRight: "1px solid #262A31",
                }}
              >
                Buscar por tu cuenta
              </div>
              <div
                className="px-6 py-4 text-xs uppercase tracking-widest flex items-center gap-2"
                style={{
                  color: "#34D399",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                  backgroundColor: "rgba(52,211,153,0.06)",
                }}
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: "#34D399" }}
                />
                Job Radar
              </div>
            </div>

            {/* Table rows */}
            {comparisonRows.map((row, i) => (
              <div
                key={row.criterion}
                className="grid transition-colors duration-150"
                style={{
                  gridTemplateColumns: "1fr 1fr 1fr",
                  borderBottom:
                    i < comparisonRows.length - 1
                      ? "1px solid #262A31"
                      : "none",
                  backgroundColor:
                    hoveredRow === i
                      ? "#1B1E24"
                      : i % 2 === 0
                        ? "#0A0B0D"
                        : "#0D0F12",
                  cursor: "default",
                }}
                onMouseEnter={() => setHoveredRow(i)}
                onMouseLeave={() => setHoveredRow(null)}
              >
                {/* Criterion */}
                <div
                  className="px-6 py-4 text-sm font-semibold"
                  style={{
                    color: "#F4F5F7",
                    borderRight: "1px solid #262A31",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                  }}
                >
                  {row.criterion}
                </div>

                {/* Manual */}
                <div
                  className="px-6 py-4 flex items-start gap-2 text-sm"
                  style={{
                    color: "#9AA1AC",
                    borderRight: "1px solid #262A31",
                    fontFamily:
                      "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
                  }}
                >
                  <CrossIcon />
                  <span>{row.manual}</span>
                </div>

                {/* Radar */}
                <div
                  className="px-6 py-4 flex items-start gap-2 text-sm"
                  style={{
                    color: "#F4F5F7",
                    backgroundColor:
                      hoveredRow === i
                        ? "rgba(52,211,153,0.08)"
                        : "rgba(52,211,153,0.04)",
                    fontFamily:
                      "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
                    transition: "background-color 150ms ease-out",
                  }}
                >
                  <CheckIcon />
                  <span>{row.radar}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Mobile cards — shown below lg */}
          <div className="lg:hidden flex flex-col gap-4">
            {comparisonRows.map((row) => (
              <div
                key={row.criterion}
                className="rounded-xl overflow-hidden"
                style={{
                  border: "1px solid #262A31",
                  backgroundColor: "#131519",
                }}
              >
                {/* Card header: criterion */}
                <div
                  className="px-4 py-3 text-xs uppercase tracking-widest"
                  style={{
                    color: "#34D399",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                    borderBottom: "1px solid #262A31",
                    backgroundColor: "rgba(52,211,153,0.06)",
                  }}
                >
                  {row.criterion}
                </div>

                <div className="p-4 flex flex-col gap-4">
                  {/* Manual value */}
                  <div>
                    <p
                      className="text-xs uppercase tracking-widest mb-1"
                      style={{
                        color: "#646B75",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                      }}
                    >
                      Buscar por tu cuenta
                    </p>
                    <div className="flex items-start gap-2">
                      <CrossIcon />
                      <p
                        className="text-sm"
                        style={{
                          color: "#9AA1AC",
                          fontFamily:
                            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
                        }}
                      >
                        {row.manual}
                      </p>
                    </div>
                  </div>

                  {/* Divider */}
                  <div style={{ height: "1px", backgroundColor: "#262A31" }} />

                  {/* Radar value */}
                  <div>
                    <p
                      className="text-xs uppercase tracking-widest mb-1"
                      style={{
                        color: "#34D399",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                      }}
                    >
                      Job Radar
                    </p>
                    <div className="flex items-start gap-2">
                      <CheckIcon />
                      <p
                        className="text-sm"
                        style={{
                          color: "#F4F5F7",
                          fontFamily:
                            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
                        }}
                      >
                        {row.radar}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── PROCESS BLOCK ── */}
        <div id="como-funciona">
          {/* Section label */}
          <div
            className="mb-6 flex items-center gap-3"
            style={{
              fontFamily:
                "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
            }}
          >
            <span
              className="text-xs uppercase tracking-widest"
              style={{ color: "#646B75" }}
            >
              proceso
            </span>
            <span
              className="h-px flex-1 max-w-12"
              style={{ backgroundColor: "#262A31" }}
            />
          </div>

          <h2
            className="font-semibold mb-10 leading-tight"
            style={{
              fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
              letterSpacing: "-0.01em",
              color: "#F4F5F7",
              fontFamily:
                "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
            }}
          >
            Cómo funciona
          </h2>

          {/* Steps grid with connector line on desktop */}
          <div className="relative">
            {/* Connector line — desktop only */}
            <div
              className="hidden lg:block absolute top-8 left-0 right-0 h-px"
              style={{
                backgroundColor: "#262A31",
                zIndex: 0,
                marginLeft: "calc(12.5% + 16px)",
                marginRight: "calc(12.5% + 16px)",
              }}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 relative">
              {processSteps.map((step, i) => (
                <div
                  key={step.number}
                  className="relative flex flex-col rounded-xl p-6 transition-all duration-150"
                  style={{
                    border:
                      hoveredStep === i
                        ? "1px solid #3A404A"
                        : "1px solid #262A31",
                    backgroundColor: hoveredStep === i ? "#1B1E24" : "#131519",
                    cursor: "default",
                    zIndex: 1,
                  }}
                  onMouseEnter={() => setHoveredStep(i)}
                  onMouseLeave={() => setHoveredStep(null)}
                >
                  {/* Step number */}
                  <div className="mb-4 flex items-center justify-between">
                    <span
                      className="text-2xl font-semibold leading-none"
                      style={{
                        color: hoveredStep === i ? "#34D399" : "#262A31",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                        transition: "color 150ms ease-out",
                      }}
                    >
                      {step.number}
                    </span>
                    <span
                      style={{
                        color: hoveredStep === i ? "#34D399" : "#646B75",
                        transition: "color 150ms ease-out",
                      }}
                    >
                      {step.icon}
                    </span>
                  </div>

                  {/* Hairline separator */}
                  <div
                    className="mb-4 h-px w-full"
                    style={{ backgroundColor: "#262A31" }}
                  />

                  {/* Title */}
                  <h3
                    className="font-semibold mb-2 leading-snug"
                    style={{
                      fontSize: "1.0625rem",
                      color: "#F4F5F7",
                      fontFamily:
                        "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
                    }}
                  >
                    {step.title}
                  </h3>

                  {/* Description */}
                  <p
                    className="text-sm leading-relaxed"
                    style={{
                      color: "#9AA1AC",
                      fontFamily:
                        "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
                      lineHeight: "1.65",
                    }}
                  >
                    {step.description}
                  </p>

                  {/* Bottom accent line on hover */}
                  <div
                    className="mt-4 h-px w-full transition-all duration-150"
                    style={{
                      backgroundColor:
                        hoveredStep === i
                          ? "rgba(52,211,153,0.4)"
                          : "transparent",
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Faint grid label row */}
          <div
            className="mt-8 flex items-center gap-4"
            style={{
              fontFamily:
                "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
            }}
          >
            <span
              className="h-px flex-1"
              style={{ backgroundColor: "#262A31" }}
            />
            <span className="text-xs" style={{ color: "#646B75" }}>
              fin del proceso · resultados en menos de 2 min
            </span>
            <span
              className="h-px flex-1"
              style={{ backgroundColor: "#262A31" }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
