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
        borderTop: "1px solid #e6e8e4",
        borderBottom: "1px solid #e6e8e4"
      }}
    >
      {/* Sources Strip */}
      <div
        style={{
          borderBottom: "1px solid #e6e8e4",
          background: "#ffffff"
        }}
      >
        <div className="mx-auto px-4 md:px-8 lg:px-16" style={{ maxWidth: "1200px" }}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 py-5">
            {/* Label */}
            <span
              className="shrink-0 text-xs uppercase tracking-widest"
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                color: "#9a9d98",
                letterSpacing: "0.12em"
              }}
            >
              Conectado a
            </span>

            {/* Divider line — desktop only */}
            <div
              className="hidden sm:block shrink-0 w-px self-stretch"
              style={{ background: "#e6e8e4" }}
            />

            {/* Chips row — continuously scrolling marquee, paused on hover
                and frozen for prefers-reduced-motion via the .marquee-track
                CSS rule (see index.css). The list is duplicated once so the
                loop point is invisible. */}
            <div className="relative flex-1 min-w-0 overflow-hidden">
              {/* Left gradient mask */}
              <div
                className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 z-10 hidden sm:block"
                style={{
                  background: "linear-gradient(to right, #ffffff, transparent)"
                }}
              />
              {/* Right gradient mask */}
              <div
                className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 z-10"
                style={{
                  background: "linear-gradient(to left, #ffffff, transparent)"
                }}
              />

              <div className="marquee-track flex flex-row gap-2 w-max">
                {[...sources, ...sources].map((source, i) => (
                  <span
                    key={`${source}-${i}`}
                    className="shrink-0 inline-flex items-center px-3 py-1 text-xs whitespace-nowrap transition-colors duration-150"
                    style={{
                      fontFamily:
                        "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                      color: "#5b5f5c",
                      background: "#f1f2f0",
                      border: "1px solid #e6e8e4",
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
              color: "#9a9d98",
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
              color: "#0e0f10",
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
                background: "#ffffff",
                border: "1px solid #e6e8e4",
                borderRadius: "12px"
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.background = "#f1f2f0";
                el.style.borderColor = "#d3d6cf";
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLDivElement;
                el.style.background = "#ffffff";
                el.style.borderColor = "#e6e8e4";
              }}
            >
              {/* Grid line accent — top-left corner decoration */}
              <div
                className="absolute top-0 left-0 w-6 h-6 pointer-events-none"
                style={{
                  borderTop: "1px solid #0f6b4c",
                  borderLeft: "1px solid #0f6b4c",
                  borderTopLeftRadius: "12px",
                  opacity: 0.35
                }}
              />

              {/* Step index — mono label */}
              <span
                className="text-xs"
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                  color: "#9a9d98",
                  fontSize: "0.8125rem"
                }}
              >
                {String(index + 1).padStart(2, "0")}
              </span>

              {/* Icon */}
              <div
                className="flex items-center justify-center w-10 h-10 rounded-lg"
                style={{
                  background: "rgba(15,107,76,0.10)",
                  border: "1px solid rgba(15,107,76,0.20)"
                }}
              >
                <Icon weight="duotone" size={20} style={{ color: "#0f6b4c" }} />
              </div>

              {/* Text */}
              <div className="flex flex-col gap-2">
                <h3
                  className="font-heading font-semibold leading-snug"
                  style={{
                    fontSize: "1.125rem",
                    color: "#0e0f10"
                  }}
                >
                  {title}
                </h3>
                <p
                  className="leading-relaxed"
                  style={{
                    fontSize: "0.9375rem",
                    color: "#5b5f5c",
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
