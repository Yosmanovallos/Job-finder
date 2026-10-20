# Eightfold (`{x}.eightfold.ai/careers` y dominios propios) — investigación D5

`source-researcher`, 2026-10-20. Leyenda: **[DOC]** / **[OBS]** / **[NV]**. UA `BuscoTrabajoBot/1.0 (+https://buscotrabajo.co)`. Fixtures: `fixtures-eightfold/`.

**Veredicto: conector SÍ, con dos modos por tenant.** JSON público sin HTML, total en `count`, fecha absoluta, detalle por vacante con 404 claro. API **no documentada** pero **permitida explícitamente por robots.txt**.

## 1. Cumplimiento
- La API oficial (`GET /api/v2/core/positions`) exige OAuth de cliente: no utilizable [DOC: https://apidocs.eightfold.ai/docs/eightfold-api-authorization-guide]. Un tercero (fantastic.jobs) afirma que no hay API pública de empleos.
- robots.txt literal (idéntico en `bayer`, `hp`, `paypal`, `morganstanley.eightfold.ai` y `apply.careers.microsoft.com`) [OBS]: `User-agent: *`, `Disallow: /`, `Allow: /` seguido de fin de línea ($), `Allow: /careers`, `Allow: /api/apply`, `Allow: /api/pcsx`, `Allow: /candidate/login`, `Allow: /login`, `Allow: /events/candidate`, `Allow: /events/open`, `Allow: /api/events`, `Allow: /careerhub/explore/jobs`, `Allow: /api/career_hub`, `Allow: /static/gen`, `Allow: /gen`. Texto exacto en `fixtures-eightfold/robots_bayer.eightfold.ai.txt`.
- **Permitidas para `*`**: `/api/apply/v2/jobs`, `/api/pcsx/search`, `/api/pcsx/position_details`, `/careers/job/{id}`. Todo lo demás prohibido (`Disallow: /`).
- Términos: AUP de Eightfold (https://eightfold.ai/acceptable-use-policy/, rev. ago 2025) trata a visitantes del sitio de Eightfold como Customers; **sin cláusula sobre scraping/robots**; prohíbe perturbar los Services. Términos de cada empleador: no revisados [NV].
- **Rate limit [OBS]**: `apply.careers.microsoft.com` dio **429** (`text/html`, cuerpo "Please try again later", sin `Retry-After`) tras ~4 requests en ~1 min; no se insistió y tras ~10 min volvió a 200. Con 6 s o más de separación no hubo más 429. Conector: 6 s o más por host y 429 = `error` sin reintento inmediato.

## 2. Dos modos por tenant
| Modo | Endpoint | Tenants vistos |
|---|---|---|
| **v2** | `GET /api/apply/v2/jobs?domain={d}&location=Colombia&start=0`; detalle `GET /api/apply/v2/jobs/{id}?domain={d}` | Bayer (`domain=bayer.com`) |
| **PCSX** | `GET /api/pcsx/search?domain={d}&location=Colombia&start=0`; detalle `GET /api/pcsx/position_details?position_id={id}&domain={d}&hl=en` | HP, PayPal, Microsoft, Morgan Stanley |

- En tenant PCSX, v2 da **403** `{"message":"Not authorized for PCSX"}`; en tenant v2, PCSX da **403** `{"message":"PCSX is not enabled for this user."}`. Detección: probar uno y caer al otro.
- `domain` sale del HTML de `/careers` (`"domain": "bayer.com"`); el host puede ser dominio propio (Microsoft).
- **Filtro país**: `location=Colombia` (texto libre, difuso; PCSX incluye remotas elegibles por defecto). Re-filtrar siempre por `locations[]`/`standardizedLocations`.
- **Paginación**: `start` en pasos de **10**; `num` se ignora (probado 50 y 100). Total: v2 `count` en raíz; PCSX `data.count`. Bayer sin filtro `count` 596; HP ~830.
- **Completitud**: HTTP 200 (PCSX además `status:200`), `start` avanza de 10 hasta superar `count`, suma de posiciones = `count`, ids únicos. Sin filtro el orden (`sortBy: distance`) no es estable entre páginas; con `location=Colombia` los volúmenes caben en 1 página (3-7). [OBS]
- La respuesta v2 pesa ~90 KB por página (config del sitio); ignorar todo salvo `positions` y `count`.

## 3. Campos
| Canónico | v2 | PCSX |
|---|---|---|
| externalId | `id` (string numérica) / `ats_job_id` | `id` (num) / `atsJobId` |
| title | `name` | `name` |
| applyUrl | detalle `apply_redirect_url` (ATS destino); `canonicalPositionUrl` (`talent.bayer.com/careers/job/{id}`) | detalle `positionUserActions.applyAction.applyUrl` (Workday en HP); `publicUrl` |
| locationTexts | `locations[]` (ej. Bogota,Cundinamarca,Colombia) | `locations[]` + `standardizedLocations[]` |
| countryCodes | **ausente** (nombre al final del texto) | `standardizedLocations` termina en **alpha-2** (ej. Bogotá, Bogota, CO); a veces solo CL |
| structuredCity | 1er segmento de `location` (texto) | 1er segmento de `standardizedLocations` |
| workplace | `work_location_option` (`onsite`; en el detalle de Bayer vino `null` aunque la lista decía `onsite`) | `workLocationOption` |
| descriptionText | `job_description`: en la lista de Bayer vino en 2 de 7; el detalle sí | `jobDescription` solo en detalle |
| department | `department`, `business_unit` | `department` |
| employmentType, validThrough | no hay | no hay |
| publishedAt | **`t_create`** (epoch s, 00:00 UTC: Bayer 1792022400 = 2026-10-15); `t_update` = modificación | **`postedTs`** (epoch s); `creationTs` anterior; detalle `externallyPostedTs` = `postedTs` |
| companyName | no (usar directorio) | no |

- HP: una vacante con `creationTs` 2026-08-11 y `postedTs` 2026-10-06 (re-publicación): `postedTs` es la fecha externa. v2 no tiene equivalente; `t_create` es lo más cercano [NV si refleja republicación].
- Vacante inexistente: v2 detalle **404** `{"message":"Job with ID ... not found"}`; PCSX detalle **404** `{"status":404,"error":{"message":"Position not found"}}`; página `/careers/job/{id}` 404 [OBS]. Cierre inmediato por vacante posible.

## 4. Canarios (2026-10-20, `location=Colombia`)
| Tenant | Modo | Colombia |
|---|---|---|
| **Bayer** `bayer.eightfold.ai`, `domain=bayer.com` | v2 | **7** (6 Bogotá, 1 Medellín; tablero 596) |
| **HP** `hp.eightfold.ai`, `domain=hp.com` | PCSX | **2** (Bogotá; tablero ~830) |
| **Microsoft** `apply.careers.microsoft.com`, `domain=microsoft.com` | PCSX | **3** (multi-ubicación; tras un 429 temporal) |

PayPal: PCSX OK, 0 Colombia. Citi no es Eightfold (Radancy). Volúmenes pequeños pero reales.

## Riesgos
- API no documentada; dos modos; 429 agresivo por host.
- `location` difuso: re-filtrar. Descripción vacía en lista v2: 1 request de detalle por vacante (6 s o más cada una).

## Fuentes
- https://bayer.eightfold.ai/robots.txt , https://hp.eightfold.ai/robots.txt
- https://apidocs.eightfold.ai/docs/eightfold-api-authorization-guide
- https://eightfold.ai/acceptable-use-policy/

## Conector implementado y canario (2026-10-20)

`src/direct/ats/eightfold.ts` (`ats_type = eightfold`, `ats_ref = host@dominio`).
robots.txt en cada lectura; PCSX primero y, si responde 403, v2; 6 s entre requests;
completo solo si Σ posiciones == `count` estable. Fecha `postedTs` (PCSX) / `t_create`
(v2). País alpha-2 de `standardizedLocations` (PCSX); en v2 el filtro lee el texto.
Descripción del detalle solo para ids nuevos. **Corrección al informe**: el detalle
PCSX real viene envuelto en `{status, error, data, metadata}` (verificado en vivo).
Cierre solo por listados.

Canario en vivo (sin BD, presupuesto 2):

| tablero | modo | Colombia | vigentes | requests | tiempo |
|---|---|---:|---|---:|---:|
| `bayer.eightfold.ai@bayer.com` | v2 | 7 | 4 leídas (3 diferidas) | 5 | 26,9 s |
| `hp.eightfold.ai@hp.com` | PCSX | 2 | 2 | 4 | 19,8 s |
