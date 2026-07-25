import { Browsers, Copy, LinkBreak } from "@phosphor-icons/react";

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
  "WeRemoto"
];

const problems = [
  {
    icon: Browsers,
    title: "Diez pestañas abiertas",
    description:
      "Cada portal tiene su propio buscador, sus propios filtros y su propia forma de mentir sobre la fecha de publicación."
  },
  {
    icon: Copy,
    title: "La misma vacante cuatro veces",
    description:
      "Los portales se copian entre sí. Aplicas dos veces al mismo puesto sin saberlo, perdiendo tiempo y credibilidad."
  },
  {
    icon: LinkBreak,
    title: "Ofertas que ya no existen",
    description:
      "Publicaciones cerradas hace semanas que siguen apareciendo como si estuvieran abiertas. Descubres el error al hacer clic."
  }
];

export default function SourcesAndProblem() {
  return (
    <section
      id="fuentes"
      className="bg-muted"
      style={{
        borderTop: "1px solid #262A31",
        borderBottom: "1px solid #262A31"
      }}
    >
      {/* Sources Strip */}
      <div
        style={{
          borderBottom: "1px solid #262A31",
          background: "#131519"
        }}
      >
        <div className="mx-auto px-4 md:px-8 lg:px-16" style={{ maxWidth: "1200px" }}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 py-5">
            {/* Label */}
            <span
              className="shrink-0 text-xs uppercase tracking-widest"
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                color: "#646B75",
                letterSpacing: "0.12em"
              }}
            >
              Conectado a
            </span>

            {/* Divider line — desktop only */}
            <div
              className="hidden sm:block shrink-0 w-px self-stretch"
              style={{ background: "#262A31" }}
            />

            {/* Chips row — horizontal scroll on mobile, no page overflow */}
            <div className="relative flex-1 min-w-0">
              {/* Left gradient mask */}
              <div
                className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 z-10 hidden sm:block"
                style={{
                  background: "linear-gradient(to right, #131519, transparent)"
                }}
              />
              {/* Right gradient mask */}
              <div
                className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 z-10"
                style={{
                  background: "linear-gradient(to left, #131519, transparent)"
                }}
              />

              <div
                className="flex flex-row gap-2 overflow-x-auto"
                style={{
                  scrollbarWidth: "none",
                  msOverflowStyle: "none",
                  WebkitOverflowScrolling: "touch",
                  paddingBottom: "2px"
                }}
              >
                {sources.map((source) => (
                  <span
                    key={source}
                    className="shrink-0 inline-flex items-center px-3 py-1 text-xs whitespace-nowrap transition-colors duration-150"
                    style={{
                      fontFamily:
                        "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                      color: "#9AA1AC",
                      background: "#1B1E24",
                      border: "1px solid #262A31",
                      borderRadius: "999px",
                      fontSize: "0.8125rem"
                    }}
                  >
                    {source}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Problem Section */}
      <div className="mx-auto px-4 md:px-8 lg:px-16 py-16 md:py-20" style={{ maxWidth: "1200px" }}>
        {/* Section heading block */}
        <div className="mb-10 md:mb-12">
          <span
            className="inline-block mb-4 text-xs uppercase tracking-widest"
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
              color: "#646B75",
              letterSpacing: "0.12em"
            }}
          >
            El problema
          </span>
          <h2
            className="font-heading font-semibold leading-tight"
            style={{
              fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
              letterSpacing: "-0.01em",
              color: "#F4F5F7",
              maxWidth: "640px"
            }}
          >
            Buscar empleo hoy es un trabajo de tiempo completo
          </h2>
        </div>

        {/* Problem cards grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          {problems.map(({ icon: Icon, title, description }, index) => (
            <div
              key={title}
              className="group relative flex flex-col gap-4 p-6 transition-all duration-150 cursor-default"
              style={{
                background: "#131519",
                border: "1px solid #262A31",
                borderRadius: "12px"
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.background = "#1B1E24";
                el.style.borderColor = "#3A404A";
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.background = "#131519";
                el.style.borderColor = "#262A31";
              }}
            >
              {/* Grid line accent — top-left corner decoration */}
              <div
                className="absolute top-0 left-0 w-6 h-6 pointer-events-none"
                style={{
                  borderTop: "1px solid #34D399",
                  borderLeft: "1px solid #34D399",
                  borderTopLeftRadius: "12px",
                  opacity: 0.35
                }}
              />

              {/* Step index — mono label */}
              <span
                className="text-xs"
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                  color: "#646B75",
                  fontSize: "0.8125rem"
                }}
              >
                {String(index + 1).padStart(2, "0")}
              </span>

              {/* Icon */}
              <div
                className="flex items-center justify-center w-10 h-10 rounded-lg"
                style={{
                  background: "rgba(52,211,153,0.10)",
                  border: "1px solid rgba(52,211,153,0.20)"
                }}
              >
                <Icon weight="duotone" size={20} style={{ color: "#34D399" }} />
              </div>

              {/* Text */}
              <div className="flex flex-col gap-2">
                <h3
                  className="font-heading font-semibold leading-snug"
                  style={{
                    fontSize: "1.125rem",
                    color: "#F4F5F7"
                  }}
                >
                  {title}
                </h3>
                <p
                  className="leading-relaxed"
                  style={{
                    fontSize: "0.9375rem",
                    color: "#9AA1AC",
                    lineHeight: "1.65"
                  }}
                >
                  {description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
