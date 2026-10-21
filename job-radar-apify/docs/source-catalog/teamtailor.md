# Teamtailor ({x}.teamtailor.com) - investigacion para conector D5

Investigacion `source-researcher` del 2026-10-20 para `docs/adr/0006-direct-employers.md` §5/§7 (D5).
Leyenda: **[DOC]** documentado oficialmente; **[OBS]** observado, no garantizado; **[NV]** no verificado.
UA usado: `BuscoTrabajoBot/1.0 (+https://buscotrabajo.co)`. Fixtures reales en `fixtures-teamtailor/`.

## Veredicto

**CONECTOR: SI** (feed RSS publico documentado por el proveedor, robots lo permite, hay canarios con muchas
vacantes de Colombia). Salvedades: la ciudad del RSS NO es la ciudad de la vacante (ver 3), el pais viene como
nombre en ingles (no alpha-2) y no hay total en el feed (completitud = paginar hasta pagina corta).

## 1. Cumplimiento

### 1.1 robots.txt (literal, identico en 4 tenants: qualacompany, empleosknaufsouthamerica, connectassistance.na, career)
```
User-Agent: aihitdata
Disallow: /

User-Agent: *
Disallow: /app/
Disallow: /messages/
Disallow: /messenger/
Disallow: /facebook/tab/
Disallow: /jobs/internal/
Content-Signal: search=yes, ai-train=no, ai-input=yes

Sitemap: https://{x}.teamtailor.com/sitemap.xml
```
[OBS]. `/jobs.rss`, `/jobs` y `/jobs/{id}-{slug}` **no** estan bajo Disallow: permitido para BuscoTrabajoBot
(cae en `*`). `Content-Signal` (contentsignals.org): `search=yes` (mostrar vacantes en un buscador es el uso
declarado como permitido), `ai-train=no` (no usar el contenido para entrenar). `www.teamtailor.com/robots.txt`
(sitio de marketing): `Disallow:` vacio para todos. Un tenant inexistente responde 404 HTML tambien en
`/robots.txt` y `/jobs.rss` (RFC 9309: 4xx = sin reglas).

