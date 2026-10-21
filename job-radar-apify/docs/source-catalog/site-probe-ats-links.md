# Site probe: links ATS desde el sitio de cada empresa (D3)

Investigación `source-researcher` del 2026-10-20 para
`docs/adr/0006-direct-employers.md` §7. No es un adaptador de vacantes: lee
robots.txt, la home y hasta 3 rutas de empleo del dominio propio de la empresa
para detectar enlaces a su ATS. Leyenda: **[DOC]** documentado oficialmente;
**[OBS]** observado, no garantizado; **[NV]** no verificado con fuente oficial
(confirmar con fixture real antes de fiarse).

Parámetros: UA `BuscoTrabajoBot/1.0 (+https://buscotrabajo.co)`, 1 request
concurrente por dominio, timeout 15 s, solo GET, solo `text/html`, cuerpo
acotado.

## 1. Cumplimiento

### 1.1 robots.txt (RFC 9309) [DOC]

- `https://<host>/robots.txt` una vez por host; hasta 5 redirects (las reglas
  aplican al host original); más de 5 = no disponible.
- **4xx = "unavailable": todo permitido** (§2.3.1.3). Política propia más
  conservadora: 401/403 con huella de challenge → `blocked`.
- **5xx, error de red o timeout = "unreachable": todo prohibido** (§2.3.1.4).
- Grupo: el product token `BuscoTrabajoBot` sin distinguir mayúsculas; varios
  grupos que coinciden se fusionan; si ninguno, aplica `*`; sin `*`, todo
  permitido. Un grupo específico **no** se fusiona con `*`.
- Regla: gana la coincidencia más larga; empate Allow vs Disallow → Allow.
  Soportar `*` y `$`. `Disallow:` vacío = nada prohibido.
- `Crawl-delay` no está en el RFC: si el grupo aplicable lo declara se
  respeta (tope 30 s; mayor → se salta el dominio).
- Se evalúa robots para **cada** URL a pedir, no solo la home.

### 1.2 Cloudflare / 403 / challenge

