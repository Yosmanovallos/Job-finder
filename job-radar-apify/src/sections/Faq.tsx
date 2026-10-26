import { useLocation } from "react-router-dom";
import { SOURCES_BY_COUNTRY } from "../countries/index.js";
import { getEffectiveCountry } from "../lib/country-context.js";
import { ROUTE_META } from "../lib/page-meta.js";
import { TINTS } from "../lib/brand-tints.js";
import { ContentCta, ContentSection, PageHero } from "../components/ContentPage.js";

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
  const meta = ROUTE_META["/preguntas"]!;

  // <details>, not a JS accordion: every answer is in the DOM (crawlers and
  // in-page search see them all) and opening one needs no React state.
  return (
    <div id="preguntas" className="bg-white">
      <PageHero eyebrow="Preguntas frecuentes" heading={meta.heading!}>
        <p>{meta.introduction}</p>
      </PageHero>
      <ContentSection>
        <div className="sr-stagger max-w-[880px] flex flex-col gap-3 md:gap-4">
          {faqItems.map((item, index) => {
            const tint = TINTS[index % TINTS.length]!;
            return (
              <details key={item.id} open={index === 0} className="sr group ink-card-sm rounded-2xl bg-white open:bg-[var(--faq-tint)]" style={{ ["--faq-tint" as string]: tint.bg }}>
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none px-5 md:px-6 py-4 md:py-5 min-h-[56px] [&::-webkit-details-marker]:hidden">
                  <h2 className="font-heading font-bold text-[17px] md:text-xl leading-snug">{item.question}</h2>
                  <span aria-hidden="true" className="shrink-0 w-9 h-9 rounded-full border-2 border-foreground bg-white grid place-items-center font-bold transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="px-5 md:px-6 pb-5 md:pb-6 -mt-1 text-[15px] md:text-base leading-relaxed text-[#3d413e]">{item.answer}</p>
              </details>
            );
          })}
        </div>
      </ContentSection>
      <ContentCta />
    </div>
  );
}
