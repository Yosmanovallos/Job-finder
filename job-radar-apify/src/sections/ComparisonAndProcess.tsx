import { useState } from "react";

// Process steps data — kept deliberately close to what the product actually
// does today: no "AI" claim for what is really a synonym dictionary
// (ai-role-agent.ts), and no mention of Notion sync, which isn't a
// user-facing step in this flow.
const processSteps = [
  {
    number: "01",
    title: "Escribe qué buscas",
    description:
      "Un cargo, una palabra clave o el área en la que quieres trabajar. Sin formularios largos.",
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
    title: "Buscamos en varios portales a la vez",
    description:
      "Cruzamos sinónimos y variantes del cargo para no dejar publicaciones por fuera, en español o inglés.",
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
    title: "Filtramos lo que no sirve",
    description:
      "Duplicados fusionados y enlaces caídos descartados antes de que los veas.",
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
    title: "Resultados listos para aplicar",
    description:
      "Ordenados por frescura, con scroll infinito y filtros por ciudad, modalidad y portal.",
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

export default function ComparisonAndProcess() {
  const [hoveredStep, setHoveredStep] = useState<number | null>(null);

  return (
    <section
      id="comparison-and-process"
      className="bg-background py-16 md:py-20 px-4 md:px-8 lg:px-16 overflow-x-hidden"
      style={{ backgroundColor: "#fafafa" }}
    >
      <div className="max-w-6xl mx-auto">
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
              style={{ color: "#9a9d98" }}
            >
              proceso
            </span>
            <span
              className="h-px flex-1 max-w-12"
              style={{ backgroundColor: "#e6e8e4" }}
            />
          </div>

          <h2
            className="font-semibold mb-10 leading-tight"
            style={{
              fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
              letterSpacing: "-0.01em",
              color: "#0e0f10",
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
                backgroundColor: "#e6e8e4",
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
                        ? "1px solid #d3d6cf"
                        : "1px solid #e6e8e4",
                    backgroundColor: hoveredStep === i ? "#f1f2f0" : "#ffffff",
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
                        color: hoveredStep === i ? "#0f6b4c" : "#e6e8e4",
                        fontFamily:
                          "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                        transition: "color 150ms ease-out",
                      }}
                    >
                      {step.number}
                    </span>
                    <span
                      style={{
                        color: hoveredStep === i ? "#0f6b4c" : "#9a9d98",
                        transition: "color 150ms ease-out",
                      }}
                    >
                      {step.icon}
                    </span>
                  </div>

                  {/* Hairline separator */}
                  <div
                    className="mb-4 h-px w-full"
                    style={{ backgroundColor: "#e6e8e4" }}
                  />

                  {/* Title */}
                  <h3
                    className="font-semibold mb-2 leading-snug"
                    style={{
                      fontSize: "1.0625rem",
                      color: "#0e0f10",
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
                      color: "#5b5f5c",
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
                          ? "rgba(15,107,76,0.4)"
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
              style={{ backgroundColor: "#e6e8e4" }}
            />
            <span className="text-xs" style={{ color: "#9a9d98" }}>
              fin del proceso · resultados en menos de 2 min
            </span>
            <span
              className="h-px flex-1"
              style={{ backgroundColor: "#e6e8e4" }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
