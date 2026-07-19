# SECOP II / SECOP Integrado (Colombia Compra Eficiente) — catálogo de fuente

> Fuente: **Datos Abiertos de Colombia (datos.gov.co)**, plataforma Socrata, dataset oficial
> **"SECOP II - Procesos de Contratación"** (identificador Socrata `p6dx-8zbt`), publicado por la
> **Agencia Nacional de Contratación Pública - Colombia Compra Eficiente**.
> Acceso vía la **Socrata Open Data API (SODA)** — API pública de datos abiertos, sin scraping,
> sin evasión de ningún control (regla 8 de AGENTS.md).
> Documentación oficial consultada: <https://dev.socrata.com/>, <https://dev.socrata.com/docs/endpoints.html>,
> <https://dev.socrata.com/docs/queries/>, <https://dev.socrata.com/docs/app-tokens.html>,
> <https://dev.socrata.com/foundry/www.datos.gov.co/p6dx-8zbt>,
> <https://www.datos.gov.co/Estad-sticas-Nacionales/SECOP-II-Procesos-de-Contrataci-n/p6dx-8zbt>.
> Última verificación empírica: 2026-07-19 (peticiones reales GET contra `www.datos.gov.co`).

## 0. Rol de esta fuente en el proyecto

No es un ATS de empleo: es un dataset de **licitaciones/contratación pública**. Se trata como
**lead de servicio** (freelance/consultoría/proveeduría), no como vacante — usa el
`standard_opportunity_schema` de `Prompt_QA_AI_Opportunity_Discovery_Compliant.md` (líneas
298-336), no el `canonical-job-schema` de `packages/domain`. Es demanda de compra **explícita y
activa** del Estado colombiano → `commercial_intent_score` alto por diseño.

## 1. Resumen

| Aspecto | Valor |
|---|---|
| Tipo de fuente | API pública de datos abiertos (Socrata SODA), nivel más ligero de la prioridad §2.3 |
| Dataset primario | **SECOP II - Procesos de Contratación**, id `p6dx-8zbt` — **confirmado** vía metadata API |
| Host | `https://www.datos.gov.co` |
| Endpoint base (confirmado) | `https://www.datos.gov.co/resource/p6dx-8zbt.{json\|csv}` (campo `dataUri` de la metadata) |
| Autenticación | Ninguna obligatoria; `X-App-Token` opcional recomendado para producción (§5) |
| Formato | JSON (también CSV/GeoJSON); valores numéricos y de fecha llegan **como strings** |
| Paginación | `$limit`/`$offset` + `$order` (SoQL); default `$limit`=1000 si se omite (observado) |
| Volumen total del dataset | **8.848.166** filas históricas (`count(*)`, 2026-07-19) |
| Actualización | **Diaria** (metadata: `"Frecuencia de Actualización": "Diaria"`; `dataUpdatedAt` 2026-07-18) |
| Licencia | **Creative Commons Attribution-ShareAlike 4.0 International** (CC BY-SA 4.0) — confirmado |
| robots.txt | No bloquea `/resource/` ni `/api/views/`; `Crawl-delay: 1` (respetar como política) |

## 2. Dataset(s) confirmados

Consulta a la metadata API oficial de Socrata (`GET https://www.datos.gov.co/api/views/{id}.json`):

| Dataset | ID (4x4) | Estado | Naturaleza | Uso propuesto |
|---|---|---|---|---|
| **SECOP II - Procesos de Contratación** | `p6dx-8zbt` | **confirmado** | Procesos de compra **en curso o cerrados** desde el lanzamiento de SECOP II | **Fuente primaria de leads activos** (procesos aún en fase de oferta) |
| SECOP II - Contratos Electrónicos | `jbjy-vk9h` | confirmado (metadata) | Contratos **ya firmados** (85 columnas) | Inteligencia de mercado, **no** lead nuevo |
| SECOP Integrado | `rpmr-utcd` | confirmado (metadata) | Contratos **finalizados** (SECOP I y II) | Solo histórico/analítico |

Descripción oficial de `p6dx-8zbt`:
> "Registro de los procesos de compra, sean o no adjudicados, hechos en la plataforma SECOP II desde su lanzamiento"

Dataset recomendado para leads porque incluye procesos en estado `Publicado`/`Abierto` (todavía
aceptando ofertas), a diferencia de los otros dos que solo listan contratos adjudicados.

