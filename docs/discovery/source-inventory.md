# Inventario de fuentes — QA & AI Opportunity Discovery

Estado: **matriz verificada** (2026-07-19). Clasifica fuentes candidatas por método de acceso y
estado de cumplimiento, según `Prompt_QA_AI_Opportunity_Discovery_Compliant.md` (leads de QA/AI,
no solo Workana) y las reglas de `AGENTS.md` (API-first; nunca evadir anti-bot/ToS).

Cada fila con investigación completada tiene su catálogo detallado en `docs/source-catalog/`.

Convención de la columna **Vía**:

- `API` — API oficial pública o de partner, con credenciales legítimas.
- `Feed` — RSS/Atom/sitemap público publicado por la propia fuente.
- `Search-API` — resultados públicos vía API oficial de buscador, no scraping de la SERP.
- `Export` — alerta por email / búsqueda guardada configurada por el usuario, luego procesada.
- `BLOQUEADA` — solo accesible evadiendo un control técnico o violando ToS. **No se implementa.**

Convención de **Estado**:

- `verde` — vía compatible confirmada, lista para construir conector.
- `condicional` — vía existe pero con un bloqueo contractual o dependencia a resolver antes.
- `rojo` — sin vía automatizable compatible; solo import manual o descartada.

---

## Resultado de las 7 investigaciones (source-researcher, 2026-07-19)

| Fuente                   | Categoría             | Vía real                | Estado                        | Hallazgo clave                                                                                                                                                                                                                                                                | Catálogo                  |
| ------------------------ | --------------------- | ----------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **SECOP II** (Colombia)  | Licitaciones públicas | API (Socrata SODA)      | **verde — IMPLEMENTADO**      | API de datos abiertos oficial, sin login, CC BY-SA. Conectado a Notion vía `pnpm discover:secop` → base "Oportunidades (SECOP)" (110 cargadas 2026-07-19). Falsos positivos léxicos mitigados con filtro de ruido; scoring semántico pendiente. Ver `secop-oportunidades.md`. | `secop.md`                |
| **RemoteOK**             | Job board remoto      | API JSON pública        | **verde — IMPLEMENTADO**      | `pnpm discover:boards` → Vacantes. robots.txt en vivo (2026-07-19) `User-agent:* Allow:/` — no bloquea `/api` (solo bots IA/SEO con nombre). Atribución dofollow. Se puntúa contra el perfil.                                                                                 | `remoteok.md`             |
| **We Work Remotely**     | Job board remoto      | Feed (RSS) + JSON-LD    | **verde — IMPLEMENTADO**      | `pnpm discover:boards` → Vacantes. RSS general filtrado por keyword QA/AI. Atribución (link back).                                                                                                                                                                            | `weworkremotely.md`       |
| **Remotive**             | Job board remoto      | Feed (RSS)              | **verde — IMPLEMENTADO**      | `pnpm discover:boards` → Vacantes. robots.txt bloquea `/api/*` pero **no** los feeds RSS por categoría (qa, artificial-intelligence, software-development); se usan esos.                                                                                                     | `remotive.md`             |
| **Freelancer.com**       | Marketplace freelance | API (OAuth2/PAT)        | **condicional**               | Técnicamente API-first y buena, pero **bloqueada por ToS**: solo permite caché ≤24 h, no retención persistente; + riesgo "Replacement"/anti-competencia. `owner_id` siempre null (sin datos de cliente). Requiere email a `api-support@freelancer.com`.                       | `freelancer-com.md`       |
| **Google Custom Search** | Motor de discovery    | Search-API              | **rojo** (buscar alternativa) | API oficial **cerrada a nuevos clientes** y con **fin de vida el 1-ene-2027**. Tope 100 resultados/consulta. Cláusula ToS anti-almacenamiento. No apto para dar de alta hoy.                                                                                                  | `google-custom-search.md` |
| **Workana**              | Marketplace freelance | Export (email) / manual | **rojo**                      | Sin API, sin RSS (probado), y ToS **prohíbe todo acceso automatizado**. Única vía: alerta por email configurada por el usuario + revisión/import manual.                                                                                                                      | `workana.md`              |

### Segunda ronda de investigación freelance (2026-07-20)

