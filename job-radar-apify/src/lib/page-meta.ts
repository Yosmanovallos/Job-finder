// Single source of truth for the <title>, meta description and visible
// <h1> of the client-rendered pages that have no SSR body of their own.
// server.ts injects these into the raw HTML (before this, those routes
// shipped the homepage's title, description and canonical="/" — telling
// Google every one of them was a duplicate of the home), and the React
// pages read the same strings, so raw HTML and the hydrated DOM never
// disagree. No JSX here: it's imported by the server.
//
// Copy rules (docs/SEO-IMPROVEMENT-PLAN.md §0): titles ≤ 60 characters,
// descriptions ≤ 155, only facts the product actually offers today, and no
// live counts in titles (they change daily and Google rewrites churning
// titles). validate-page-meta.test.ts enforces the limits.

export interface RouteMeta {
  title: string;
  description: string;
  // Visible page heading. Omitted for utility pages (sign-in, account)
  // whose heading depends on client state.
  heading?: string;
  // Short intro rendered under the heading in the server HTML.
  introduction?: string;
  noindex?: boolean;
}

const LEGAL: Record<string, { heading: string; description: string }> = {
  "/legal/terminos": {
    heading: "Términos de uso",
    description: "Términos de uso de BuscoTrabajo: qué es el servicio, su costo y la disponibilidad de los datos de vacantes."
  },
  "/legal/privacidad": {
    heading: "Política de privacidad",
    description: "Política de privacidad de BuscoTrabajo: qué datos recolectamos, qué no recolectamos y tus derechos sobre tu información."
  },
  "/legal/uso-aceptable": {
    heading: "Uso aceptable",
    description: "Uso aceptable de BuscoTrabajo: qué está permitido y qué no al usar el servicio de búsqueda de empleo."
  },
  "/legal/cookies": {
    heading: "Política de cookies",
    description: "Política de cookies de BuscoTrabajo: qué cookies usamos y cómo controlarlas desde tu navegador."
  }
};

export const ROUTE_META: Record<string, RouteMeta> = {
  "/como-funciona": {
    title: "Cómo funciona: buscar empleo sin duplicados | BuscoTrabajo",
    description:
      "BuscoTrabajo revisa varios portales de empleo a la vez, une las vacantes repetidas y descarta las vencidas. Te postulas siempre en la oferta original.",
    heading: "Cómo funciona BuscoTrabajo",
    introduction:
      "Escribes el cargo que buscas, BuscoTrabajo consulta varios portales de empleo en paralelo, fusiona las vacantes repetidas, descarta los enlaces caídos y te muestra lo más reciente primero."
  },
  "/preguntas": {
    title: "Preguntas frecuentes sobre buscar empleo | BuscoTrabajo",
    description:
      "Respuestas sobre BuscoTrabajo: de qué portales vienen las vacantes, qué tan recientes son, cómo verificamos que sigan abiertas y si aplicamos por ti.",
    heading: "Preguntas frecuentes sobre BuscoTrabajo",
    introduction:
      "De qué portales vienen las vacantes, qué tan recientes son, cómo sabemos que una oferta sigue abierta, si necesitas cuenta y por qué BuscoTrabajo nunca aplica por ti."
  },
  ...Object.fromEntries(
    Object.entries(LEGAL).map(([path, legal]) => [
      path,
      { title: `${legal.heading} | BuscoTrabajo`, description: legal.description, heading: legal.heading }
    ])
  ),
  "/login": {
    title: "Iniciar sesión | BuscoTrabajo",
    description: "Inicia sesión en BuscoTrabajo para guardar vacantes y marcar a cuáles ya aplicaste.",
    noindex: true
  },
  "/reset-password": {
    title: "Restablecer contraseña | BuscoTrabajo",
    description: "Elige una nueva contraseña para tu cuenta de BuscoTrabajo.",
    noindex: true
  },
  "/auth/callback": {
    title: "Iniciando sesión | BuscoTrabajo",
    description: "Completando el inicio de sesión en BuscoTrabajo.",
    noindex: true
  },
  "/cuenta": {
    title: "Mi cuenta | BuscoTrabajo",
    description: "Tu cuenta de BuscoTrabajo.",
    noindex: true
  }
};

const SOURCE_LIST: Record<string, string> = {
  CO: "LinkedIn, Computrabajo, Elempleo",
  VE: "LinkedIn, Computrabajo, Torre"
};

// /dashboard and /ve/dashboard — shared by server.ts's SSR head and
// Dashboard.tsx so the two can't drift (they used to be a copy-pasted
// string that still advertised the retired 48h paywall).
export function dashboardDescription(country: string, countryName: string): string {
  const sources = SOURCE_LIST[country] ?? SOURCE_LIST.CO;
  return `Explora vacantes de ${sources} y más en ${countryName}. Filtra por ciudad, modalidad y fecha, sin duplicados. Gratis.`;
}

// /empresas and /ve/empresas — same SSR/client sharing; the H1 used to say
// "Empresas en Colombia" in the server HTML and "Explora empresas con
// vacantes activas" once React mounted.
export function companiesDirectoryMeta(countryName: string): { title: string; heading: string; description: string } {
  const heading = `Empresas que están contratando en ${countryName}`;
  return {
    heading,
    title: `${heading} | BuscoTrabajo`,
    description: `Explora empresas con vacantes activas en ${countryName} en BuscoTrabajo — su reputación y ofertas.`
  };
}
