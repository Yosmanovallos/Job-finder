/** Static, public destinations: no counts, database access or extra requests. */
export function getHomeCityDiscovery(country: "CO" | "VE") {
  const countryName = country === "VE" ? "Venezuela" : "Colombia";
  const links = country === "VE"
    ? [{ label: "Empleos en Caracas", href: "/empleos/caracas" }]
    : [
        { label: "Empleos en Bogotá", href: "/empleos/bogota" },
        { label: "Empleos en Cúcuta", href: "/empleos/cucuta" }
      ];
  return {
    heading: `Ciudades destacadas en ${countryName}`,
    description: `Explora ofertas de empleo por ciudad en ${countryName} y consulta los detalles de cada vacante antes de postularte en su fuente original.`,
    links
  };
}
