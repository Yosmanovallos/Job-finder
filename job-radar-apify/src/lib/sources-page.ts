import { SOURCES_BY_COUNTRY } from "../countries/index.js";

export const SOURCES_PAGE_PATH = "/fuentes";
export const SOURCES_PAGE_TITLE = "Fuentes de vacantes: Elempleo y más | BuscoTrabajo";
export const SOURCES_PAGE_DESCRIPTION =
  "Conoce las fuentes de vacantes que rastrea BuscoTrabajo en Colombia, cómo atribuimos cada oferta y dónde se completa la postulación.";
export const SOURCES_PAGE_HEADING = "Fuentes de vacantes de empleo que rastrea BuscoTrabajo";
export const SOURCES_PAGE_INTRO =
  "BuscoTrabajo reúne vacantes públicas de distintos portales para que puedas compararlas en un solo lugar, identificar publicaciones repetidas y visitar la oferta original antes de postularte.";

export const SOURCES_PAGE_DISCLOSURES = [
  "Cada vacante conserva el nombre de la fuente donde fue encontrada y un enlace a la publicación original cuando está disponible.",
  "La postulación se completa en el portal o sitio de origen. BuscoTrabajo no envía solicitudes de empleo automáticamente.",
  "La mención de Elempleo, LinkedIn Jobs, Computrabajo u otro portal describe la procedencia de las vacantes y no implica afiliación, alianza, patrocinio ni respaldo comercial."
] as const;

export const SOURCES_PAGE_LINKS = [
  { href: "/dashboard", label: "Explorar vacantes" },
  { href: "/como-funciona", label: "Cómo verificamos y deduplicamos" },
  { href: "/empresas", label: "Ver empresas con vacantes activas" }
] as const;

export function getSourcesPageSources(country = "CO"): readonly string[] {
  return SOURCES_BY_COUNTRY[country] || SOURCES_BY_COUNTRY.CO;
}

function sourceDirectorySlug(source: string): string {
  return source
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// These paths are historical/misclassified source pages, not employer
// profiles. Consolidating them into /fuentes preserves any existing search
// signal without publishing thin doorway pages or implying a relationship
// with the named portals.
export const SOURCE_DIRECTORY_SLUGS = new Set(SOURCES_BY_COUNTRY.CO.map(sourceDirectorySlug));
