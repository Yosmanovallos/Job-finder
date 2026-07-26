import { Link } from "react-router-dom";
import { hoverStyle } from "../lib/hover-style.js";
import { pricingPlans } from "../lib/pricing-plans.js";
import { MonoLabel } from "../components/MonoLabel.js";
import { PAYWALL_ENABLED } from "../config.js";
import { getSourceColor } from "../lib/source-colors.js";
import Faq from "./Faq.js";

// ─── Data ───────────────────────────────────────────────────────────────────

const transparencyBlocks = [
  {
    id: "t1",
    label: "01 / FUENTES",
    title: "Fuentes públicas y conectores oficiales",
    body: "BuscoTrabajo lee ofertas publicadas de forma pública y se conecta a los sistemas de reclutamiento que ofrecen acceso oficial. Revisa con más frecuencia de la que podría una persona."
  },
  {
    id: "t2",
    label: "02 / AUTONOMÍA",
    title: "Nunca aplicamos por ti",
    body: "BuscoTrabajo encuentra, ordena y verifica. La decisión y el envío de cada postulación siguen siendo tuyos."
  },
  {
    id: "t3",
    label: "03 / ATRIBUCIÓN",
    title: "Atribución siempre visible",
    body: "Cada vacante muestra su portal de origen y enlaza a la publicación original. Sin intermediarios ocultos."
  }
];

// Mock preview of the dashboard's own list-row layout (see JobCard.tsx) —
// only fields the product actually captures (title/company/location/
// source/dateText). No salary, contract type or work mode: the scrapers
// don't extract those today, so showing them here would be inventing data
// the real product can't back up.
const mockJobRows = [
  {
    id: "j1",
    dateText: "hace 2 h",
    fresh: true,
    title: "Analista de Datos Senior",
    company: "Bancolombia",
    location: "Medellín, Colombia",
    source: "LinkedIn",
    also: "Computrabajo, Magneto"
  },
  {
    id: "j2",
    dateText: "hace 5 h",
    fresh: true,
    title: "Diseñadora UX / UI",
    company: "Rappi",
    location: "Bogotá · Remoto",
    source: "Torre",
    also: "GetOnBoard"
  },
  {
    id: "j3",
    dateText: "hace 3 días",
    fresh: false,
    title: "Coordinador de Logística",
    company: "Grupo Éxito",
    location: "Cali, Colombia",
    source: "Elempleo",
    also: "Computrabajo"
  }
];

// ─── Sub-components ──────────────────────────────────────────────────────────

