# Validación — Resume Studio R2 (2026-11-21)

Base: `origin/codex/resume-studio-r1` `f85f951`. Rama: `codex/resume-studio-r2`.
Todo local; nada desplegado ni migrado en Supabase. `RESUME_STUDIO_ENABLED`
sigue apagada por defecto. Gates corridos sobre el HEAD final del código
(`38fbe22`).

## Gates

| Gate | Resultado |
| --- | --- |
| `npx tsc --noEmit` | ✅ 0 errores |
| `npm run build` | ✅; el CSS global queda **idéntico byte a byte** (`index-BeuqwIzT.css`, SHA-256 `1d7ac096…c048`, igual antes de la UI y en el HEAD final); pdf.js no aparece en ningún chunk del cliente; la UI nueva vive solo en el chunk perezoso `ResumeStudio-*.js` |
| `npm run test:unit` | ❌ se detiene en **JPD-001** (`validate-job-page-blocks.test.ts`). Es **heredado**: fixtures fechados que envejecieron, el mismo fallo de la base R1 (ver `archive/resume-studio-r1/validation.md`). Lo corrige el PR #148, que está en `main` pero no en esta rama. **Con el commit de #148 aplicado temporalmente, sin versionarlo: ✅ 655 pruebas, 0 fallos** |
| `npm run test:integration` | ✅ 27/27 suites (R1: 26; +1 = `validate-resume-studio-r2.ts`) |
| `npm run test:resume-studio` | ✅: unit de R1, T-FILE, SSRF y resolver; integración de R1, R2 y T-FREE |
| `npm run test:direct` | ✅ 132 comprobaciones. Prueba que mover los parsers no cambió nada del pipeline directo; incluye la prueba de aislamiento del ADR 0006 |
| `lint` | no existe script en `job-radar-apify` |

## Pruebas nuevas

- **T-FILE-1..8** (`tests/validate-resume-studio-files.test.ts`, 13 pruebas).
  Los archivos son sintéticos y se generan en memoria; no hay binarios en el
  repo.
  - F1: `.exe` renombrado → `unsupported_type`, por firma de bytes.
  - F2: PDF cifrado → `encrypted`.
  - F3: PDF con JavaScript, con `/Launch` o con nombres escapados `#xx` →
    `active_content`. Incluye **JavaScript escondido dentro de un flujo de
    objetos comprimido (`/ObjStm`)**, invisible en los bytes del archivo.
    Un `/OpenAction` de vista, como el de Word, se acepta.
  - F4: DOCX con macros, objetos incrustados o plantilla externa →
    rechazado.
  - F5: bomba ZIP (tamaño declarado, tamaño mentiroso y 250 entradas) →
    `zip_bomb`. También la **bomba PDF**: ≈ 400 KB que se inflan a 400 MB.
    Se rechaza con el RSS pico medido cada 10 ms, que crece < 150 MB.
  - F6: XXE y «billion laughs» → `xml_entities`.
  - F7: 10 MB → `too_large`. El lector HTTP corta el stream aunque
    `Content-Length` mienta.
  - F8: PDF escaneado → `no_text` («pega el texto»).
  - Además: más de 4 páginas, corte a 5 s, heap mínimo (muere el worker, no
    el proceso), «1 a la vez» (`busy`), multipart y RSS acotado al final.
- **SSRF-1..11** (`tests/validate-resume-studio-ssrf.test.ts`). DNS y
  transporte son falsos; no se abre ningún socket.
  - Rangos privados, loopback, link-local, metadatos y reservados, en IPv4 e
    IPv6 (incluye `::ffff:`, NAT64 y 6to4).
  - Esquemas, puertos, credenciales, nombres internos e IP en forma
    decimal, hex u octal.
  - DNS con respuesta privada o mixta; la conexión queda fijada a la IP
    validada.
  - Redirecciones revalidadas, máx. 3.
  - Más de 2 MB, también comprimido; plazo único de 8 s con cuerpo lento o
    colgado.
  - Solo `text/html`.
  - `robots.txt`: si no está disponible, la página no se lee.
  - Cabeceras genéricas, sin cookies.
- **Resolver** (`tests/validate-resume-studio-job-link.test.ts`, 8 pruebas):
  - URL canónica.
  - Clasificación: LinkedIn y los sitios con login nunca se descargan;
    SmartRecruiters va por la web.
  - JSON-LD: `@graph`, arreglos y solo campos declarados; el texto visible
    de la página nunca se lee.
  - Orden fijo. Un 404 del ATS es final; un error del ATS cae al JSON-LD.
  - Caché de 24 h y motivos de «pega la descripción».
  - Pegar con búsqueda de la misma vacante.
  - Los parsers de Greenhouse, Lever y Ashby solo llaman a sus hosts fijos.
