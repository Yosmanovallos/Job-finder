import { PRO_MONTHLY_PRICE_COP, formatCOP } from "../config.js";

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
  }
];
