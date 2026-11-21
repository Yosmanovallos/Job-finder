# Resume Studio R2 — subir CV y leer vacantes por link (sin IA, sin pagos)

**Estado:** implementado y archivado (2026-11-21). Evidencia en
[`validation.md`](validation.md).
**ADR:** [`docs/adr/0017-resume-studio-implementation.md`](../../../../docs/adr/0017-resume-studio-implementation.md).
**Rama:** `codex/resume-studio-r2`, cortada de `codex/resume-studio-r1`
(PR #147); PR en borrador contra `codex/resume-studio`. Nada a `main`.
**Fuente de fases:** doc 11 §8 (fila R2) y §5.3; doc 06 §5; doc 08; doc 09 §5.

## Problema

El flujo «pego el link → mi hoja de vida se adapta» necesita dos entradas
que R1 no tiene:

1. El **CV del usuario desde un archivo** (R1 cerró sin subida: ver
   `archive/resume-studio-r1/proposal.md`, «alcance ajustado»).
2. La **vacante a partir de un link**, como datos estructurados y
   validados (`JobSnapshot`), sin LLM cuando la fuente ya los trae.

## Alcance

### 1. Subir CV PDF/DOCX (`POST /api/resume/import`)

- `multipart/form-data` con **un** archivo; el stream se corta en 2 MB
  (más un margen fijo para el sobre multipart), sin confiar en
  `Content-Length`.
- Tipo **por firma de bytes**: `%PDF-` o ZIP (`PK\x03\x04`) con
  `word/document.xml`. La extensión y el `Content-Type` no deciden nada.
- PDF: máx. 4 páginas; rechazo si está cifrado (`/Encrypt`) o trae
  JavaScript, acciones de apertura, `/Launch` o adjuntos (bytes crudos **y**
  la API de pdf.js, que ve los diccionarios dentro de flujos comprimidos).
  `isEvalSupported: false`.
- DOCX: lector ZIP propio (directorio central, `inflateRaw` con
  `maxOutputLength`): ≤ 200 entradas, ≤ 20 MB descomprimidos en total,
  rechazo de `vbaProject.bin`, `word/embeddings/*`, `oleObject*`, `activeX`,
  relaciones `TargetMode="External"` y cualquier `<!DOCTYPE`/`<!ENTITY`
  (sin parser XML: no hay entidades que resolver). Máx. 4 páginas cuando
  `docProps/app.xml` lo declara.
- El parseo corre en un `worker_thread` con `resourceLimits` y se termina a
  los **5 s**; **1 parseo a la vez** (si hay otro, 429 sin cola).
- El archivo **nunca se guarda** (ni disco ni base); no se registra su
  contenido. Respuesta: solo el texto (≤ 30.000 caracteres), páginas y
  formato, marcado como entrada no confiable.
- Requiere las dos autorizaciones obligatorias (`cv_processing`, `terms`),
  no la de guardar en la cuenta (no se guarda nada).
- La extracción a JSON con LLM es de **R3**. La opción «pegar texto» se
  mantiene en la misma pantalla.

### 2. Leer vacantes por link (`POST /api/resume/job-link`, doc 11 §5.3)

Orden fijo (AGENTS.md §Source priority):

1. `buscotrabajo.co/empleos/:id` → nuestra base (`getJobById` +
   `maskLockedFields`, igual que la ruta pública).
2. URL que ya está en nuestra tabla `jobs` (por `url`): datos que ya
   tenemos, sin tocar el sitio.
3. Greenhouse / Lever / Ashby / SmartRecruiters con id de la vacante →
   API pública, reutilizando los parsers del pipeline directo (movidos sin
   cambios a `src/lib/ats-posting-parsers.ts` para que el servidor web siga
   sin importar `src/direct/`, ADR 0006 §9).
4. Otro sitio → GET con controles SSRF y `robots.txt` → `JobPosting`
   JSON-LD.
5. LinkedIn (`linkedin.com`, `lnkd.in`) y sitios con login o anti-bot
   (Indeed, Glassdoor; 401/403; redirección a una página de login) → **no se
   descarga nada**: respuesta `paste_required` con el link para «Ir a la
   vacante».

Sin JSON-LD → `paste_required` con motivo `no_structured_data` (en R3 ese
caso pasa al LLM). Pegar el texto (`POST /api/resume/job-link/paste`) busca
**la misma vacante** por empresa + cargo **solo en nuestra base** (que ya
incluye el corpus directo de ATS); sin llamadas en vivo.

Controles SSRF: solo `http`/`https` en 80/443, sin usuario/clave en la URL;
DNS resuelto por nosotros y **validado en la conexión** (`lookup` propio, sin
hueco de rebinding); bloqueo de IPv4 privadas, loopback, link-local,
CGNAT, 198.18/15, multicast y reservadas; IPv6 `::`, `::1`, `fc00::/7`,
`fe80::/10`, `ff00::/8` y las IPv4 embebidas (`::ffff:`, `64:ff9b::/96`,
`2002::/16`); nombres `localhost`, `*.local`, `*.internal` y de metadatos;
redirecciones manuales (máx. 3), cada una revalidada; un plazo total de
8 s; ≤ 2 MB leídos del stream; solo `text/html`; sin cookies;
`Accept-Encoding: identity` y, si igual llega comprimido, tope de 2 MB
descomprimidos.

Resultado: `JobSnapshot` (Zod estricto) con procedencia (`via`, URL,
fecha) y `untrusted: true` en todo texto externo. **Caché por URL canónica
de 24 h** (`rs_job_snapshot_cache`, compartida entre usuarios, sin
`user_id`): solo resultados leídos de fuentes públicas o de nuestra base;
**nunca** texto pegado por un usuario.

### 3. Bandera y base

Todo detrás de `RESUME_STUDIO_ENABLED=false` (ya cableado en R1 para
`/api/resume/*`). La tabla nueva va en el bloque `resume-studio` de
`schema.sql` y se migra **solo** en el Postgres desechable.

## Fuera de alcance

IA (extracción a JSON, vacante sin JSON-LD → LLM, tarjetas): R3. Pagos:
R4. Tracker «Mis postulaciones» (donde el link quedará guardado por
usuario): R4b. Hechos con `source_span` desde el archivo: R3, sobre el
texto de esta fase.

## Criterio de salida

`tsc`, `build`, `test:unit` (fallos heredados aparte), `test:integration`
y `test:resume-studio` en verde; T-FILE-1..8 y SSRF en verde; T-FREE sin
cambios; muestra de 30 links reales de Colombia (solo lectura, con
aprobación explícita del propietario) con el % resuelto sin LLM.
