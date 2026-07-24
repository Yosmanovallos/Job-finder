import { useState } from "react";

// ─── Data ───────────────────────────────────────────────────────────────────

const faqItems = [
  {
    id: "faq-1",
    question: "¿De qué portales trae las vacantes?",
    answer:
      "Job Radar consulta más de 10 fuentes en paralelo: LinkedIn Jobs, Computrabajo, Elempleo, Magneto, Torre, GetOnBoard, RemoteOK, Remotive, Workana y WeRemoto. La lista crece con cada actualización del producto.",
  },
  {
    id: "faq-2",
    question: "¿Qué tan recientes son los resultados?",
    answer:
      "Puedes filtrar por las últimas 24 horas, 48 horas, 7 días o 30 días. El motor consulta las fuentes de forma continua, así que los resultados reflejan lo publicado en las horas más recientes.",
  },
  {
    id: "faq-3",
    question: "¿Cómo sabe que una oferta sigue abierta?",
    answer:
      "Antes de mostrarte una vacante, Job Radar verifica que el enlace original siga activo y que la publicación no haya sido marcada como cerrada. Las ofertas caducadas se etiquetan o se descartan automáticamente.",
  },
  {
    id: "faq-4",
    question: "¿Necesito una cuenta de Notion?",
    answer:
      "No es obligatorio. El dashboard web funciona de forma independiente. Si quieres sincronizar resultados con Notion, conectas tu cuenta en los ajustes y Job Radar crea la base de datos por ti.",
  },
  {
    id: "faq-5",
    question: "¿Job Radar aplica a los empleos por mí?",
    answer:
      "No. Job Radar encuentra, ordena y verifica las vacantes. La decisión de postularte y el envío de cada aplicación siguen siendo completamente tuyos.",
  },
  {
    id: "faq-6",
    question: "¿Funciona para roles que no son de tecnología?",
    answer:
      "Sí. El motor de búsqueda está diseñado para cualquier perfil profesional: salud, educación, logística, diseño, administración y más. Escribe el rol como lo conoces y la IA genera las variantes relevantes.",
  },
];

const pricingPlans = [
  {
    id: "gratis",
    name: "Gratis",
    price: "$0",
    period: "",
    features: [
      "3 búsquedas al día",
      "1 rol guardado",
      "Rango de hasta 7 días",
      "Dashboard web",
    ],
    cta: "Empezar gratis",
    ctaVariant: "outline" as const,
    popular: false,
  },
  {
    id: "pro",
    name: "Pro",
    price: "$9",
    period: "USD/mes",
    features: [
      "Búsquedas ilimitadas",
      "10 roles guardados",
      "Rango de 24 h",
      "Alertas diarias por correo",
      "Sincronización con Notion",
      "Historial de 90 días",
    ],
    cta: "Probar 7 días gratis",
    ctaVariant: "solid" as const,
    popular: true,
  },
  {
    id: "equipos",
    name: "Equipos",
    price: "$29",
    period: "USD/mes",
    features: [
      "Todo lo de Pro",
      "5 usuarios",
      "Fuentes personalizadas",
      "Exportación a CSV",
      "Acceso a la API",
      "Soporte prioritario",
    ],
    cta: "Hablar con nosotros",
    ctaVariant: "outline" as const,
    popular: false,
  },
];

const transparencyBlocks = [
  {
    id: "t1",
    label: "01 / FUENTES",
    title: "Fuentes públicas y conectores oficiales",
    body: "Job Radar lee ofertas publicadas de forma pública y se conecta a los sistemas de reclutamiento que ofrecen acceso oficial. Revisa con más frecuencia de la que podría una persona.",
  },
  {
    id: "t2",
    label: "02 / AUTONOMÍA",
    title: "Nunca aplicamos por ti",
    body: "Job Radar encuentra, ordena y verifica. La decisión y el envío de cada postulación siguen siendo tuyos.",
  },
  {
    id: "t3",
    label: "03 / ATRIBUCIÓN",
    title: "Atribución siempre visible",
    body: "Cada vacante muestra su portal de origen y enlaza a la publicación original. Sin intermediarios ocultos.",
  },
];