| Fuente                            | Categoría                       | Vía real                | Estado                                   | Hallazgo clave                                                                                                                                                                                                                                                                                       | Catálogo                           |
| --------------------------------- | ------------------------------- | ----------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **Remotive / WWR — campo `type`** | señal en fuente ya implementada | Feed RSS (ya conectado) | **verde — IMPLEMENTADO**                 | El RSS ya trae `<type>` (contract/freelance/part_time) y `boards.ts` lo descartaba (`employmentTypes: []`). Ahora se mapea a `CanonicalJob.employmentTypes` y se surface en el resumen de `discover:boards`. Volumen bajo (~2 leads contract QA/AI por corrida), pero coste cero.                    | `remotive.md`, `weworkremotely.md` |
| **Himalayas**                     | Job board remoto                | API JSON pública        | **condicional** (bloqueada pend. ToS)    | Mayor volumen potencial: filtro `employment_type=Contractor` **funciona de verdad** → 144 QA + 582 AI. Pero el ToS general prohíbe scrape/distribute mientras la licencia de la API dice "free to use with attribution": zona gris → decisión humana/ADR antes de habilitar (patrón Freelancer.com). | `himalayas.md`                     |
| **Jobicy**                        | Job board remoto                | API JSON + RSS          | **condicional** (bloqueada pend. robots) | API funcional con `jobType` real, pero `robots.txt` de `jobicy.com` **no verificable en vivo** (Cloudflare challenge en todos los intentos); filtro `industry=` roto (filtrar client-side). Reintentar verificación en otra sesión.                                                                  | `jobicy.md`                        |
| **RemoteOK — tipo de contrato**   | señal en fuente ya implementada | API/JSON-LD             | verde (sin señal)                        | 0/303 jobs con tag contract/freelance; JSON-LD de detalle → `FULL_TIME`. No expone tipo de contrato; no vale un 2º fetch por vacante.                                                                                                                                                                | `remoteok.md`                      |
| **freelancermap.com**             | Marketplace freelance           | ninguna                 | **rojo**                                 | Sin RSS (probado: `?rss=1` descartado, 404s) ni API oficial de proyectos; solo scrapers de terceros (Apify). Sin vía ligera.                                                                                                                                                                         | —                                  |
| **WorkingNomads**                 | Job board remoto                | ninguna documentada     | **rojo**                                 | `/api/exposed_jobs/` responde 200 pero **no documentado**; 36 vacantes, sin tipo de contrato estructurado. `/jobsapi/` es un índice Elasticsearch interno filtrado por error — no se usa (endpoint privado).                                                                                         | —                                  |
| **Remote.co**                     | Job board remoto                | ninguna                 | **rojo**                                 | Conexión TLS se cuelga tras el handshake en toda ruta (anti-bot Akamai por fingerprint). No se evade.                                                                                                                                                                                                | —                                  |
| **Contra.com**                    | Marketplace freelance           | HTML + JSON-LD          | **condicional, baja prioridad**          | 100% `CONTRACTOR` por diseño, pero sin categoría QA/AI (los slugs dan 404) y volumen ínfimo (8 items). Esfuerzo de enumeración desproporcionado.                                                                                                                                                     | —                                  |
| **Wellfound**                     | Marketplace/board               | ninguna                 | **rojo**                                 | `403` en `/jobs`, `/jobs.rss`, `/sitemap.xml` — anti-bot en toda ruta de contenido.                                                                                                                                                                                                                  | —                                  |

**Siguiente paso de mayor valor** (no implementado, requiere decisión): habilitar **Himalayas** tras
resolver la interpretación del ToS (email a `hi@himalayas.app` o ADR). Segmento sugerido para una
investigación futura: plataformas de _crowdtesting_ (Tester Work, uTest/Applause, Testlio) por sus
canales oficiales, no vía agregadores.

---

## Fuentes ya implementadas (Fase 2, reutilizables filtrando por QA/AI)

Greenhouse, Lever, Ashby, SmartRecruiters — 4 conectores ATS API-first ya en `packages/sources`.
Filtrar sus resultados por skills QA/AI. Catálogos existentes en `docs/source-catalog/`.

## Fuentes BLOQUEADAS y su alternativa permitida

| Fuente                       | Por qué                         | Alternativa compatible                                                                |
| ---------------------------- | ------------------------------- | ------------------------------------------------------------------------------------- |
| Upwork (scraping)            | Cloudflare + ToS                | API de partners o RSS público de categorías                                           |
| Indeed / Glassdoor           | Anti-bot + ToS                  | Alertas por email oficiales; localizar la vacante en el ATS de la empresa             |
| LinkedIn                     | Anti-bot + ToS estrictos        | Solo posts indexados vía Search-API; nunca scraping autenticado                       |
| Toptal                       | Marketplace cerrado             | Ninguna automatizable                                                                 |
| Workana (scraping)           | ToS prohíbe acceso automatizado | Alerta por email del usuario → import (ver `workana.md`)                              |
| Freelancer.com (persistente) | ToS: caché ≤24 h, no retención  | Aclaración escrita + ruta de almacenamiento efímera cifrada (ver `freelancer-com.md`) |

**Regla firme:** ninguna fuente se accede evadiendo Cloudflare, CAPTCHA, login, rate limits o
robots.txt — ni con código propio, ni con Apify, ni con Scrapfly u otro proveedor de evasión.
Coincide con `Prompt…Compliant.md` líneas 39-65 y `AGENTS.md` reglas 6 y 8.

---

## Recomendación de arranque (orden de implementación)

1. **SECOP II** — mayor valor diferencial (demanda de compra explícita, local, 100% limpia).
   Primer conector API-first + módulo de scoring semántico para filtrar los falsos positivos.
2. **We Work Remotely + Remotive + RemoteOK** — los tres job boards remotos verdes, todos vía
   Feed/API pública. Comparten patrón (atribución obligatoria) → un adaptador con submódulos.
3. **ADR** para el esquema `opportunity` (lead de servicio vs. vacante) y para la atribución
   obligatoria propagada a la capa de salida (RemoteOK, Remotive, WWR la exigen).
4. **Freelancer.com** — solo tras aclarar ToS con su soporte; mantener deshabilitado por defecto.
5. **Motor de discovery web** — sustituir Google Custom Search (fin de vida) por otra Search-API
   con acceso abierto (ej. Bing Web Search o Brave Search API) antes de construir el módulo
   `discovery/`. Requiere una investigación adicional.
6. **Workana** — solo vía flujo de import manual/alerta por email; no construir adaptador.