403, 429 o 503 con huella de challenge (`cf-mitigated: challenge`, "Just a
moment"), CAPTCHA o redirección a login → `blocked`. **Nunca** se reintenta
con otro UA, proxy, navegador headless ni cabeceras falsas. Reintento no antes
de 7 días.

### 1.3 Alcance

- Solo robots.txt, home y hasta 3 rutas de empleo del **mismo sitio**
  (`www.` y redirects al mismo dominio registrable, p. ej. `addi.com` →
  `co.addi.com`, `rappi.com` → `rappi.com.co`).
- Los enlaces a otros dominios **no se siguen**: se extrae el href y se
  clasifica con la tabla §2. Host de empleo desconocido → evidencia para
  revisión humana.
- Las rutas de empleo suelen estar anidadas (`/acerca-de/trabaja-con-nosotros`,
  `/conocenos/nequi-trabaja-con-nosotros`): se descubren desde los hrefs de la
  home (texto o ruta con trabaj|empleo|career|vacante|talento|jobs), no solo
  con rutas fijas.
- Redirects validados en cada salto (mismo registrable), solo http(s), nunca
  IPs privadas ni loopback (SSRF).
- El HTML es dato no confiable: extracción determinista de hrefs, sin LLM,
  sin ejecutar JS. No se guarda el HTML, solo hrefs y metadatos.

## 2. Patrones por ATS

| ats_type | Host / patrón | ats_ref | Fuente |
|---|---|---|---|
| greenhouse | `boards.greenhouse.io/{X}`, `job-boards.greenhouse.io/{X}` (también `.eu.`) | `X` | [DOC] / [OBS] |
| greenhouse | `boards.greenhouse.io/embed/job_board?for={X}` y `.../embed/job_board/js?for={X}` | `X` | [NV] |
| lever | `jobs.lever.co/{X}` (EU: `jobs.eu.lever.co/{X}`) | `X` | [DOC] |
| ashby | `jobs.ashbyhq.com/{X}` | `X` | [DOC] |
| smartrecruiters | `jobs.smartrecruiters.com/{X}`, `careers.smartrecruiters.com/{X}` | `X` | [DOC] / [NV] |
| workday | `{tenant}.wd{N}.myworkdayjobs.com/[{locale}/]{site}` | `tenant/wdN/site` | [OBS] Rappi (sin API pública documentada) |
| successfactors | `career{N}.successfactors.com/...?company={X}` (también `.eu`) | `X` | [NV] |
| gupy | `{x}.gupy.io` | `x` | [NV] |
| magneto | `magneto365.com/co/empresas/{slug}` | `slug` | [NV] — bolsa; pregunta abierta del dueño |
| teamtailor | `{x}.teamtailor.com` | `x` | [NV] |
| eightfold | `{x}.eightfold.ai/careers` | `x` | [NV] |
| icims | `careers-{x}.icims.com`, `{x}.icims.com/jobs` | `x` | [NV] |
| buk | `{x}.buk.co/trabaja-con-nosotros` | `x` | [OBS] Nequi |
| phenom | dominio propio con assets `cdn.phenompeople.com` | host propio | [NV] huella, no URL |

Refs genéricos que no son empresa se ignoran: `embed`, `jobs`, `careers`,
`api`, `www`, `static`, `assets`, `cdn`. Un ref extraído **no** es una
empresa verificada: se valida con la API (§4) antes de habilitar nada. Hoy
solo greenhouse/lever/ashby/smartrecruiters tienen conector.

## 3. Observaciones reales (2026-10-20, con el UA de la herramienta de investigación, no el nuestro)

| Sitio | robots.txt | Links de empleo |
|---|---|---|
| bancolombia.com | Bloquea bots de IA por nombre; grupo general sin reglas sobre empleo | `/acerca-de/trabaja-con-nosotros` → `empleo.grupobancolombia.com/bancolombia/viewalljobs/` (plataforma no declarada en la página) |
| rappi.com → rappi.com.co | `*` sin reglas sobre empleo | Home: `rappi.wd12.myworkdayjobs.com/es/Rappi_jobs` **y** `rappi.wd3.myworkdayjobs.com/es/Rappi_jobs` (dos hosts para el mismo site) |
| mercadolibre.com.co | Legible; bloquea bots de IA por nombre | Home 403 → `blocked`, no se evade |
| addi.com → co.addi.com | `Allow: /` | `/careers` 404; evidencia insuficiente |
| nequi.com.co | `Allow: /` | `/conocenos/nequi-trabaja-con-nosotros` → `lapipolnequi.buk.co/trabaja-con-nosotros` (Buk) |

Conclusión: en 3 de 5 sitios el ATS no es de los 4 con conector (Workday,
Buk, host propio). El volumen grande llega con D5.

## 4. Nombre de empresa por ATS

| ATS | Endpoint | Nombre |
|---|---|---|
| Greenhouse | `GET boards-api.greenhouse.io/v1/boards/{token}` (sin auth) [DOC] | `name` (medido: `{"name":"Sezzle"}`) |
| SmartRecruiters | `GET api.smartrecruiters.com/v1/companies/{id}/postings` [DOC] | `content[].company.name`; sin postings no hay nombre |
| Lever | `GET api.lever.co/v0/postings/{site}` | **no hay** |
| Ashby | `GET api.ashbyhq.com/posting-api/job-board/{name}` | **no hay** |

El nombre del directorio es la fuente canónica; el del ATS solo valida que el
token pertenece a esa empresa (comparación por `company_key`), nunca lo
sobrescribe.

## 5. Riesgos

- Ignorar robots expone a bloqueo y a daño reputacional. BuscoTrabajoBot no
  está nombrado en los sitios vistos, así que aplica `*`.
- Términos de uso: no se revisaron sitio por sitio. Lectura de páginas
  públicas, ~5 requests por empresa, sin login ni datos personales. Una
  empresa que pida exclusión queda `opt_out` permanente.
- Falsos positivos: un link ATS puede ser de otra filial o de un cliente
  (Rappi tiene dos hosts Workday): validación por API y revisión humana.
- Patrones [NV] y Workday/SuccessFactors sin API documentada: canarios antes
  de D5.

## Fuentes

- RFC 9309 — https://www.rfc-editor.org/rfc/rfc9309.html
- Greenhouse Job Board API — https://docs.greenhouse.io/job-board.html
- Lever Postings API — https://github.com/lever/postings-api
- Ashby — https://developers.ashbyhq.com/docs/public-job-posting-api
- SmartRecruiters — https://developers.smartrecruiters.com/reference/v1listpostings
