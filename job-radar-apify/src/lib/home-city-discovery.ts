/** Static, public destinations: no counts, database access or extra requests. */
export function getHomeCityDiscovery(country: "CO" | "VE") {
  const countryName = country === "VE" ? "Venezuela" : "Colombia";
  const links = country === "VE"
    ? [
        { label: "Empleos en Caracas", href: "/empleos/caracas" },
        { label: "Empleos de ingeniero civil en Venezuela", href: "/ve/empleos/ingeniero-civil" }
      ]
    : [
        { label: "Empleos en Bogotá", href: "/empleos/bogota" },
        { label: "Empleos en Cúcuta", href: "/empleos/cucuta" },
        { label: "Empleos en Armenia", href: "/empleos/armenia" },
        { label: "Empleos en Neiva", href: "/empleos/neiva" },
        { label: "Empleos en Ibagué", href: "/empleos/ibague" },
        { label: "Empleos en Popayán", href: "/empleos/popayan" }
      ];
  return {
    heading: country === "VE" ? `Ciudades y cargos destacados en ${countryName}` : `Ciudades destacadas en ${countryName}`,
    description: `Explora ofertas de empleo por ${country === "VE" ? "ciudad o cargo" : "ciudad"} en ${countryName} y consulta los detalles de cada vacante antes de postularte en su fuente original.`,
    links
  };
}
