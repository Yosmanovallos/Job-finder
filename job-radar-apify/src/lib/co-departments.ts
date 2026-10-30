// Colombian municipality -> department, for JobPosting addressRegion when the
// source wrote only the city ("Medellín"). ADR 0009: a closed table, CO only,
// never overriding a source-stated region. Source: DANE DIVIPOLA. Only names
// that are UNIQUE among Colombian municipalities are listed — Armenia,
// Florencia, Rionegro, Barbosa, Mosquera, La Unión, Candelaria, San Andrés…
// exist in more than one department and are deliberately absent (no region
// beats a guessed one).

const DEPARTMENT_MUNICIPALITIES: Record<string, string[]> = {
  "Bogotá, D.C.": ["Bogotá"],
  Amazonas: ["Leticia"],
  Antioquia: ["Medellín", "Bello", "Itagüí", "Envigado", "Sabaneta", "Copacabana", "Girardota", "Apartadó", "Marinilla", "Guarne"],
  Arauca: ["Arauca"],
  Atlántico: ["Barranquilla", "Soledad", "Malambo", "Puerto Colombia", "Galapa"],
  Bolívar: ["Cartagena", "Cartagena de Indias", "Magangué", "Turbaco", "Arjona"],
  Boyacá: ["Tunja", "Duitama", "Sogamoso", "Chiquinquirá"],
  Caldas: ["Manizales", "Villamaría", "Chinchiná", "La Dorada"],
  Casanare: ["Yopal", "Aguazul"],
  Cauca: ["Popayán", "Santander de Quilichao"],
  Cesar: ["Valledupar", "Aguachica"],
  Chocó: ["Quibdó"],
  Córdoba: ["Montería", "Cereté", "Lorica", "Sahagún"],
  Cundinamarca: ["Soacha", "Chía", "Zipaquirá", "Facatativá", "Fusagasugá", "Girardot", "Madrid", "Funza", "Cajicá", "Tocancipá", "Cota", "Sopó"],
  Guainía: ["Inírida"],
  Guaviare: ["San José del Guaviare"],
  Huila: ["Neiva", "Pitalito", "Garzón"],
  "La Guajira": ["Riohacha", "Maicao"],
  Magdalena: ["Santa Marta", "Ciénaga"],
  Meta: ["Villavicencio", "Acacías"],
  Nariño: ["Pasto", "Ipiales", "Tumaco"],
  "Norte de Santander": ["Cúcuta", "San José de Cúcuta", "Ocaña", "Pamplona", "Villa del Rosario", "Los Patios"],
  Putumayo: ["Mocoa"],
  Quindío: ["Calarcá"],
  Risaralda: ["Pereira", "Dosquebradas", "Santa Rosa de Cabal"],
  Santander: ["Bucaramanga", "Floridablanca", "Girón", "Piedecuesta", "Barrancabermeja", "San Gil"],
  Sucre: ["Sincelejo", "Corozal"],
  Tolima: ["Ibagué", "Espinal", "El Espinal", "Melgar", "Honda"],
  "Valle del Cauca": ["Cali", "Santiago de Cali", "Palmira", "Buenaventura", "Tuluá", "Jamundí", "Yumbo", "Cartago", "Buga"],
  Vaupés: ["Mitú"],
  Vichada: ["Puerto Carreño"]
};

function normalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(metropolitan area|area metropolitana( de)?)\b/g, " ")
    .replace(/\bd\.?\s?c\.?$/, " ")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MUNICIPALITY_TO_DEPARTMENT = new Map<string, string>(
  Object.entries(DEPARTMENT_MUNICIPALITIES).flatMap(([department, municipalities]) =>
    municipalities.map((municipality): [string, string] => [normalize(municipality), department])
  )
);

/** The department of a uniquely-named Colombian municipality, else null. */
export function coDepartmentFor(locality: string): string | null {
  return MUNICIPALITY_TO_DEPARTMENT.get(normalize(locality)) ?? null;
}
