# Requisitos — tipo de empleo fiable por fuente

IDs ETT-xxx, cada uno con prueba en
`tests/validate-employment-type-trust.test.ts` (offline).

- **ETT-001:** la ingesta conserva el valor crudo de la fuente.
  - Escenario: el JSON-LD sintético de Magneto con `PART_TIME` sigue dando
    `employmentType = "Medio tiempo"` en `extractJobPostingDetail`.
- **ETT-002:** una vacante de fuente `Magneto` (o `Elempleo`, ETT-007) no emite `employmentType` en
  el JobPosting, no muestra «Tipo de empleo» en la ficha y no lo pone en la
  meta description ni en el payload de la página.
  - Escenario: Magneto + «Medio tiempo» → JobPosting sin `employmentType`,
    pero la página sigue siendo apta (JobPosting no nulo).
- **ETT-003:** se omite todo valor de Magneto: «Tiempo completo»,
  «Temporal», «Por día», «Prácticas».
- **ETT-007:** lo mismo para `Elempleo`: «Por día», «Temporal» y «Tiempo
  completo» no se emiten ni se muestran.
- **ETT-004:** fuera de `employmentType`, el JobPosting de Magneto es
  idéntico al de la misma vacante en otra fuente.
- **ETT-005:** las demás fuentes conservan exactamente lo que publicaron.
  - Escenario: Computrabajo «Tiempo completo» → `FULL_TIME`; LinkedIn y
    Torre «Medio tiempo» → `PART_TIME`; la ficha muestra «Tipo de empleo:
    Tiempo completo».
- **ETT-006:** la API pública aplica la misma regla (Magneto → `null`).