### 1.2 Terminos
- Feed: "all of the data is publicly available" [DOC] (https://support.teamtailor.com/en/articles/11171756-rss-feed-how-to-guide).
  La pagina no impone terminos adicionales; menciona el uso por LinkedIn Job Wrapping.
- Terminos generales https://www.teamtailor.com/en/terms-and-conditions/ [DOC]: ninguna clausula trata scraping,
  crawling ni agregacion de terceros. Las prohibiciones (no monitorear con fines competitivos, no eludir
  limitaciones tecnicas, no copiar material recibido) obligan al **Cliente y sus Usuarios**, no a terceros.
  Seccion 14: la API oficial se ofrece "as-is" y las claves son confidenciales.
- API oficial (`api.teamtailor.com/v1/...`): requiere token del cliente (sin token respondio 406); no usar.
  https://docs.teamtailor.com/ (la pagina cargada no detallaba auth) [NV].
- Terminos de cada empresa/tenant: no revisados.

## 2. Endpoint: RSS publico [DOC]
`GET https://{x}.teamtailor.com/jobs.rss` (dominios propios: `https://jobs.empresa.com/jobs.rss`).
- `Content-Type: application/rss+xml; charset=utf-8`, `cache-control: max-age=5, public`, `etag`, `last-modified` [OBS].
- Paginacion [DOC]: por defecto **primeros 100**; `?offset=N` y `?per_page=N` (ej. `?offset=100&per_page=50`).
  Medido [OBS] en Quala (204 vacantes): con `per_page=100`: offset 0 -> 100 items, offset 100 -> 100, offset 200
  -> 4 (pagina corta = ultima), offset 300 -> 0 items (RSS valido, HTTP 200). 204 `guid` distintos, sin
  repetidos. Sin `per_page` el tope es 100: Quala con 100 items **parece completo pero no lo es** (trampa).
  No se probo si hay un maximo de `per_page` [NV]; usar 100.
- **Completitud**: 200 + XML `rss/channel` valido + paginar con `per_page=100` hasta una pagina con menos de 100
  items (incluida 0). No hay total en el feed. Riesgo [OBS]: el orden es por fecha desc; una publicacion nueva
  durante el paginado desplaza ofertas (duplicado entre paginas, o hueco al despublicar). Mitigar deduplicando
  por `guid`; si aparece un `guid` repetido, repetir el listado una vez; si no cuadra, tratar como no completo.
- Un tablero sin vacantes devuelve canal sin `item` (indistinguible de un listado roto salvo por el titulo del
  canal): aplicar la guardia de caida a 0 / `suspect`.
- Tenants regionales: el host puede llevar region (`connectassistance.na.teamtailor.com`): el `ats_ref`
  contiene un punto. `TOKEN_REF` de `src/direct/connectors.ts` (`^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`) lo acepta,
  pero el conector debe construir `https://{ref}.teamtailor.com`. `jobs.json` no esta documentado y devolvio 404
  (0 bytes) en un tenant desactivado; no se re-probo en uno vivo [NV]: no usarlo.

## 3. Campos del item RSS (fixtures `jobs-*.rss.xml`): lista [DOC], formatos [OBS]
```
item
  title, description (HTML escapado), pubDate (RFC 822 con offset, ej. Mon, 19 Oct 2026 15:43:03 -0500)
  link  https://{x}.teamtailor.com/jobs/{idNumerico}-{slug}
  remoteStatus  none | onsite | hybrid   (remote: no visto, esperable)
  guid  (UUID)
  tt:locations (xmlns:tt="https://teamtailor.com/locations")  0..n  tt:location
        tt:name, tt:address, tt:zip, tt:city, tt:country
  tt:department, tt:role, (division en algunos)
```
| `RawAtsPosting` | Origen | Estado |
|---|---|---|
| externalId | id numerico de `link` (o `guid` UUID) | ver nota |
| title | `title` | OK |
| applyUrl | `link` (pagina de la vacante con el boton de postular) | OK |
| locationTexts | por cada `tt:location`: `city, country` | ver nota ciudad |
| countryCodes | `tt:country` es **nombre en ingles** ("Colombia", "Dominican Republic"); alpha-2 solo en JSON-LD de la pagina (`addressCountry: "CO"`) | tabla nombre->alpha-2 propia |
| structuredCity | `tt:city` | **NO fiable** |
| workplace | `onsite`->onsite, `hybrid`->hybrid, `remote`->remote, **`none`->null** | `none` = no declarado (166 de 204 en Quala) |
| descriptionText | `description` (HTML->texto) | completa en el feed |
| department | `tt:department` | OK |
| employmentType | - | **falta** en RSS (JSON-LD: `employmentType: FULL_TIME`) |
| publishedAt | `pubDate` -> ISO con offset; igual a JSON-LD `datePosted` (2026-10-19T10:50:01-05:00) | [DOC] "Publication date" |
| validThrough | - | **falta** |
| companyName | `channel/title` ("Quala Internacional", "Knauf South America", "Connect") | OK; coincide con `hiringOrganization.name` |

Notas:
- **Ciudad no confiable [OBS]**: `tt:location` es la ubicacion configurada (oficina/entidad), no la ciudad de
  la vacante. En Quala las 70 vacantes con pais Colombia tienen `tt:city` = Bogota (entidad "Quala Colombia"),
  incluso con titulo "Vendedor Integral Autoservicios Medellin". No mapear a `structuredCity` sin esa salvedad;
  el filtro Colombia por **pais** si sirve, pero un filtro por ciudad usando `tt:city` daria falsos.
- Multi-ubicacion: una vacante puede tener varias `tt:location` (Knauf: una con 6 paises). Evaluar por segmento
  (ADR 4). Cero ubicaciones es posible (1 de 204 en Quala) -> sin pais -> no entra.
- ID estable: `guid` es UUID por vacante [OBS]; el id numerico del `link` (8571248) es el mismo de JSON-LD
  (`identifier.value`) y de la URL. Recomendacion: `externalId` = id numerico (permite confirmar cierre por URL
  y coincide con la pagina); guardar `guid` como respaldo. No se verifico si cambian al republicar [NV].
- URL canonica `/jobs/{id}-{slug}`; `/jobs/{id}` solo o slug distinto -> 301 al correcto [OBS]. El slug no es identidad.

## 4. Vacante cerrada / inexistente
- `GET /jobs/1234567-no-existe` -> **404** [OBS]. Vivo -> 200 (o 301 al slug). No se probo una vacante
  realmente cerrada [NV]. Candidato a `canConfirmClosure` (link muerto = cierre inmediato) **solo tras
  verificarlo con una vacante cerrada real**; hasta entonces cerrar por listados completos ausentes (2 seguidos).
  Un tenant inexistente tambien da 404 (distinguir mirando el RSS del tenant).

## 5. Rate limits
No documentados [NV]. ~25 peticiones espaciadas >= 2 s sin 429. El RSS pesa 36-310 KB por pagina de 100
(Quala 286 + 310 KB): dentro del tope de 15 MB.

## 6. Canarios con vacantes en Colombia (conteos antes del filtro de 30 dias, 2026-10-20)
| Tenant (`ats_ref`) | Tablero | Con `tt:country` = Colombia | Notas |
|---|---|---|---|
| `qualacompany` (Quala Internacional) | 204 (3 paginas) | 70 | 5 paises (CO, MX, DO, EC, PE); ciudad siempre Bogota |
| `connectassistance.na` (Connect) | 7 | 5 | resto Puerto Rico; ref con punto |
| `empleosknaufsouthamerica` (Knauf South America) | 9 | 3 | 1 vacante multi-pais (6 ubicaciones) |

Sin Colombia: `career` (Teamtailor, 14, 0 CO). No se uso `dilarecruitment-1746108435` ni `tribebuilders`:
agencias/terceros, no empleador directo (el primero hoy responde 404 en todo).

## 7. Riesgos
- Agencias de reclutamiento usan Teamtailor: el nombre del canal puede ser una agencia (lista curada
  `data/direct-discovery-agencies.json`, ADR 7.1).
- Texto de vacantes = dato no confiable (HTML escapado en el RSS); extraccion determinista.
- `Content-Signal ai-train=no`: no entrenar con el contenido; mostrarlo en el buscador es `search=yes`.
- La descripcion puede incluir emails/telefonos de contacto: no registrar en logs.

## Fuentes
- https://support.teamtailor.com/en/articles/11171756-rss-feed-how-to-guide (RSS [DOC])
- https://www.teamtailor.com/en/terms-and-conditions/
- robots reales: https://qualacompany.teamtailor.com/robots.txt (identicos en los otros), https://www.teamtailor.com/robots.txt
- RFC 9309 - https://www.rfc-editor.org/rfc/rfc9309.html

## 8. Conector implementado y canario (2026-10-20)

`src/direct/ats/teamtailor.ts` (`ats_type = teamtailor`, `ats_ref` = subdominio con
región opcional). Pagina `per_page=100` hasta una página corta; un id repetido entre
páginas o una página fallida = listado no completo. Ubicación = solo el país (`tt:city`
es la oficina): la ciudad queda `null`. Cierre solo por listados.

Canario en vivo (`scripts/direct-canary.ts`, sin BD):

| tablero | tablero | Colombia | vigentes ≤30 d | requests | tiempo |
|---|---:|---:|---:|---:|---:|
| `qualacompany` | 204 | 70 | 30 | 3 | 2,2 s |
| `connectassistance.na` | 7 | 5 | 3 | 1 | 1,0 s |
| `empleosknaufsouthamerica` | 9 | 3 | 0 | 1 | 0,7 s |
