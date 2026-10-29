/**
 * Static, public destinations: no counts, database access or extra requests.
 * Cities are the hubs with Search Console impressions (90 days,
 * docs/seo-baseline/2026-10-24-measurement-baseline.md), most impressions
 * first after each country's main hub. That baseline does not itemize role
 * hubs, so no role link is added here without evidence; city hubs link their
 * own most requested roles instead (job-seo.ts buildTopRoles).
 */
export function getHomeCityDiscovery(country: "CO" | "VE") {
  const countryName = country === "VE" ? "Venezuela" : "Colombia";
  const links = country === "VE"
    ? [
        { label: "Empleos en Caracas", href: "/empleos/caracas" },
        { label: "Empleos en Maracay", href: "/empleos/maracay" },
        { label: "Empleos en Valencia", href: "/empleos/valencia" },
        { label: "Empleos de ingeniero civil en Venezuela", href: "/ve/empleos/ingeniero-civil" }
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
        { label: "Empleos en Cúcuta", href: "/empleos/cucuta" }
      ];
  return {
    heading: country === "VE" ? `Ciudades y cargos destacados en ${countryName}` : `Ciudades destacadas en ${countryName}`,
    description: `Explora ofertas de empleo por ${country === "VE" ? "ciudad o cargo" : "ciudad"} en ${countryName} y consulta los detalles de cada vacante antes de postularte en su fuente original.`,
    links
  };
}
