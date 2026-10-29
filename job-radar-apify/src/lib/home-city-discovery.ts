/**
 * Static, public destinations: no counts, database access or extra requests.
 * Cities and roles are the hubs with Search Console impressions (90 days),
 * most impressions first: cities from
 * docs/seo-baseline/2026-10-24-measurement-baseline.md, role hubs from the
 * 2026-10-29 export recorded in openspec/changes/home-role-hubs/proposal.md.
 */
export function getHomeCityDiscovery(country: "CO" | "VE") {
  const countryName = country === "VE" ? "Venezuela" : "Colombia";
  const links = country === "VE"
    ? [
        { label: "Empleos en Caracas", href: "/empleos/caracas" },
        { label: "Empleos en Maracay", href: "/empleos/maracay" },
        { label: "Empleos en Valencia", href: "/empleos/valencia" },
        { label: "Empleos en Maracaibo", href: "/empleos/maracaibo" },
        { label: "Empleos de ingeniero civil en Venezuela", href: "/ve/empleos/ingeniero-civil" },
        { label: "Empleos de analista jurídico en Venezuela", href: "/ve/empleos/analista-juridico" },
        { label: "Empleos de ingeniero ambiental en Venezuela", href: "/ve/empleos/ingeniero-ambiental" },
        { label: "Empleos de analista de logística en Venezuela", href: "/ve/empleos/analista-de-logistica" },
        { label: "Empleos de desarrollador frontend en Venezuela", href: "/ve/empleos/desarrollador-frontend" },
        { label: "Empleos de ingeniero industrial en Venezuela", href: "/ve/empleos/ingeniero-industrial" }
      ]
    : [
        { label: "Empleos en Bogotá", href: "/empleos/bogota" },
        { label: "Empleos en Santa Marta", href: "/empleos/santa-marta" },
        { label: "Empleos en Neiva", href: "/empleos/neiva" },
        { label: "Empleos en Armenia", href: "/empleos/armenia" },
        { label: "Empleos en Ibagué", href: "/empleos/ibague" },
        { label: "Empleos en Valledupar", href: "/empleos/valledupar" },
        { label: "Empleos en Popayán", href: "/empleos/popayan" },
        { label: "Empleos en Villavicencio", href: "/empleos/villavicencio" },
        { label: "Empleos en Palmira", href: "/empleos/palmira" },
        { label: "Empleos en Cúcuta", href: "/empleos/cucuta" },
        { label: "Empleos de ingeniero civil en Colombia", href: "/empleos/ingeniero-civil" },
        { label: "Empleos de analista jurídico en Colombia", href: "/empleos/analista-juridico" },
        { label: "Empleos de ingeniero industrial en Colombia", href: "/empleos/ingeniero-industrial" },
        { label: "Empleos de community manager en Colombia", href: "/empleos/community-manager" },
        { label: "Empleos de analista de logística en Colombia", href: "/empleos/analista-de-logistica" },
        { label: "Empleos de especialista en marketing digital en Colombia", href: "/empleos/especialista-en-marketing-digital" }
      ];
  return {
    heading: `Ciudades y cargos destacados en ${countryName}`,
    description: `Explora ofertas de empleo por ciudad o cargo en ${countryName} y consulta los detalles de cada vacante antes de postularte en su fuente original.`,
    links
  };
}