## 3. Endpoint y formato SODA

- Endpoint confirmado (= `dataUri` de la metadata): `GET https://www.datos.gov.co/resource/p6dx-8zbt.json`
- También `.csv` y `.geojson` (documentado; no probados aquí).
- Respuesta: **array JSON**, un objeto por proceso. Valores numéricos llegan **como strings** JSON
  (ej. `"57333333"`) — parsear explícitamente. Fechas como string ISO **sin offset de zona
  horaria** (ej. `"2026-01-18T00:00:00.000"`, "floating timestamp") → zona (América/Bogotá)
  asumida, no declarada.
- `urlproceso` **no es un string**, es objeto anidado: `{"url": "https://community.secop.gov.co/..."}`
  — siempre leer `urlproceso.url`.
- Metadata pública: `GET https://www.datos.gov.co/api/views/{id}.json`.
- Cabeceras SODA2 (`X-SODA2-Fields`/`X-SODA2-Types`); existe también SODA3 (`/api/v3/...`, POST),
  no probado. `/resource/{id}.json` es el oficial expuesto como `dataUri`.

## 4. Consulta con SoQL (verificado con peticiones reales, 2026-07-19)

| Parámetro | Uso | Verificado |
|---|---|---|
| `$q` | Búsqueda de texto completo | Sí — `$q=software` |
| `$where` | Filtro SQL (`=`, `>`, `<`, `in`, `like`, `upper()`, `AND`/`OR`) | Sí |
| `$select` | Columnas + agregados (`count(*)`) | Sí |
| `$order` | Orden ASC/DESC | Sí |
| `$limit` / `$offset` | Paginación | Sí — default 1000; `$limit=100000` funcionó (no es un máximo documentado) |
| `$group` | Agrupación | Sí |

Query real verificada (procesos publicados/abiertos, recientes, sobre pruebas de software):

```
GET https://www.datos.gov.co/resource/p6dx-8zbt.json
  ?$select=id_del_proceso,nombre_del_procedimiento,entidad,precio_base,modalidad_de_contratacion,estado_del_procedimiento,fecha_de_publicacion_del,urlproceso
  &$where=estado_del_procedimiento in ('Publicado','Abierto') AND fecha_de_publicacion_del > '2026-06-01T00:00:00'
  &$q=pruebas de software
  &$order=fecha_de_publicacion_del DESC
  &$limit=5
```

Devolvió resultados reales y vigentes (2026-07-19). **Errores**: columna inexistente → `HTTP 400`
`errorCode: query.soql.no-such-column`; dataset inexistente → `HTTP 404`. Sin `429` en ~20
peticiones (no exhaustivo).

### 4.1 Paginación estable

`$order` + `$limit` + `$offset` consistente y sin solapes en prueba. **Nunca** paginar con
`$offset` sin `$order` estable. Si se ordena por `fecha_de_publicacion_del` (muchos empates),
añadir desempate: `$order=fecha_de_publicacion_del DESC, id_del_proceso`.

## 5. Autenticación y rate limits

- **No se requiere token para leer datos públicos** — ~20 requests sin `X-App-Token`, todas OK.
- Sin token: pool compartido por IP, puede ser throttled; **sin cifra exacta publicada**.
- Con token (gratis): "no limitamos salvo abuso"; sin cifra fija garantizada en la página vigente
  (una fuente secundaria menciona "hasta 1000 req/hora" — no confirmado).
- **Recomendación**: registrar app token gratuito antes de producción; no es requisito duro para
  desarrollo ni para el volumen esperado (consultas diarias).
- Throttling real no probado (volumen insuficiente para activarlo).

## 6. Licencia y términos de uso

- Metadata: `"license": "Creative Commons Attribution | Share Alike 4.0 International"`, `termsLink`
  a CC BY-SA 4.0 — **confirmado**, uso permitido con atribución.
- Atribución: "Agencia Nacional de Contratación Pública - Colombia Compra Eficiente, Bogotá D.C."
- `robots.txt` **no** bloquea `/resource/*` ni `/api/views/*` (los endpoints usados). Declara
  `Crawl-delay: 1` — respetar ≥1s entre peticiones (política del proyecto, regla 8).
- Dataset gubernamental de compras públicas: información pública por ley (Transparencia). Sin
  restricciones adicionales más allá de la licencia CC BY-SA.

