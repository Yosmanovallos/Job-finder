# F3 — Datos propios del corpus usados en las guías 1–5

Medidos el 2026-11-14 entre las 20:30 y las 20:40 hora de Colombia
(2026-11-15 01:30–01:40 UTC). Solo lectura, con fuentes públicas: la API
`https://buscotrabajo.co/api/v1/jobs` (campo `pagination.total`, con pausas
para respetar `Retry-After`) y el HTML de los hubs (campo `total` de
`window.__SSR_CATEGORY__`, que es la cifra que muestra la página). Sin
consultas a la base de datos de producción.

| Consulta | Total | Guía |
|---|---:|---|
| `/api/v1/jobs?country=CO` | 33.437 | Trabajo remoto |
| `/api/v1/jobs?country=CO&modality=remoto` | 2.771 | Trabajo remoto |
| `…&modality=remoto&freshness=7d` | 795 | Trabajo remoto |
| `…&modality=remoto&cities=Bogotá` | 772 | Trabajo remoto |
| `…&modality=remoto&cities=Medellín` | 120 | Trabajo remoto |
| `…&modality=remoto&cities=Cali` | 41 | Trabajo remoto |
| `…&search=aprendiz` | 655 | Agencia Pública de Empleo |
| `…&search=practicante` | 655 (mismo grupo de cargos) | Agencia Pública de Empleo |
| `…&search=aprendiz&cities=Bogotá` | 253 | Agencia Pública de Empleo |
| `/empleos/sin-experiencia` | 277 | Sin experiencia |
| `/empleos/bogota/sin-experiencia` | 71 | Sin experiencia |
| `/empleos/medellin/sin-experiencia` | 36 | Sin experiencia |
| `/empleos/cali/sin-experiencia` | 22 | Sin experiencia |
| `/empleos/medio-tiempo` | 39 | Medio tiempo y fines de semana |
| `/empleos/fines-de-semana` | 33 | Medio tiempo y fines de semana |
| `/empleos/temporada` | 279 | Trabajo de temporada |

Notas:

- La primera medición de remotas (01:30 UTC) dio 2.772; la segunda, 2.771.
  La guía usa la segunda. Bogotá y Medellín salen de la primera tanda.
- `search=` busca en el título, la empresa y la ubicación, con agrupación de
  cargos equivalentes («aprendiz» y «practicante» devuelven lo mismo). Por
  eso las guías dicen «una búsqueda de aprendiz devolvía», no «vacantes que
  mencionan aprendiz en su texto».
- El hub `/empleos/remoto` mostraba 710 en ese momento: cuenta otra cosa
  (vacantes aptas para la página), así que la guía de remoto usa la API y no
  cita esa cifra.
- Las cifras cambian a diario. Al publicar o actualizar una guía se vuelve a
  medir y se cambia la fecha de corte de la fuente.