function MockJobRow({ row }: { row: (typeof mockJobRows)[0] }) {
  const sourceColor = getSourceColor(row.source);
  return (
    <div
      className="flex items-center gap-3 rounded-xl p-3 sm:p-4 transition-all duration-150 cursor-default"
      style={{ background: "#ffffff", border: "1px solid #e6e8e4" }}
    >
      <div
        className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center font-semibold text-sm"
        style={{ background: "rgba(212,169,58,0.20)", color: "#8a6d1a" }}
      >
        {row.company[0]}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-sm truncate" style={{ color: "#0e0f10" }}>
            {row.title}
          </p>
          {row.fresh && (
            <span
              className="shrink-0 text-[10px] font-mono uppercase tracking-wide"
              style={{ color: "#0f6b4c" }}
            >
              ● nueva
            </span>
          )}
        </div>
        <p className="text-xs truncate" style={{ color: "#5b5f5c" }}>
          🏢 {row.company} · 📍 {row.location}
        </p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span
            className="text-[10px] font-mono px-2 py-0.5 rounded-full font-medium"
            style={{ background: sourceColor.bg, color: sourceColor.text }}
          >
            {row.source}
          </span>
          <span className="text-[10px] font-mono" style={{ color: "#9a9d98" }}>
            también en: {row.also}
          </span>
          <span className="text-[10px] font-mono ml-auto" style={{ color: "#9a9d98" }}>
            {row.dateText}
          </span>
        </div>
      </div>

      <span
        className="shrink-0 hidden sm:inline-flex px-3 py-1.5 rounded-lg text-xs font-mono font-semibold"
        style={{ background: "#0f6b4c", color: "#fafafa" }}
      >
        Ver vacante →
      </span>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function ProductFeaturesPricingFaq() {
  return (
    <section
      id="product-features-pricing-faq"
      style={{ background: "#fafafa" }}
      className="overflow-x-hidden"
    >
      {/* ── PRODUCT VIEW / DASHBOARD ─────────────────────────────────── */}
      <div className="w-full py-16 md:py-20" style={{ borderBottom: "1px solid #e6e8e4" }}>
        <div className="max-w-[1200px] mx-auto px-4 md:px-8">
          <div className="mb-8 md:mb-12">
            <MonoLabel>08 / DASHBOARD</MonoLabel>
            <h2
              className="mt-3 font-semibold tracking-tight leading-tight"
              style={{
                fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
                color: "#0e0f10"
              }}
            >
              Un dashboard que ya hizo el trabajo pesado
            </h2>
            <p className="mt-3 text-base max-w-xl" style={{ color: "#5b5f5c" }}>
              Busca, filtra por ciudad, portal o modalidad, y sigue viendo vacantes nuevas con solo
              bajar la página — nada de duplicados ni enlaces vencidos en el camino.
            </p>
          </div>

          {/* Dashboard panel */}
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: "#ffffff",
              border: "1px solid #e6e8e4"
            }}
          >
            {/* Window bar */}
            <div
              className="flex items-center gap-3 px-4 py-3"
              style={{
                background: "#f1f2f0",
                borderBottom: "1px solid #e6e8e4"
              }}
            >
              <div className="flex gap-1.5">
                {["#dc2626", "#d4a93a", "#0f6b4c"].map((c) => (
                  <div key={c} className="w-3 h-3 rounded-full" style={{ background: c }} />
                ))}
              </div>
              <div
                className="flex-1 max-w-xs mx-auto rounded px-3 py-1 text-xs font-mono text-center"
                style={{
                  background: "#fafafa",
                  color: "#9a9d98",
                  border: "1px solid #e6e8e4"
                }}
              >
                app.buscotrabajo.co/dashboard
              </div>
            </div>

            {/* Dashboard content — mirrors the real layout: search bar on
                top, filter sidebar on the left, list rows on the right. */}
            <div className="p-4 md:p-6">
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg mb-4"
                style={{ background: "#fafafa", border: "1px solid #e6e8e4" }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  style={{ color: "#9a9d98", flexShrink: 0 }}
                >
                  <circle cx="6" cy="6" r="4" />
                  <path d="M9.5 9.5l2.5 2.5" />
                </svg>
                <span className="text-sm font-mono" style={{ color: "#9a9d98" }}>
                  analista de datos...
                </span>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                {/* Sidebar strip */}
                <div
                  className="hidden md:block shrink-0 w-40 rounded-lg p-3"
                  style={{ background: "#fafafa", border: "1px solid #e6e8e4" }}
                >
                  <p
                    className="text-[10px] font-mono uppercase tracking-wide mb-3"
                    style={{ color: "#9a9d98" }}
                  >
                    Filtros
                  </p>
                  {["Fecha", "Modalidad", "Ciudad", "Fuente / Portal", "Rol buscado"].map((f) => (
                    <div key={f} className="flex items-center justify-between mb-2.5">
                      <span className="text-xs" style={{ color: "#5b5f5c" }}>
                        {f}
                      </span>
                      <span style={{ color: "#9a9d98", fontSize: "10px" }}>▾</span>
                    </div>
                  ))}
                </div>

                {/* List rows */}
                <div className="flex-1 min-w-0">
                  <div className="flex gap-4 mb-3 flex-wrap">
                    <span className="text-xs font-mono" style={{ color: "#9a9d98" }}>
                      <span style={{ color: "#0f6b4c" }}>{mockJobRows.length}</span> de{" "}
                      <span style={{ color: "#0f6b4c" }}>4.017</span> vacantes
                    </span>
                  </div>
                  <div className="flex flex-col gap-3">
                    {mockJobRows.map((row) => (
                      <MockJobRow key={row.id} row={row} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── TRANSPARENCY ─────────────────────────────────────────────── */}
      <div
        className="w-full py-16 md:py-20"
        style={{
          background: "#ffffff",
          borderTop: "1px solid #e6e8e4",
          borderBottom: "1px solid #e6e8e4"
        }}
      >
        <div className="max-w-[1200px] mx-auto px-4 md:px-8">
          <div className="mb-8 md:mb-12">
            <MonoLabel>09 / TRANSPARENCIA</MonoLabel>
            <h2
              className="mt-3 font-semibold tracking-tight leading-tight"
              style={{
                fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
                color: "#0e0f10"
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
                  background: "#fafafa",
                  border: "1px solid #e6e8e4"
                }}
              >
                <MonoLabel>{block.label}</MonoLabel>
                <h3 className="mt-3 mb-2 font-semibold text-base" style={{ color: "#0e0f10" }}>
                  {block.title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "#5b5f5c" }}>
                  {block.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── PRICING ──────────────────────────────────────────────────── */}
      {PAYWALL_ENABLED && (
      <div
        id="precios"
        className="w-full py-16 md:py-20"
        style={{ borderBottom: "1px solid #e6e8e4" }}
      >
        <div className="max-w-[1200px] mx-auto px-4 md:px-8">
          <div className="mb-8 md:mb-12 text-center">
            <MonoLabel>10 / PRECIOS</MonoLabel>
            <h2
              className="mt-3 font-semibold tracking-tight leading-tight"
              style={{
                fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
                color: "#0e0f10"
              }}
            >
              Elige tu plan
            </h2>
            <p className="mt-3 text-base" style={{ color: "#5b5f5c" }}>
              Sin tarjeta para empezar.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 max-w-2xl mx-auto gap-6 items-stretch">
            {pricingPlans.map((plan) => (
              <div
                key={plan.id}
                className="relative rounded-xl p-6 flex flex-col transition-all duration-150"
                style={{
                  background: plan.popular ? "#ffffff" : "#ffffff",
                  border: plan.popular ? "2px solid #0f6b4c" : "1px solid #e6e8e4"
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = "#f1f2f0";
                  if (!plan.popular)
                    (e.currentTarget as HTMLDivElement).style.borderColor = "#d3d6cf";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = "#ffffff";
                  if (!plan.popular)
                    (e.currentTarget as HTMLDivElement).style.borderColor = "#e6e8e4";
                }}
              >
                {/* Popular badge */}
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span
                      className="px-3 py-1 rounded-full text-xs font-mono font-semibold"
                      style={{
                        background: "#0f6b4c",
                        color: "#fafafa"
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
                    <span className="text-4xl font-semibold font-mono" style={{ color: "#0e0f10" }}>
                      {plan.price}
                    </span>
                    {plan.period && (
                      <span className="text-sm font-mono mb-1" style={{ color: "#9a9d98" }}>
                        {plan.period}
                      </span>
                    )}
                  </div>
                </div>

                {/* Divider */}
                <div className="h-px mb-4" style={{ background: "#e6e8e4" }} />

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
                        style={{ color: "#0f6b4c" }}
                      >
                        <path d="M2 7l3.5 3.5L12 3" />
                      </svg>
                      <span className="text-sm" style={{ color: "#5b5f5c" }}>
                        {f}
                      </span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <div className="mt-auto">
                  <Link
                    to={plan.to}
                    className="w-full py-3 px-4 rounded-lg text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 min-h-[48px] flex items-center justify-center"
                    style={
                      plan.ctaVariant === "solid"
                        ? {
                            background: "#0f6b4c",
                            color: "#fafafa",
                            border: "none"
                          }
                        : {
                            background: "transparent",
                            color: "#0e0f10",
                            border: "1px solid #d3d6cf"
                          }
                    }
                    onMouseEnter={(e) => {
                      if (plan.ctaVariant === "solid") {
                        (e.currentTarget as HTMLAnchorElement).style.background = "#14805a";
                      } else {
                        (e.currentTarget as HTMLAnchorElement).style.borderColor = "#5b5f5c";
                        (e.currentTarget as HTMLAnchorElement).style.background =
                          "rgba(14,15,16,0.04)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (plan.ctaVariant === "solid") {
                        (e.currentTarget as HTMLAnchorElement).style.background = "#0f6b4c";
                      } else {
                        (e.currentTarget as HTMLAnchorElement).style.borderColor = "#d3d6cf";
                        (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
                      }
                    }}
                  >
                    {plan.cta}
                  </Link>
                </div>
              </div>
            ))}
          </div>

          <p className="text-center text-xs font-mono mt-6" style={{ color: "#9a9d98" }}>
            Pago procesado de forma segura por Wompi.
          </p>
        </div>
      </div>
      )}

      <Faq />
    </section>
  );
}
