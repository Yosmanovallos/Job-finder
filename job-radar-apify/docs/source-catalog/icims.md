# iCIMS (portales `careers-{x}.icims.com`) — investigación D5

`source-researcher`, 2026-10-20. Leyenda: **[DOC]** / **[OBS]** / **[NV]**. UA `BuscoTrabajoBot/1.0 (+https://buscotrabajo.co)`, 2-4 s entre requests, ~25 requests, sin 429. Fixtures: `fixtures-icims/`.

**Veredicto: técnicamente viable (HTML + JSON-LD), pero DIFERIDO por falta de canario con volumen en Colombia.** El único tenant iCIMS con Colombia hallado (Teleperformance Colombia) tiene **2 vacantes**. No construir hasta que D3 halle al menos una empresa colombiana relevante con portal iCIMS; el parser queda especificado.

## 1. Cumplimiento
- No hay API pública de empleos sin credenciales (las APIs de iCIMS son para clientes autenticados) **[NV: sin documentación pública hallada]**. El portal es la única vía pública.
- robots.txt literal (`careers-teleperformance.icims.com` y `careersco-teleperformance.icims.com`, idénticos) [OBS]: `User-agent: *` / `Sitemap: https://HOST/sitemap.xml` / `Disallow: /jobs/*referral`, `/jobs/referral`, `/jobs/*login`, `/jobs/login`, `/jobs/*candidate`, `/jobs/candidate`, `/jobs/reminder`, `/connect`, `/connect/*interest`, `/connect/interest`, `/connect/*resume`, `/connect/resume`.
- Rutas que usaríamos: `/sitemap.xml`, `/jobs/search?ss=1&in_iframe=1&pr=N`, `/jobs/{id}/{slug}/job`: **permitidas para `*`**. El enlace de postulación (`.../login`) está prohibido: **nunca se pide**; como `applyUrl` se publica la URL `/job`.
- Términos: la Acceptable Use Policy de iCIMS (PDF en francés hallado) prohíbe robots y usuarios sin interfaz gráfica dentro de la suscripción (clientes) **[NV: alcance sobre visitantes de portales no confirmado; texto en inglés no hallado]**. Términos de cada empleador: no revisados.

## 2. Listado completo
| Método | Resultado |
|---|---|
| `GET /sitemap.xml` | Lista `/jobs/{id}/{slug}/job` + `lastmod`. TP-Malasia 56 URLs vs 57 en búsqueda; TP-Colombia 2 = 2. `lastmod` de 2022-2026, no es fecha de publicación. **Sin país.** Contraste de completitud, no fuente única. [OBS] |
| `GET /jobs/search?ss=1&in_iframe=1` | HTML. "Search Results Page 1 of N"; **50 tarjetas por página**; páginas `&pr=0,1,...` (0-based). Tarjeta: `Job Locations` (formato `CO-Colombia`, `CO-Remote (Cloud Campus)`: prefijo alpha-2), título, atributo title con el id, campo País. |
| Filtro país | Por ids internos (`searchLocation=-N-`, no portable). Listar todo y filtrar por prefijo `CO-` y JSON-LD `addressCountry`. [OBS] |
| JSON-LD | Sí, en `/jobs/{id}/{slug}/job`. |

- **Completitud**: todas las páginas `pr=0..N-1` HTTP 200, N leído de "Page x of N", suma de tarjetas = total, ids únicos; contraste con sitemap (tolerancia 1-2). Parsear HTML es lo más frágil: forma inesperada, `error`.

## 3. Campos (JSON-LD, TP Colombia id 7975)
- id: **sin `identifier`**; id = segmento `/jobs/{id}/` (estable). `title`; `description` (HTML); `occupationalCategory`; `employmentType` (`FULL_TIME`); `directApply`.
- País: `jobLocation[].address.addressCountry` = **`CO` (alpha-2)** [OBS]. Ciudad `addressLocality` fue "Colombia" y `streetAddress` "Colombia WAHA" (sin ciudad real, poco fiable); `addressRegion` y `postOfficeBoxNumber` = "UNAVAILABLE" (centinela a ignorar).
- Fecha: `datePosted` `2021-05-07T04:00:00.000Z` (absoluta); `validThrough` `2027-05-07T04:00:00.000Z`. Modalidad: sin campo (solo texto Remote en `Job Locations`), `null` salvo regla textual. Empresa: `hiringOrganization.name`.
- Vacante inexistente: **HTTP 410** (HTML "gone"); tenant inexistente: 404 en sitemap / HTML "gone" en robots, tratar como `not_found`.

## 4. Canarios (2026-10-20)
| Tenant | Colombia |
|---|---|
| `careersco-teleperformance.icims.com` | **2** (id 32931 `CO-Remote (Cloud Campus)`, id 7975 `CO-Colombia`) |
| `careers-teleperformance.icims.com` | 0 (Malasia, ~57) |

~90 slugs `careers-{empresa}` sondeados (ttec, millicom, sodexo, avianca, hilton, DHL...): todos 404 (tenant inexistente) salvo avon (7 URLs, sin Colombia). Una búsqueda mostró una vacante `CO-Bogota` en `social.icims.com` (agregador de iCIMS, **no usar**). **Sin canario con volumen: conector diferido.**

## Fuentes
- https://careersco-teleperformance.icims.com/robots.txt
- AUP (PDF FR): https://icims.com/wp-content/uploads/2025/04/iCIMS-Acceptable-Use-Policy-French.pdf
