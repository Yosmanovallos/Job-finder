# Requisitos — páginas de intención

IDs SIP-xxx. Cada uno tiene al menos un escenario y una prueba en
`tests/validate-intent-pages.test.ts` (unitario) o en `test:seo` (render).

## Resolución y rutas

- **SIP-001:** `/empleos/remoto` y `/empleos/sin-experiencia` resuelven como
  intención de Colombia. `/ve/empleos/remoto` y `/ve/empleos/sin-experiencia`
  resuelven como intención de Venezuela.
  - Escenario: `GET /ve/empleos/remoto` → 200, canonical
    `https://buscotrabajo.co/ve/empleos/remoto` y **0 vacantes con
    `country = CO`** en el HTML ni en el payload.
- **SIP-002:** `/empleos/bogota/sin-experiencia` resuelve como ciudad ×
  intención (Bogotá, CO).
  - Escenario: canonical propio; todas las vacantes listadas son de Bogotá y
    pasan el clasificador.
- **SIP-003:** cualquier otro `/empleos/<ciudad>/<x>` conserva el
  comportamiento actual: hub de la ciudad con canonical al hub.
  - Escenario: `/empleos/bogota/abc` → canonical `/empleos/bogota`.
- **SIP-004:** el filtro «remoto» usa el clasificador de modalidad del PR
  #104 y excluye «Freelance · proyecto remoto».
  - Escenario: una vacante de Workana no aparece en `/empleos/remoto`.

## Clasificador sin experiencia

- **SIP-010:** cuentan solo las frases explícitas de la lista del design
  D3, en el título o en la descripción, por palabra completa y sin tildes.
  - Escenarios positivos: «Asesor comercial sin experiencia», «No se
    requiere experiencia», «con o sin experiencia».
  - Escenarios negativos: «Aprendiz SENA», «Junior developer», «Experiencia
    mínima de 1 año», y un título «sin experiencia en Python» cuya
    descripción pide «3 años de experiencia» (aplica la regla de exclusión
    de D3).
- **SIP-011:** la clasificación de servidor (SQL) y la de cliente (memoria)
  dan el mismo resultado sobre el fixture compartido.

## Guarda

- **SIP-020:** con ≥ 10 vacantes aptas la página es indexable:
  `index,follow`, aparece en `sitemap-categories.xml` y recibe enlaces
  internos.
- **SIP-021:** con < 10 vacantes la página es `noindex,follow`, no está en
  el sitemap y ninguna página la enlaza. Sigue respondiendo 200.
- **SIP-022:** nunca se listan vacantes de otra categoría para rellenar.

## Contenido

- **SIP-030:** title, H1 y meta siguen el design D4. El conteo del título es
  el `total` real de la consulta.
- **SIP-031:** el bloque de respuesta (vacantes, ciudades, empresas) aparece
  en el HTML del servidor y es idéntico tras la hidratación.
  - Escenario: el `html_hash` del bloque coincide entre el SSR y el render
    de React.
- **SIP-032:** no se muestran cifras de salario salvo con ≥ 10 vacantes con
  salario publicado.
- **SIP-033:** el JSON-LD de las páginas de intención es `ItemList` +
  `BreadcrumbList`, igual que los hubs. Nunca `JobPosting` agregado.

## Hreflang

- **SIP-040:** las páginas de intención nacionales emiten hreflang recíproco
  `es-CO`/`es-VE` solo si las dos son indexables. Si no, ninguna emite.
- **SIP-041:** las páginas ciudad × intención no emiten hreflang.

## No regresión

- **SIP-050:** las páginas de vacante, los hubs de ciudad y rol, el dashboard
  y la portada no cambian en title, meta, canonical, robots ni JSON-LD. El
  hash de JMT-001 no cambia, salvo por las entradas nuevas documentadas.
- **SIP-051:** TTFB MISS de los hubs y del dashboard ≤ +10 % frente a la
  base del runbook. Una página de intención tiene un MISS dentro del rango
  de un hub.
- **SIP-052:** benchmark del bloque y del filtro con 3.000 filas: menos de
  10 ms por petición y RSS estable tras 500 peticiones.