- **Integración** (`tests/validate-resume-studio-r2.ts`):
  - Subida por HTTP: exige las autorizaciones obligatorias, no la de
    guardar; nada se guarda; respuestas 415, 422 y 413.
  - Un link de BuscoTrabajo o de una vacante ya guardada se resuelve desde
    nuestra base, **sin ninguna petición externa**.
  - Caché de 24 h sin `user_id`; si una fila tiene más de 24 h, no se sirve.
  - Lo pegado nunca llega a la caché.
  - LinkedIn → pegar, y se encuentra la misma vacante por empresa y cargo.
  - Links internos → 400.
  - T-DEL sin cambios.
- **T-FREE** ✅ sin cambios: 9 superficies de vacantes idénticas con la
  bandera apagada y encendida.

## Decisiones y hallazgos

1. **El worker de parseo no carga tsx** (`execArgv: []`; Node 24 quita los
   tipos solo). Con tsx necesitaba más de 160 MB de heap solo para arrancar;
   sin tsx usa unos 16 MB. El tope del worker es 64 MB, lo que importa en
   Render Starter (512 MB). Los archivos del worker usan especificadores
   `.ts` y solo sintaxis borrable (`allowImportingTsExtensions` en
   `tsconfig`, que ya era `noEmit`).
2. **Se respeta el ADR 0006 §9**: el servidor web nunca importa
   `src/direct/`. Para reutilizar los adaptadores sin romperlo:
   - Los parsers de Greenhouse, Lever, Ashby y SmartRecruiters y los helpers
     de texto se **movieron sin cambios** a `src/lib/ats-posting-parsers.ts`
     y `src/lib/ats-text.ts`.
   - `src/direct/` los re-exporta (`test:direct` en verde).
   - El resolver tiene su propio GET JSON acotado (8 s, 8 MB, sin
     redirecciones), solo para los 3 hosts fijos de las APIs.
3. **Subida de más de 2 MB.** El servidor responde 413 y cierra el socket
   sin leer el resto. Un cliente que sigue enviando puede ver el corte en vez
   del 413, por eso la página revisa el tamaño antes de enviar.
4. **Salario de nuestra base: `null`.** Nuestra etiqueta mezcla unidades
   según la fuente, y un número sin unidad sería inventado. Del JSON-LD se
   toma solo lo declarado (`baseSalary` con moneda y unidad).
5. **Bomba de descompresión en PDF (encontrada en la revisión).**
   - El problema: pdf.js infla los flujos `/FlateDecode` en arreglos
     tipados, y el límite de heap del worker **no** los cubre. Un PDF de
     unos 400 KB subió el RSS **+867 MB** antes del corte de 5 s, lo que
     tumbaría Render Starter.
   - La solución: antes de pdf.js, cada flujo Flate que no es imagen se
     infla con `maxOutputLength` contra un presupuesto total de 20 MB (cifra
     del doc 08), y el archivo se rechaza si lo pasa. `Z_SYNC_FLUSH` tolera
     los flujos truncados que aparecen en PDF reales.
   - Medido después: **+27 MB** y rechazo `zip_bomb`.
   - Las imágenes no se inflan, porque la extracción de texto nunca las
     decodifica.
   - Los flujos `/ObjStm` inflados también pasan por la revisión de
     contenido activo, lo que cierra el caso del JavaScript escondido
     comprimido.
6. **El cupo de «1 parseo a la vez» se libera cuando el hilo sale**, no
   cuando se resuelve la promesa. Así, un worker que pasó el tiempo límite
   ya no ocupa memoria mientras empieza el siguiente.
7. **SmartRecruiters va por la web, no por su API.**
   - El ADR 0002 (`docs/adr/` de la raíz) registra que
     `api.smartrecruiters.com/robots.txt` dice `Disallow: /`; por eso ese
     adaptador es opcional en el pipeline.
   - Como la condición del propietario es respetar `robots.txt`, un link de
     SmartRecruiters ahora va por la ruta web: primero el `robots.txt` de
     `jobs.smartrecruiters.com` y luego el JSON-LD de la página.
   - Las APIs de Greenhouse, Lever y Ashby siguen como en el ADR 0006.

## Auditoría de librerías (doc 06 §5)

