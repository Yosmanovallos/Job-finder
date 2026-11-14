// Steps of /como-funciona, shared by ComparisonAndProcess.tsx and the server
// HTML of that route (adsense-readiness TX-1). Kept close to what the product
// does today: no "AI" claim for what is a synonym dictionary.

export const PROCESS_STEPS: ReadonlyArray<{ number: string; title: string; description: string }> = [
  {
    "number": "01",
    "title": "Escribe qué buscas",
    "description": "Un cargo, una palabra clave o el área en la que quieres trabajar. Sin formularios largos."
  },
  {
    "number": "02",
    "title": "Buscamos en varios portales a la vez",
    "description": "Cruzamos sinónimos y variantes del cargo para no dejar publicaciones por fuera, en español o inglés."
  },
  {
    "number": "03",
    "title": "Filtramos lo que no sirve",
    "description": "Duplicados fusionados y enlaces caídos descartados antes de que los veas."
  },
  {
    "number": "04",
    "title": "Resultados listos para aplicar",
    "description": "Ordenados por frescura, con scroll infinito y filtros por ciudad, modalidad y portal."
  }
];
