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
- Los hubs por intención (`/empleos/remoto`, `/sin-experiencia`,
  `/medio-tiempo`, `/fines-de-semana`, `/temporada` y sus versiones por
  ciudad) cuentan solo las vacantes aptas para Google: `intentFilters()` en
  `src/lib/intent-pages.ts` añade `googleReady: true`, y `server.ts` muestra
  ese `total` como «N vacantes encontradas». Por eso `/empleos/remoto`
  mostraba 710 mientras la API daba 2.771 remotas en total. La guía de
  remoto cita las dos cifras y explica la diferencia.
- Las cifras cambian a diario. Al publicar o actualizar una guía se vuelve a
  medir y se cambia la fecha de corte de la fuente.

## Cómo se verificaron las fuentes (para las guías 6–12)

- `www.secretariasenado.gov.co` rechaza la conexión desde este entorno
  (ECONNREFUSED, también con `curl`). Se usa el Gestor Normativo de Función
  Pública, que publica el texto vigente con notas de modificación.
- La herramienta de lectura web falla con el certificado TLS de
  `funcionpublica.gov.co`; `curl` sí funciona. Se descarga
  `norma.php?i=<id>` y se convierte a texto (UTF-8, con respaldo latin1).
- Identificadores `norma.php?i=` usados: Código Sustantivo del Trabajo
  199983 · Ley 2466 de 2025 260676 · Ley 2121 de 2021 167966 · Ley 1221 de
  2008 31431 · Ley 2088 de 2021 162970 · Ley 2191 de 2022 177586 · Ley 2101
  de 2021 166506 · Ley 1780 de 2016 69573 · Ley 1636 de 2013 53493 · Ley
  2043 de 2020 137051 · Ley 2039 de 2020 137230 · Decreto 1072 de 2015 72173.
- El texto del CST en Función Pública no siempre incorpora la reforma de
  2025 (por ejemplo, el art. 46). Para artículos reformados se cita la Ley
  2466 de 2025.
- La API pública limita el ritmo: ante un 429 hay que esperar lo que dice
  `Retry-After` (unos 50 s) y dejar varios segundos entre consultas. Las
  páginas de hub no consumen esa cuota.