## 7. Campos disponibles (`p6dx-8zbt`, 59 columnas — confirmado vía metadata API)

| Campo (fieldName) | Tipo | Notas |
|---|---|---|
| `id_del_proceso` | text | Id único, ej. `CO1.REQ.10674586` |
| `referencia_del_proceso` | text | Referencia interna de la entidad |
| `nombre_del_procedimiento` | text | Título — **texto libre, no confiable** (§10) |
| `descripci_n_del_procedimiento` | text | Objeto del contrato — **no confiable** (§10); clave para `$q`/`like` |
| `entidad` / `nit_entidad` | text | Entidad contratante |
| `departamento_entidad`, `ciudad_entidad`, `ciudad_de_la_unidad_de` | text | Ubicación |
| `fase` | text | Fase (a veces en inglés en procesos con financiamiento internacional) |
| `fecha_de_publicacion_del`, `fecha_de_ultima_publicaci` | calendar_date | Publicación |
| `fecha_de_recepcion_de` | calendar_date | Candidato a "fecha límite de oferta", **semántica por-verificar** |
| `precio_base` | number (string) | Presupuesto estimado |
| `modalidad_de_contratacion`, `justificaci_n_modalidad_de` | text | Modalidad + justificación (texto libre) |
| `tipo_de_contrato`, `subtipo_de_contrato` | text | Ej. "Prestación de servicios"; subtipo a menudo "No Definido" |
| `codigo_principal_de_categoria` | text | Código **UNSPSC** (ej. `V1.80111500`); códigos de TI por-verificar |
| `categorias_adicionales` | text | A menudo "No definido" |
| `estado_del_procedimiento` | text | `Seleccionado` (5.4M), `Publicado` (2.6M), `Abierto` (31k) — **`Publicado`/`Abierto` = leads activos** |
| `adjudicado`, `nombre_del_proveedor`, `valor_total_adjudicacion` | text/number | Si ya se adjudicó |
| `urlproceso` | **objeto** `{url}` | URL pública en `community.secop.gov.co` — no es string plano |
| `estado_resumen` | text | Redundante con estado/fase |

Campos **ausentes** (nunca inventar): contacto directo (email/teléfono), idioma explícito por
registro, moneda explícita (COP asumida por jurisdicción), sector económico, seniority estructurada.

## 8. Distribución observada (snapshot 2026-07-19)

| `estado_del_procedimiento` | Conteo |
|---|---|
| Seleccionado | 5.412.947 |
| Publicado | 2.644.067 |
| Evaluación | 552.868 |
| Cancelado | 153.418 |
| Borrador | 41.979 |
| Abierto | 31.403 |
| Aprobado | 7.523 |
| En aprobación | 3.797 |
| Suspendido | 164 |

## 9. Volumen esperado de leads QA/AI (conteos reales, 2026-07-19)

`count(*)` con `estado_del_procedimiento in ('Publicado','Abierto')`:

| Filtro | Ventana | Resultado |
|---|---|---|
| `$q=software` | publicados desde 2026-04-01 (~3.5 meses) | **1.508** procesos |
| `$q=inteligencia artificial` | histórico completo | 3.025 procesos |
| `like` estricto (pruebas de software, testing, automatización de pruebas, IA, machine learning, calidad de software) | desde 2026-04-01 | **143** procesos |
| Mismo `like` estricto | histórico completo, abiertos/publicados | 1.474 procesos |

**Advertencia (verificada)**: `$q`/`like` produce **falsos positivos altos** — un resultado de
"pruebas de software" fue una licitación de **mantenimiento de equipos policiales** que solo
menciona "actualización de software". Este dataset entrega **candidatos crudos**, no leads
calificados; necesita la capa de scoring semántico aguas abajo. Orden de magnitud tras pre-filtro:
**decenas por mes** a nivel nacional; menos tras scoring real.

## 10. Datos no confiables / regla 6 (prompt injection)

`nombre_del_procedimiento`, `descripci_n_del_procedimiento` y `justificaci_n_modalidad_de` son
**texto libre digitado por cada entidad** (miles de organismos, sin validación de contenido).
Tratar como **contenido no confiable y potencialmente adversarial**, igual que el `content` de
Greenhouse: nunca deben disparar llamadas a herramientas ni instrucciones a un LLM sin
delimitadores explícitos.

## 11. Mapeo al `standard_opportunity_schema` (Prompt…, líneas 298-336)