| Librería | Uso | Licencia | Mantenimiento | Seguridad |
| --- | --- | --- | --- | --- |
| `pdfjs-dist` **6.5.438** (exacta) | texto de PDF, solo dentro del worker | Apache-2.0 | Mozilla; esta versión es del 2026-11-01 y publican una al mes | CVE-2024-4367 (ejecución de código por fuentes) se corrigió en 4.2.67; la v6 ya no usa `eval` (`isEvalSupported` desapareció). `npm audit --omit=dev`: 0 avisos de pdf.js |
| DOCX | lector ZIP y tokenizador propios, sobre `zlib` de Node | — | código nuestro, unas 200 líneas con pruebas | sin parser XML, así que no hay entidades que resolver |

**Binario nativo bloqueado (decisión del propietario, 2026-11-21:
«Bloquearlo»).** `pdfjs-dist` declara como opcional `@napi-rs/canvas` (Skia
precompilado), y el doc 06 pide «sin binarios nativos». Cómo se bloqueó:

- Un paquete local vacío, `vendor/napi-rs-canvas-stub/`, cuyo `require`
  lanza un error igual que si no estuviera instalado. pdf.js ya envuelve ese
  `require` en try/catch y solo avisa.
- Es dependencia directa (`file:`) y `overrides` la impone a pdf.js con
  `"$@napi-rs/canvas"`. La forma `file:` directa dentro de `overrides` no
  sirve: npm resuelve la ruta relativa a `pdfjs-dist` y deja una entrada rota
  en el lockfile.
- Verificado con un `npm ci` limpio: el lockfile solo tiene el enlace al
  stub, sin paquetes por plataforma, y hay **0 archivos `.node` de canvas o
  pdf.js** en `node_modules`.
- Siguen en verde T-FILE-1..8, incluida la bomba PDF, `tsc`, `build` (CSS
  idéntico) y `test:integration` (27/27).
- `RS2-FILE-NATIVE` protege el bloqueo: si alguien lo quita, falla.

`npm audit --omit=dev` muestra un aviso **alto** en `zod <4.6.6`
(GHSA-mrhx-c7xc-m3w5). Es preexistente y no viene de R2.

## Muestra en vivo: 30 links reales de Colombia

Aprobada por el propietario el 2026-11-21 («Autorizo que los escoja»), con
estas condiciones:

- solo páginas públicas;
- un GET por link, más su `robots.txt`;
- sin login y sin LinkedIn;
- sin saltarse CAPTCHA ni anti-bot;
- cliente genérico (`BuscoTrabajoBot`).

Los links salieron de la API pública de BuscoTrabajo, así que escogerlos no
tocó sitios de terceros. Script: `scripts/resume-studio-link-sample.ts`
(`--dry-run` por defecto). Resultado agregado, sin HTML ni textos:
`docs/resume-studio/research/r2-link-sample-2026-11-21.json`.

**Peor caso (sin consultar nuestra base): 19/30 = 63,3 % resuelto sin
LLM.** Sin el link de SmartRecruiters (ver abajo), 18/29 = 62,1 %.

| Fuente | Resueltos | Cómo | Motivo de los no resueltos |
| --- | --- | --- | --- |
| Elempleo | 8/8 | JSON-LD | — |
| Magneto | 6/6 | JSON-LD | — |
| Portal oficial (ATS y sitios de empresa) | 5/8 | JSON-LD (DHL, Teamtailor) y, en 1 caso, la API de SmartRecruiters | 3 sin datos estructurados (Bancolombia, hr-suite) |
| Computrabajo | 0/8 | — | registrado como `login_wall` (detalle abajo) |

**Corrección.** 1 de los 30 links (SmartRecruiters) se leyó por su API, sin
revisar `robots.txt` (ver el punto 7 de arriba). El código ya no lo hace.
Desde esta revisión, el script guarda también el código HTTP y el host
final de cada link, para la próxima corrida.

**Detalle de Computrabajo.** `login_wall` agrupa respuestas 401, 403 o 407 y
redirecciones a una ruta con forma de login. La corrida no guardó el código
HTTP. Los links eran la página de la oferta
(`www.computrabajo.com.co/ofertas-de-trabajo/…`), no un link de postulación.
No se repitió la petición, por la condición de un GET por link.

En producción, el paso 1b (URL ya guardada en `jobs`) va **antes** de
cualquier petición. Las vacantes de Computrabajo que ya están en nuestra base
se resuelven sin tocar el sitio, así que el porcentaje real, con links que
también tenemos, es mayor. En R3, «sin datos estructurados» pasa al LLM.
Computrabajo sigue en «pega la descripción», porque nunca nos saltamos un
bloqueo.