const mockJobCards = [
  {
    id: "j1",
    age: "hace 2 h",
    verified: true,
    title: "Analista de Datos Senior",
    company: "Bancolombia",
    location: "Medellín, Colombia",
    salary: "$4.500.000 – $6.000.000",
    mode: "Híbrido",
    contract: "Indefinido",
    source: "LinkedIn",
    also: "Computrabajo, Magneto",
  },
  {
    id: "j2",
    age: "hace 5 h",
    verified: true,
    title: "Diseñadora UX / UI",
    company: "Rappi",
    location: "Bogotá · Remoto",
    salary: "$5.000.000 – $7.500.000",
    mode: "Remoto",
    contract: "Indefinido",
    source: "Torre",
    also: "GetOnBoard",
  },
  {
    id: "j3",
    age: "hace 11 h",
    verified: false,
    title: "Coordinador de Logística",
    company: "Grupo Éxito",
    location: "Cali, Colombia",
    salary: "$3.200.000 – $4.000.000",
    mode: "Presencial",
    contract: "Término fijo",
    source: "Elempleo",
    also: "Computrabajo",
  },
  {
    id: "j4",
    age: "hace 18 h",
    verified: true,
    title: "Desarrollador Backend Node.js",
    company: "Platzi",
    location: "Remoto · LatAm",
    salary: "$6.000.000 – $9.000.000",
    mode: "Remoto",
    contract: "Indefinido",
    source: "RemoteOK",
    also: "Remotive, WeRemoto",
  },
];

// ─── Sub-components ──────────────────────────────────────────────────────────

function MonoLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-xs font-mono tracking-widest uppercase"
      style={{ color: "#646B75" }}
    >
      {children}
    </span>
  );
}

function VerifiedBadge({ active }: { active: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono"
      style={{
        background: active ? "rgba(52,211,153,0.10)" : "rgba(248,113,113,0.10)",
        color: active ? "#34D399" : "#F87171",
        border: `1px solid ${active ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)"}`,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: active ? "#34D399" : "#F87171" }}
      />
      {active ? "Verificada" : "Reverificando"}
    </span>
  );
}