| Campo del schema | Origen en SECOP | Notas |
|---|---|---|
| `source_name` | — | `"secop_ii"` |
| `source_url` | `urlproceso.url` | **Objeto anidado** — leer `.url` |
| `source_category` | — | `"public_procurement"` |
| `external_id` | `id_del_proceso` | Único y estable |
| `title` | `nombre_del_procedimiento` | No confiable (§10) |
| `organization` | `entidad` (+ `nit_entidad`) | |
| `description` | `descripci_n_del_procedimiento` | No confiable (§10) |
| `opportunity_type` | — | `"government_tender"` |
| `employment_type` | `tipo_de_contrato` | Es contrato de servicios, no categoría laboral; best-effort |
| `service_category` | `subtipo_de_contrato` / UNSPSC | A menudo "No Definido"; UNSPSC como filtro fino |
| `skills` | **NO PROVISTO** | → `[]`; extracción semántica en fase posterior |
| `seniority` | **NO PROVISTO** | → `"unknown"` |
| `industry` | **NO PROVISTO** (sí en `jbjy-vk9h`) | → `null` |
| `country` | — | `"CO"` |
| `city` | `ciudad_de_la_unidad_de` / `ciudad_entidad` | |
| `remote_status` | **NO PROVISTO** | → `"unknown"` |
| `language` | — | Mayormente español (algunas fases en inglés) |
| `compensation_min/max` | `precio_base` | Presupuesto estimado, no rango |
| `currency` | **NO es campo del dataset** | Constante de adaptador `"COP"` por jurisdicción — documentar como decisión de diseño, no dato de la fuente |
| `budget_text` | — | `null` |
| `published_at` | `fecha_de_publicacion_del` | Sin offset TZ; asumir América/Bogotá (marcado) |
| `expires_at` | `fecha_de_recepcion_de` (candidato) | Semántica **por-verificar** |
| `contact_name` / `contact_method` | **NO PROVISTO** | → `null`; interacción dentro de SECOP II |
| `application_url` | `urlproceso.url` | = `source_url` |
| `*_score` | — | Aguas abajo; `commercial_intent_score` alto por diseño |
| `compliance_method` | — | `"public_open_data_api"` |
| `raw_source_reference` | — | Registro crudo (59 cols) + `p6dx-8zbt` + timestamp |

## 12. Riesgos y limitaciones

1. **Falsos positivos altos** (§9): match léxico ≠ relevancia QA/AI; requiere scoring semántico.
2. **Texto libre no confiable** (§10): posible vector de inyección si se pasa a un LLM.
3. **`urlproceso` es objeto anidado**, no string.
4. **Semántica de fechas no confirmada**: sin offset TZ; `fecha_de_recepcion_de` como "deadline"
   por-verificar.
5. **`currency` no es campo de la fuente**: constante `"COP"` documentada como diseño.
6. **`$limit` sin techo documentado**: usar páginas moderadas (1000-5000) con `$offset`/`$order`.
7. **Rate limiting sin cifra oficial**: backoff conservador + `Crawl-delay: 1`.
8. **`estado`/`fase` sin máquina de estados formal**: inferencias observacionales.
9. **Datasets secundarios** (`jbjy-vk9h`, `rpmr-utcd`): contratos cerrados, solo inteligencia de
   mercado, no leads activos.

---

## Notas del investigador

**Documentación oficial**: `dev.socrata.com` (endpoints, SoQL, app-tokens), Foundry del dataset,
página en `datos.gov.co`, y la **metadata API** (`GET /api/views/{id}.json`) como fuente más
confiable para id, licencia, columnas y frecuencia.

**Verificado empíricamente (GET reales, 2026-07-19, sin app token, ~20-25 peticiones)**: metadata
de los 3 datasets; `$q`, `$where` con `upper()`/`like`, `$select count(*)` simple y agrupado,
`$order`, `$limit` (1000 y 100000), `$offset` con `$order` sin duplicados; errores `400`/`404`;
cabeceras `X-SODA2-*` (sin `X-RateLimit-*`); `robots.txt`.

**Por-verificar**: cifra exacta de throttling con/sin token; semántica de `fecha_de_recepcion_de`;
zona horaria implícita; códigos UNSPSC de TI; comportamiento a gran volumen; endpoints
`.csv`/`.geojson` y SODA3 para este dataset.
