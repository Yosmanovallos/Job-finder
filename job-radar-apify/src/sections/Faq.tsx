import { useState } from "react";
import { useLocation } from "react-router-dom";
import { MonoLabel } from "../components/MonoLabel.js";
import { SOURCES_BY_COUNTRY } from "../countries/index.js";
import { getEffectiveCountry } from "../lib/country-context.js";

// Every item except faq-1 is country-neutral (how the product works, not
// what it's connected to).
const faqItemsRest = [
  {
    id: "faq-2",
    question: "¿Funciona para roles que no son de tecnología?",
    answer:
      "Sí. Está pensado para cualquier perfil profesional: salud, educación, logística, diseño, administración y más. Escribe el cargo como lo conoces, en español o inglés — el buscador reconoce sinónimos y variantes comunes del mismo puesto."
  },
  {
    id: "faq-3",
    question: "¿Qué tan recientes son los resultados?",
    answer:
      "Puedes filtrar por las últimas 24 horas, 48 horas o última semana. El motor consulta las fuentes de forma continua, así que los resultados reflejan lo publicado en las horas más recientes."
  },
  {
    id: "faq-4",
    question: "¿Cómo sabe que una oferta sigue abierta?",
    answer:
      "Antes de mostrarte una vacante, BuscoTrabajo verifica que el enlace original siga activo y que la publicación no haya sido marcada como cerrada. Las ofertas caducadas se etiquetan o se descartan automáticamente."
  },
  {
    id: "faq-5",
    question: "¿Necesito crear una cuenta para usarlo?",
    answer:
      "Puedes explorar el dashboard sin cuenta. Para guardar vacantes o marcarlas como aplicadas necesitas registrarte — así también nos cuentas qué puestos te interesan, para mostrártelos primero."
  },
  {
    id: "faq-6",
    question: "¿BuscoTrabajo aplica a los empleos por mí?",
    answer:
      "No. BuscoTrabajo encuentra, ordena y verifica las vacantes. La decisión de postularte y el envío de cada aplicación siguen siendo completamente tuyos."
  }
];

// faq-1's answer is the one item that names actual sources — built from
// SOURCES_BY_COUNTRY (same list SourcesAndProblem.tsx's marquee and
// buildCategoryMeta use) instead of its own hardcoded string. This
// component previously named Elempleo/Magneto/Workana unconditionally,
// which overclaimed sources that have no Venezuela adapter whenever this
// rendered inside /ve's landing page (see ProductFeaturesPricingFaq.tsx).
function buildFaqItems(country: string) {
  const sources = (SOURCES_BY_COUNTRY[country] || SOURCES_BY_COUNTRY.CO).join(", ");
  return [
    {
      id: "faq-1",
      question: "¿De qué portales trae las vacantes?",
      answer: `BuscoTrabajo consulta varias fuentes en paralelo: ${sources}. La lista crece con cada actualización del producto.`
    },
    ...faqItemsRest
  ];
}

function FaqItem({
  item,
  isOpen,
  onToggle
}: {
  item: ReturnType<typeof buildFaqItems>[0];
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="rounded-xl overflow-hidden transition-all duration-150"
      style={{
        border: `1px solid ${isOpen ? "#d3d6cf" : "#e6e8e4"}`,
        background: isOpen ? "#f1f2f0" : "#ffffff"
      }}
    >
      <button
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 min-h-[56px]"
        aria-expanded={isOpen}
        onClick={onToggle}
        style={{ color: "#0e0f10" }}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background = "rgba(14,15,16,0.03)")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background = "transparent")
        }
      >
        <span className="font-semibold text-sm md:text-base leading-snug">{item.question}</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="flex-shrink-0 transition-transform duration-150"
          style={{
            color: "#5b5f5c",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)"
          }}
        >
          <path d="M3 6l5 5 5-5" />
        </svg>
      </button>
      {isOpen && (
        <div className="px-5 pb-5">
          <p className="text-sm leading-relaxed" style={{ color: "#5b5f5c" }}>
            {item.answer}
          </p>
        </div>
      )}
    </div>
  );
}

export interface FaqProps {
  // Optional: callers that already know their country (e.g.
  // ProductFeaturesPricingFaq, itself given `country` by Landing) pass it
  // explicitly. Standalone use (the /preguntas route) has no such caller,
  // so it falls back to getEffectiveCountry — same pattern Header.tsx uses
  // for pages with no /ve prefix of their own.
  country?: string;
}

export default function Faq({ country }: FaqProps) {
  const location = useLocation();
  const effectiveCountry = country || getEffectiveCountry(location.pathname);
  const faqItems = buildFaqItems(effectiveCountry);

  const [openFaq, setOpenFaq] = useState<string>("faq-1");

  const handleFaqToggle = (id: string) => {
    setOpenFaq((prev) => (prev === id ? "" : id));
  };

  return (
    <div id="preguntas" className="w-full py-16 md:py-20">
      <div className="max-w-[1200px] mx-auto px-4 md:px-8">
        <div className="mb-8 md:mb-12">
          <MonoLabel>11 / PREGUNTAS</MonoLabel>
          <h2
            className="mt-3 font-semibold tracking-tight leading-tight"
            style={{
              fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
              color: "#0e0f10"
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
  );
}