function JobCard({ card }: { card: (typeof mockJobCards)[0] }) {
  return (
    <div
      className="rounded-xl p-4 transition-all duration-150 cursor-default"
      style={{
        background: "#131519",
        border: "1px solid #262A31",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "#1B1E24";
        (e.currentTarget as HTMLDivElement).style.borderColor = "#3A404A";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "#131519";
        (e.currentTarget as HTMLDivElement).style.borderColor = "#262A31";
      }}
    >
      {/* Top row */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span
          className="text-xs font-mono px-2 py-0.5 rounded"
          style={{
            background: "#1B1E24",
            color: "#9AA1AC",
            border: "1px solid #262A31",
          }}
        >
          {card.age}
        </span>
        <VerifiedBadge active={card.verified} />
        <button
          className="ml-auto p-1 rounded transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2"
          style={{ color: "#646B75" }}
          aria-label="Descartar vacante"
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.color = "#9AA1AC")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.color = "#646B75")
          }
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path d="M2 2l10 10M12 2L2 12" />
          </svg>
        </button>
      </div>

      {/* Title */}
      <p
        className="font-semibold text-base mb-1 leading-snug"
        style={{ color: "#F4F5F7" }}
      >
        {card.title}
      </p>

      {/* Company line */}
      <div
        className="flex items-center gap-2 text-sm mb-2"
        style={{ color: "#9AA1AC" }}
      >
        <span
          className="w-5 h-5 rounded flex items-center justify-center text-xs font-semibold flex-shrink-0"
          style={{ background: "#1B1E24", color: "#34D399" }}
        >
          {card.company[0]}
        </span>
        <span>{card.company}</span>
        <span style={{ color: "#646B75" }}>·</span>
        <span>{card.location}</span>
      </div>

      {/* Metadata */}
      <p className="text-xs font-mono mb-3" style={{ color: "#646B75" }}>
        {card.salary} · {card.mode} · {card.contract}
      </p>

      {/* Source chips */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span
          className="text-xs font-mono px-2 py-0.5 rounded-full"
          style={{
            background: "rgba(52,211,153,0.10)",
            color: "#34D399",
            border: "1px solid rgba(52,211,153,0.20)",
          }}
        >
          {card.source}
        </span>
        <span className="text-xs" style={{ color: "#646B75" }}>
          también en:{" "}
          <span className="font-mono" style={{ color: "#9AA1AC" }}>
            {card.also}
          </span>
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          className="px-3 py-1.5 rounded text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 min-h-[36px]"
          style={{
            border: "1px solid #262A31",
            color: "#9AA1AC",
            background: "transparent",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              "#3A404A";
            (e.currentTarget as HTMLButtonElement).style.color = "#F4F5F7";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              "#262A31";
            (e.currentTarget as HTMLButtonElement).style.color = "#9AA1AC";
          }}
        >
          Guardar
        </button>
        <button
          className="px-3 py-1.5 rounded text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 min-h-[36px]"
          style={{
            border: "1px solid #262A31",
            color: "#9AA1AC",
            background: "transparent",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              "#3A404A";
            (e.currentTarget as HTMLButtonElement).style.color = "#F4F5F7";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor =
              "#262A31";
            (e.currentTarget as HTMLButtonElement).style.color = "#9AA1AC";
          }}
        >
          Marcar aplicada
        </button>
        <a
          href="#hero-demo"
          className="ml-auto text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2"
          style={{ color: "#34D399" }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLAnchorElement).style.color = "#6EE7B7")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLAnchorElement).style.color = "#34D399")
          }
        >
          Aplicar →
        </a>
      </div>
    </div>
  );
}

