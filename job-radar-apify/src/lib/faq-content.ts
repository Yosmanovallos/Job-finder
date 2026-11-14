import { SOURCES_BY_COUNTRY } from "../countries/index.js";

// FAQ text shared by Faq.tsx and the server HTML of /preguntas
// (adsense-readiness TX-1), so the raw HTML carries every answer.

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
export function buildFaqItems(country: string) {
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
