import { PRO_MONTHLY_PRICE_COP, PRO_MAX_MONTHLY_PRICE_COP, formatCOP } from "../config.js";

/**
 * Shared plan copy — used by both the landing page's pricing teaser
 * (ProductFeaturesPricingFaq.tsx) and the real checkout page (Pricing.tsx)
 * so the feature list is never out of sync between the two.
 */
export const pricingPlans = [
  {
    id: "gratis",
    name: "Gratis",
    price: "$0",
    period: "",
    features: [
      "Todas las vacantes con más de 48h de publicadas",
      "Filtros instantáneos por fuente, modalidad y frescura",
      "Guarda vacantes y marca las que ya aplicaste",
      "Sin tarjeta, sin límite de búsquedas"
    ],
    cta: "Empezar gratis",
    ctaVariant: "outline" as const,
    popular: false,
    to: "/dashboard"
  },
  {
    id: "pro",
    name: "Pro",
    price: formatCOP(PRO_MONTHLY_PRICE_COP),
    period: "COP/mes",
    features: [
      "Acceso inmediato desde el minuto 0 (sin esperar 48h)",
      "Todo lo del plan Gratis",
      "Pago seguro con Wompi"
    ],
    cta: "Suscribirme",
    ctaVariant: "solid" as const,
    popular: true,
    to: "/pricing"
  },
  {
    id: "pro_max",
    name: "Pro Max",
    price: formatCOP(PRO_MAX_MONTHLY_PRICE_COP),
    period: "COP/mes",
    // Deliberadamente NO menciona "Premium"/"Comparar" ni el selector de
    // modelo estilo Cursor — esos son de Fase 11 (docs/CV-GENERATION-PLAN.md
    // §10), no existen todavía. Listar una feature que no está construida
    // sería inventar (AGENTS.md regla 5) y le vendería al usuario algo que
    // no puede usar hoy. Con solo esto, Pro Max hoy es 14 créditos vs 3 de
    // Pro al doble del precio — diferenciación real pero débil hasta que
    // Fase 11 dé sentido al precio; anotado tal cual en el plan, no oculto.
    features: [
      "Todo lo del plan Pro",
      "14 generaciones de CV adaptado por mes (vs. 3 de Pro)",
      "Pago seguro con Wompi"
    ],
    cta: "Suscribirme",
    ctaVariant: "outline" as const,
    popular: false,
    to: "/pricing"
  }
];
