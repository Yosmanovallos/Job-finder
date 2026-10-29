# Enlazar cada vacante con su hub de ciudad

Fecha: 2026-10-29, base `origin/main` e1841fe, rama `codex/jobposting-coverage`.
Fase de mayor peso tras la revisión de Search Console: el HTML inicial de las
vacantes no tenía enlaces internos (0) y 9.745 URLs están rastreadas sin indexar.

Entrega: ruta de navegación + BreadcrumbList + hasta 6 vacantes hermanas del
mismo hub, en SSR y en React, sin consulta extra en la respuesta.
Fuera de alcance: hubs de rol, contenido de hubs, enlaces externos, diseño.
Reporte: ../../../docs/SEO-JOB-LINK-GRAPH-2026-10-29.md.