function FaqItem({
  item,
  isOpen,
  onToggle,
}: {
  item: (typeof faqItems)[0];
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="rounded-xl overflow-hidden transition-all duration-150"
      style={{
        border: `1px solid ${isOpen ? "#3A404A" : "#262A31"}`,
        background: isOpen ? "#1B1E24" : "#131519",
      }}
    >
      <button
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 min-h-[56px]"
        aria-expanded={isOpen}
        onClick={onToggle}
        style={{ color: "#F4F5F7" }}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background =
            "rgba(255,255,255,0.02)")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background =
            "transparent")
        }
      >
        <span className="font-semibold text-sm md:text-base leading-snug">
          {item.question}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="flex-shrink-0 transition-transform duration-150"
          style={{
            color: "#9AA1AC",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          <path d="M3 6l5 5 5-5" />
        </svg>
      </button>
      {isOpen && (
        <div className="px-5 pb-5">
          <p className="text-sm leading-relaxed" style={{ color: "#9AA1AC" }}>
            {item.answer}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function ProductFeaturesPricingFaq() {
  const [openFaq, setOpenFaq] = useState<string>("faq-3");

  const handleFaqToggle = (id: string) => {
    setOpenFaq((prev) => (prev === id ? "" : id));
  };

  return (
    <section
      id="product-features-pricing-faq"
      style={{ background: "#0A0B0D" }}
      className="overflow-x-hidden"
    >
      {/* ── FEATURES BENTO GRID ─────────────────────────────────────── */}
      <div
        className="w-full py-16 md:py-20"
        style={{ borderBottom: "1px solid #262A31" }}
      >
        <div className="max-w-[1200px] mx-auto px-4 md:px-8">
          {/* Section label */}
          <div className="mb-8 md:mb-12">
            <MonoLabel>07 / FUNCIONALIDADES</MonoLabel>
            <h2
              className="mt-3 font-semibold tracking-tight leading-tight"
              style={{
                fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
                color: "#F4F5F7",
              }}
            >
              Herramientas que trabajan mientras tú descansas
            </h2>
          </div>

          {/* Bento grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* A — Large: Filtro temporal real (col-span-7) */}
            <div
              className="lg:col-span-7 rounded-xl p-6 transition-all duration-150"
              style={{
                background: "#131519",
                border: "1px solid #262A31",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background =
                  "#1B1E24";
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  "#3A404A";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background =
                  "#131519";
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  "#262A31";
              }}
            >
              <MonoLabel>A / FILTRO</MonoLabel>
              <h3
                className="mt-2 mb-1 font-semibold text-lg"
                style={{ color: "#F4F5F7" }}
              >
                Filtro temporal real
              </h3>
              <p className="text-sm mb-5" style={{ color: "#9AA1AC" }}>
                Elige el rango de tiempo y solo verás vacantes publicadas dentro
                de ese período. Sin resultados de semanas atrás mezclados.
              </p>
              {/* Mini UI */}
              <div
                className="rounded-lg p-4"
                style={{ background: "#0A0B0D", border: "1px solid #262A31" }}
              >
                <div className="flex flex-wrap gap-2 mb-4">
                  {["24 horas", "48 horas", "7 días", "30 días"].map(
                    (chip, i) => (
                      <span
                        key={chip}
                        className="px-3 py-1.5 rounded-full text-xs font-mono transition-colors duration-150"
                        style={
                          i === 0
                            ? {
                                background: "rgba(52,211,153,0.10)",
                                color: "#34D399",
                                border: "1px solid rgba(52,211,153,0.30)",
                              }
                            : {
                                background: "#1B1E24",
                                color: "#9AA1AC",
                                border: "1px solid #262A31",
                              }
                        }
                      >
                        {chip}
                      </span>
                    ),
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span
                    className="text-xs font-mono"
                    style={{ color: "#646B75" }}
                  >
                    Resultados encontrados
                  </span>
                  <span
                    className="text-2xl font-mono font-semibold"
                    style={{ color: "#34D399" }}
                  >
                    127
                  </span>
                </div>
                <div
                  className="mt-2 h-1.5 rounded-full overflow-hidden"
                  style={{ background: "#1B1E24" }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{ width: "72%", background: "#34D399" }}
                  />
                </div>
                <p
                  className="text-xs font-mono mt-1"
                  style={{ color: "#646B75" }}
                >
                  vacantes en las últimas 24 h
                </p>
              </div>
            </div>

            {/* B — Deduplicación (col-span-5) */}
            <div
              className="lg:col-span-5 rounded-xl p-6 transition-all duration-150"
              style={{
                background: "#131519",
                border: "1px solid #262A31",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background =
                  "#1B1E24";
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  "#3A404A";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background =
                  "#131519";
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  "#262A31";
              }}
            >
              <MonoLabel>B / DEDUP</MonoLabel>
              <h3
                className="mt-2 mb-1 font-semibold text-lg"
                style={{ color: "#F4F5F7" }}
              >
                Deduplicación entre portales
              </h3>
              <p className="text-sm mb-5" style={{ color: "#9AA1AC" }}>
                La misma vacante publicada en tres portales aparece una sola
                vez, con todas las fuentes listadas.
              </p>
              {/* Mini UI: merge animation */}
              <div className="space-y-2">
                {["LinkedIn", "Computrabajo", "Magneto"].map((src, i) => (
                  <div
                    key={src}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg"
                    style={{
                      background: "#0A0B0D",
                      border: "1px solid #262A31",
                      opacity: i === 0 ? 1 : 0.6,
                    }}
                  >
                    <span
                      className="w-5 h-5 rounded flex items-center justify-center text-xs font-semibold flex-shrink-0"
                      style={{ background: "#1B1E24", color: "#34D399" }}
                    >
                      {src[0]}
                    </span>
                    <span
                      className="text-xs font-mono"
                      style={{ color: "#9AA1AC" }}
                    >
                      {src}
                    </span>
                    {i > 0 && (
                      <span
                        className="ml-auto text-xs font-mono"
                        style={{ color: "#646B75" }}
                      >
                        duplicado
                      </span>
                    )}
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-1">
                  <div
                    className="flex-1 h-px"
                    style={{ background: "#262A31" }}
                  />
                  <span
                    className="text-xs font-mono"
                    style={{ color: "#34D399" }}
                  >
                    → 1 resultado
                  </span>
                  <div
                    className="flex-1 h-px"
                    style={{ background: "#262A31" }}
                  />
                </div>
              </div>
            </div>

            {/* Row 2: three col-span-4 cards */}
            {/* C — Verificación de vigencia */}
            <div
              className="lg:col-span-4 rounded-xl p-6 transition-all duration-150"
              style={{
                background: "#131519",
                border: "1px solid #262A31",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background =
                  "#1B1E24";
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  "#3A404A";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background =
                  "#131519";
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  "#262A31";
              }}
            >
              <MonoLabel>C / VIGENCIA</MonoLabel>
              <h3
                className="mt-2 mb-1 font-semibold text-lg"
                style={{ color: "#F4F5F7" }}
              >
                Verificación de vigencia
              </h3>
              <p className="text-sm mb-4" style={{ color: "#9AA1AC" }}>
                Cada enlace se comprueba antes de mostrarte la vacante.
              </p>
              <div className="space-y-2">
                {[
                  {
                    label: "Activa",
                    color: "#34D399",
                    bg: "rgba(52,211,153,0.10)",
                  },
                  {
                    label: "Reverificando",
                    color: "#F5A524",
                    bg: "rgba(245,165,36,0.10)",
                  },
                  {
                    label: "Cerrada",
                    color: "#F87171",
                    bg: "rgba(248,113,113,0.10)",
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg"
                    style={{
                      background: s.bg,
                      border: `1px solid ${s.color}22`,
                    }}
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: s.color }}
                    />
                    <span
                      className="text-xs font-mono font-medium"
                      style={{ color: s.color }}
                    >
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* D — Sincronización con Notion */}
            <div
              className="lg:col-span-4 rounded-xl p-6 transition-all duration-150"
              style={{
                background: "#131519",
                border: "1px solid #262A31",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background =
                  "#1B1E24";
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  "#3A404A";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background =
                  "#131519";
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  "#262A31";
              }}
            >
              <MonoLabel>D / NOTION</MonoLabel>
              <h3
                className="mt-2 mb-1 font-semibold text-lg"
                style={{ color: "#F4F5F7" }}
              >
                Sincronización con Notion
              </h3>
              <p className="text-sm mb-4" style={{ color: "#9AA1AC" }}>
                Tus resultados llegan directo a tu base de datos de Notion.
              </p>
              {/* Mini table */}
              <div
                className="rounded-lg overflow-hidden"
                style={{ border: "1px solid #262A31" }}
              >
                <div
                  className="grid grid-cols-4 px-3 py-1.5"
                  style={{
                    background: "#1B1E24",
                    borderBottom: "1px solid #262A31",
                  }}
                >
                  {["Cargo", "Empresa", "Fuente", "Fecha"].map((h) => (
                    <span
                      key={h}
                      className="text-xs font-mono"
                      style={{ color: "#646B75" }}
                    >
                      {h}
                    </span>
                  ))}
                </div>
                {[
                  ["Analista", "Bancolombia", "LinkedIn", "hoy"],
                  ["Diseñadora", "Rappi", "Torre", "hoy"],
                  ["Dev Backend", "Platzi", "RemoteOK", "ayer"],
                ].map((row, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-4 px-3 py-2"
                    style={{
                      borderBottom: i < 2 ? "1px solid #262A31" : "none",
                    }}
                  >
                    {row.map((cell, j) => (
                      <span
                        key={j}
                        className="text-xs font-mono truncate"
                        style={{ color: "#9AA1AC" }}
                      >
                        {cell}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* E — Búsquedas guardadas */}
            <div
              className="lg:col-span-4 rounded-xl p-6 transition-all duration-150"
              style={{
                background: "#131519",
                border: "1px solid #262A31",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background =
                  "#1B1E24";
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  "#3A404A";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background =
                  "#131519";
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  "#262A31";
              }}
            >
              <MonoLabel>E / ALERTAS</MonoLabel>
              <h3
                className="mt-2 mb-1 font-semibold text-lg"
                style={{ color: "#F4F5F7" }}
              >
                Búsquedas guardadas
              </h3>
              <p className="text-sm mb-4" style={{ color: "#9AA1AC" }}>
                Guarda tus roles y recibe alertas cuando aparezcan nuevas
                vacantes.
              </p>
              <div className="space-y-3">
                {[
                  {
                    name: "Analista de datos",
                    count: "12 nuevas",
                    active: true,
                  },
                  {
                    name: "UX Designer remoto",
                    count: "4 nuevas",
                    active: false,
                  },
                ].map((s) => (
                  <div
                    key={s.name}
                    className="flex items-center justify-between gap-3 px-3 py-3 rounded-lg"
                    style={{
                      background: "#0A0B0D",
                      border: "1px solid #262A31",
                    }}
                  >
                    <div>
                      <p
                        className="text-xs font-medium"
                        style={{ color: "#F4F5F7" }}
                      >
                        {s.name}
                      </p>
                      <p
                        className="text-xs font-mono mt-0.5"
                        style={{ color: "#34D399" }}
                      >
                        {s.count}
                      </p>
                    </div>
                    {/* Toggle */}
                    <div
                      className="w-9 h-5 rounded-full flex items-center px-0.5 flex-shrink-0"
                      style={{
                        background: s.active
                          ? "rgba(52,211,153,0.30)"
                          : "#1B1E24",
                        border: `1px solid ${s.active ? "#34D399" : "#262A31"}`,
                      }}
                    >
                      <div
                        className="w-4 h-4 rounded-full transition-transform duration-150"
                        style={{
                          background: s.active ? "#34D399" : "#646B75",
                          transform: s.active
                            ? "translateX(16px)"
                            : "translateX(0)",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── PRODUCT VIEW / DASHBOARD ─────────────────────────────────── */}
      <div
        className="w-full py-16 md:py-20"
        style={{ borderBottom: "1px solid #262A31" }}
      >
        <div className="max-w-[1200px] mx-auto px-4 md:px-8">
          <div className="mb-8 md:mb-12">
            <MonoLabel>08 / DASHBOARD</MonoLabel>
            <h2
              className="mt-3 font-semibold tracking-tight leading-tight"
              style={{
                fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
                color: "#F4F5F7",
              }}
            >
              Todo en una sola pantalla
            </h2>
            <p className="mt-3 text-base max-w-xl" style={{ color: "#9AA1AC" }}>
              Un dashboard limpio donde cada vacante ya llegó verificada,
              deduplicada y ordenada por frescura.
            </p>
          </div>

          {/* Dashboard panel */}
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: "#131519",
              border: "1px solid #262A31",
            }}
          >
            {/* Window bar */}
            <div
              className="flex items-center gap-3 px-4 py-3"
              style={{
                background: "#1B1E24",
                borderBottom: "1px solid #262A31",
              }}
            >
              <div className="flex gap-1.5">
                {["#F87171", "#F5A524", "#34D399"].map((c) => (
                  <div
                    key={c}
                    className="w-3 h-3 rounded-full"
                    style={{ background: c }}
                  />
                ))}
              </div>
              <div
                className="flex-1 max-w-xs mx-auto rounded px-3 py-1 text-xs font-mono text-center"
                style={{
                  background: "#0A0B0D",
                  color: "#646B75",
                  border: "1px solid #262A31",
                }}
              >
                app.jobradar.co/dashboard
              </div>
            </div>

            {/* Dashboard content */}
            <div className="p-4 md:p-6">
              {/* Search bar */}
              <div className="flex gap-3 mb-4 flex-col sm:flex-row">
                <div
                  className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg"
                  style={{
                    background: "#0A0B0D",
                    border: "1px solid #262A31",
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    style={{ color: "#646B75", flexShrink: 0 }}
                  >
                    <circle cx="6" cy="6" r="4" />
                    <path d="M9.5 9.5l2.5 2.5" />
                  </svg>
                  <span
                    className="text-sm font-mono"
                    style={{ color: "#646B75" }}
                  >
                    analista de datos · 24 h
                  </span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {["Remoto", "Bogotá", "Medellín"].map((f) => (
                    <span
                      key={f}
                      className="px-3 py-2 rounded-lg text-xs font-mono"
                      style={{
                        background: "#1B1E24",
                        color: "#9AA1AC",
                        border: "1px solid #262A31",
                      }}
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </div>

              {/* Stats row */}
              <div className="flex gap-4 mb-5 flex-wrap">
                <span
                  className="text-xs font-mono"
                  style={{ color: "#646B75" }}
                >
                  <span style={{ color: "#34D399" }}>127</span> vacantes ·{" "}
                  <span style={{ color: "#34D399" }}>98%</span> verificadas ·{" "}
                  <span style={{ color: "#9AA1AC" }}>43</span> duplicados
                  eliminados
                </span>
              </div>

              {/* Job cards grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {mockJobCards.map((card) => (
                  <JobCard key={card.id} card={card} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── TRANSPARENCY ─────────────────────────────────────────────── */}
      <div
        className="w-full py-16 md:py-20"
        style={{
          background: "#131519",
          borderTop: "1px solid #262A31",
          borderBottom: "1px solid #262A31",
        }}
      >
        <div className="max-w-[1200px] mx-auto px-4 md:px-8">
          <div className="mb-8 md:mb-12">
            <MonoLabel>09 / TRANSPARENCIA</MonoLabel>
            <h2
              className="mt-3 font-semibold tracking-tight leading-tight"
              style={{
                fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
                color: "#F4F5F7",
              }}
            >
              Cómo obtenemos los datos
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {transparencyBlocks.map((block) => (
              <div
                key={block.id}
                className="rounded-xl p-6"
                style={{
                  background: "#0A0B0D",
                  border: "1px solid #262A31",
                }}
              >
                <MonoLabel>{block.label}</MonoLabel>
                <h3
                  className="mt-3 mb-2 font-semibold text-base"
                  style={{ color: "#F4F5F7" }}
                >
                  {block.title}
                </h3>
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: "#9AA1AC" }}
                >
                  {block.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── PRICING ──────────────────────────────────────────────────── */}
      <div
        id="precios"
        className="w-full py-16 md:py-20"
        style={{ borderBottom: "1px solid #262A31" }}
      >
        <div className="max-w-[1200px] mx-auto px-4 md:px-8">
          <div className="mb-8 md:mb-12 text-center">
            <MonoLabel>10 / PRECIOS</MonoLabel>
            <h2
              className="mt-3 font-semibold tracking-tight leading-tight"
              style={{
                fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
                color: "#F4F5F7",
              }}
            >
              Elige tu plan
            </h2>
            <p className="mt-3 text-base" style={{ color: "#9AA1AC" }}>
              Sin tarjeta para empezar. Cancela cuando quieras.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
            {pricingPlans.map((plan) => (
              <div
                key={plan.id}
                className="relative rounded-xl p-6 flex flex-col transition-all duration-150"
                style={{
                  background: plan.popular ? "#131519" : "#131519",
                  border: plan.popular
                    ? "2px solid #34D399"
                    : "1px solid #262A31",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background =
                    "#1B1E24";
                  if (!plan.popular)
                    (e.currentTarget as HTMLDivElement).style.borderColor =
                      "#3A404A";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background =
                    "#131519";
                  if (!plan.popular)
                    (e.currentTarget as HTMLDivElement).style.borderColor =
                      "#262A31";
                }}
              >
                {/* Popular badge */}
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span
                      className="px-3 py-1 rounded-full text-xs font-mono font-semibold"
                      style={{
                        background: "#34D399",
                        color: "#0A0B0D",
                      }}
                    >
                      Más popular
                    </span>
                  </div>
                )}

                {/* Plan name */}
                <div className="mb-4">
                  <MonoLabel>{plan.name.toUpperCase()}</MonoLabel>
                  <div className="flex items-end gap-1 mt-2">
                    <span
                      className="text-4xl font-semibold font-mono"
                      style={{ color: "#F4F5F7" }}
                    >
                      {plan.price}
                    </span>
                    {plan.period && (
                      <span
                        className="text-sm font-mono mb-1"
                        style={{ color: "#646B75" }}
                      >
                        {plan.period}
                      </span>
                    )}
                  </div>
                </div>

                {/* Divider */}
                <div className="h-px mb-4" style={{ background: "#262A31" }} />

                {/* Features */}
                <ul className="space-y-2.5 mb-6 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        className="mt-0.5 flex-shrink-0"
                        style={{ color: "#34D399" }}
                      >
                        <path d="M2 7l3.5 3.5L12 3" />
                      </svg>
                      <span className="text-sm" style={{ color: "#9AA1AC" }}>
                        {f}
                      </span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <div className="mt-auto">
                  <button
                    className="w-full py-3 px-4 rounded-lg text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 min-h-[48px]"
                    style={
                      plan.ctaVariant === "solid"
                        ? {
                            background: "#34D399",
                            color: "#0A0B0D",
                            border: "none",
                          }
                        : {
                            background: "transparent",
                            color: "#F4F5F7",
                            border: "1px solid #3A404A",
                          }
                    }
                    onMouseEnter={(e) => {
                      if (plan.ctaVariant === "solid") {
                        (
                          e.currentTarget as HTMLButtonElement
                        ).style.background = "#6EE7B7";
                      } else {
                        (
                          e.currentTarget as HTMLButtonElement
                        ).style.borderColor = "#9AA1AC";
                        (
                          e.currentTarget as HTMLButtonElement
                        ).style.background = "rgba(255,255,255,0.04)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (plan.ctaVariant === "solid") {
                        (
                          e.currentTarget as HTMLButtonElement
                        ).style.background = "#34D399";
                      } else {
                        (
                          e.currentTarget as HTMLButtonElement
                        ).style.borderColor = "#3A404A";
                        (
                          e.currentTarget as HTMLButtonElement
                        ).style.background = "transparent";
                      }
                    }}
                  >
                    {plan.cta}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <p
            className="text-center text-xs font-mono mt-6"
            style={{ color: "#646B75" }}
          >
            Sin tarjeta para empezar. Cancela cuando quieras.
          </p>
        </div>
      </div>

      {/* ── FAQ ──────────────────────────────────────────────────────── */}
      <div id="preguntas" className="w-full py-16 md:py-20">
        <div className="max-w-[1200px] mx-auto px-4 md:px-8">
          <div className="mb-8 md:mb-12">
            <MonoLabel>11 / PREGUNTAS</MonoLabel>
            <h2
              className="mt-3 font-semibold tracking-tight leading-tight"
              style={{
                fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
                color: "#F4F5F7",
              }}
            >
              Preguntas frecuentes
            </h2>
          </div>

          <div className="max-w-3xl space-y-3">
            {faqItems.map((item) => (
              <FaqItem
                key={item.id}
                item={item}
                isOpen={openFaq === item.id}
                onToggle={() => handleFaqToggle(item.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
