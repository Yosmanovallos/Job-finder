# Validación — Resume Studio R2 (2026-11-21)

Base: `origin/codex/resume-studio-r1` `f85f951`. Rama: `codex/resume-studio-r2`.
Todo local; nada desplegado ni migrado en Supabase. `RESUME_STUDIO_ENABLED`
sigue apagada por defecto.

## Gates

| Gate | Resultado |
| --- | --- |
| `npx tsc --noEmit` | ✅ 0 errores |
| `npm run build` | ✅; el CSS global queda **idéntico byte a byte** (`index-BeuqwIzT.css`, SHA-256 `1d7ac096…c048` antes y después de la UI); pdf.js no aparece en ningún chunk del cliente; la UI nueva vive solo en el chunk perezoso `ResumeStudio-*.js` |
| `npm run test:unit` | ❌ se detiene en **JPD-001** (`validate-job-page-blocks.test.ts`), **heredado**: fixtures fechados envejecidos, el mismo fallo de la base R1 (ver `archive/resume-studio-r1/validation.md`). Lo corrige el PR #148 (en `main`, no en esta rama). **Con el commit de #148 aplicado temporalmente (sin versionarlo): ✅ verde completo, 655 pruebas** |
| `npm run test:integration` | ver abajo |
| `npm run test:resume-studio` | ✅ (unit R1 + T-FILE + SSRF + resolver; integración R1, R2 y T-FREE) |
| `npm run test:direct` | ✅ 132 comprobaciones (prueba que mover los parsers no cambió nada del pipeline directo) |
| `lint` | no existe script en `job-radar-apify` |

## Pruebas nuevas

- **T-FILE-1..8** (`tests/validate-resume-studio-files.test.ts`, 13 pruebas,
  archivos sintéticos generados en memoria; ningún binario en el repo):
  F1 `.exe` renombrado → `unsupported_type` por firma de bytes · F2 PDF
  cifrado → `encrypted` · F3 PDF con JavaScript, `/Launch` y nombres
  escapados `#xx` → `active_content` (un `/OpenAction` de vista, como el de
  Word, se acepta) · F4 DOCX con macros, objetos incrustados o plantilla
  externa → rechazado · F5 bomba ZIP (tamaño declarado, tamaño mentiroso y
  250 entradas) → `zip_bomb` · F6 XXE y «billion laughs» → `xml_entities` ·
  F7 10 MB → `too_large`, y el lector HTTP corta el stream aunque
  `Content-Length` mienta · F8 PDF escaneado → `no_text` («pega el texto»).
  Más: > 4 páginas, corte a 5 s, heap mínimo (muere el worker, no el
  proceso), «1 a la vez» (`busy`), multipart, y RSS acotado al final.
- **SSRF-1..11** (`tests/validate-resume-studio-ssrf.test.ts`, DNS y
  transporte falsos, ningún socket): rangos privados/loopback/link-local/
  metadatos/reservados en IPv4 e IPv6 (incl. `::ffff:`, NAT64, 6to4);
  esquemas, puertos, credenciales, nombres internos, IP decimal/hex/octal;
  DNS con respuesta privada o mixta; conexión fijada a la IP validada;
  redirecciones revalidadas (máx. 3); > 2 MB también comprimido; plazo único
  de 8 s con cuerpo lento o colgado; solo `text/html`; `robots.txt` (no
  disponible = no se lee); cabeceras genéricas sin cookies.
- **Resolver** (`tests/validate-resume-studio-job-link.test.ts`, 8 pruebas):
  URL canónica, clasificación (LinkedIn y sitios con login nunca se
  descargan), JSON-LD (`@graph`, arreglos, solo campos declarados, el texto
  visible de la página nunca se lee), orden fijo, 404 del ATS es final y su
  error cae al JSON-LD, caché 24 h, motivos de «pega la descripción», pegar
  con búsqueda de la misma vacante, parsers de los 4 ATS solo contra sus
  hosts fijos.
- **Integración** (`tests/validate-resume-studio-r2.ts`): subida por HTTP
  con las autorizaciones (y sin la de guardar), nada guardado, 415/422/413;
  link de BuscoTrabajo y de una vacante ya guardada resueltos desde nuestra
  base **sin ninguna petición externa**; caché de 24 h sin `user_id`; lo
  pegado jamás en la caché; LinkedIn → pegar + misma vacante por empresa y
  cargo; links internos → 400; T-DEL igual.
- **T-FREE** ✅ sin cambios: 9 superficies de vacantes idénticas con la
  bandera apagada y encendida.

## Decisiones y hallazgos

1. **El worker de parseo no carga tsx** (`execArgv: []`; Node 24 quita los
   tipos). Con tsx necesitaba > 160 MB de heap solo para arrancar; sin tsx,
   ~16 MB. Tope del worker: 64 MB. Importa en Render Starter (512 MB). Los
   archivos del worker usan especificadores `.ts` y solo sintaxis borrable
   (`allowImportingTsExtensions` en `tsconfig`, que ya era `noEmit`).
2. **ADR 0006 §9 se respeta.** El servidor web nunca importa `src/direct/`.
   Para reutilizar los adaptadores sin romperlo, los parsers de Greenhouse,
   Lever, Ashby y SmartRecruiters y los helpers de texto se **movieron sin
   cambios** a `src/lib/ats-posting-parsers.ts` y `src/lib/ats-text.ts`;
   `src/direct/` los re-exporta (`test:direct` verde). El resolver tiene su
   propio GET JSON acotado (8 s, 8 MB, sin redirecciones) solo para los 4
   hosts fijos de las APIs.
3. **Subida > 2 MB:** el servidor responde 413 y cierra el socket sin leer
   el resto; un cliente que sigue enviando puede ver el corte en vez del 413.
   Por eso la página revisa el tamaño antes de enviar.
4. **Salario de nuestra base: `null`.** Nuestra etiqueta mezcla unidades por
   fuente; un número sin unidad sería inventado. Del JSON-LD se toma solo
   lo declarado (`baseSalary` con moneda y unidad).
5. **Pendiente de prueba real:** JavaScript escondido dentro de un flujo de
   objetos comprimido (`/ObjStm`) de un PDF. La revisión de bytes no lo ve; la
   API de pdf.js (`getJSActions`, `getOpenAction`, `getAttachments`, acciones
   por página) sí debería. Mi fixture de prueba no logró que pdf.js
   resolviera el objeto (ni una acción benigna), así que el resultado **no es
   concluyente**; queda como tarea antes de R5 con un PDF de flujo xref real.

## Auditoría de librerías (doc 06 §5)

| Librería | Uso | Licencia | Mantenimiento | Seguridad |
| --- | --- | --- | --- | --- |
| `pdfjs-dist` **6.5.438** (exacta) | texto de PDF, solo dentro del worker | Apache-2.0 | Mozilla; versión publicada el 2026-11-01, una mensual | CVE-2024-4367 (ejecución por fuentes) corregido en 4.2.67; v6 ya no tiene `eval` (`isEvalSupported` desapareció). `npm audit --omit=dev`: 0 avisos de pdf.js |
| DOCX | lector ZIP + tokenizador propios (`zlib` de Node) | — | código nuestro, ~200 líneas con pruebas | sin parser XML: no hay entidades que resolver |

**Para decidir (propietario):** `pdfjs-dist` declara como **opcional** el
binario nativo `@napi-rs/canvas` (Skia precompilado), y npm lo instala. El
doc 06 pide «sin binarios nativos». La extracción de texto no lo usa: pdf.js
solo lo carga para pintar, y aquí corre aislado en el worker. Opciones:
(a) aceptarlo, o (b) reemplazarlo por un paquete vacío con `overrides` de npm.
`npm audit --omit=dev` muestra un aviso **alto preexistente** en `zod <4.6.6`
(GHSA-mrhx-c7xc-m3w5), que no viene de R2.

## Muestra en vivo: 30 links reales de Colombia

Aprobada por el propietario el 2026-11-21 («Autorizo que los escoja»):
solo páginas públicas, un GET por link más `robots.txt`, sin login, sin
LinkedIn, sin saltarse CAPTCHA ni anti-bot, cliente genérico
(`BuscoTrabajoBot`). Los links salieron de la API pública de BuscoTrabajo,
así que escogerlos no tocó sitios de terceros. Script:
`scripts/resume-studio-link-sample.ts` (`--dry-run` por defecto). Resultado
agregado, sin HTML ni textos: `docs/resume-studio/research/r2-link-sample-2026-11-21.json`.

**Peor caso (sin consultar nuestra base): 19/30 = 63,3 % resuelto sin LLM.**

| Fuente | Resueltos | Cómo | Motivo de los no resueltos |
| --- | --- | --- | --- |
| Elempleo | 8/8 | JSON-LD | — |
| Magneto | 6/6 | JSON-LD | — |
| Portal oficial (ATS y sitios de empresa) | 5/8 | JSON-LD (DHL, Teamtailor) y API de SmartRecruiters | 3 sin datos estructurados (Bancolombia, hr-suite) |
| Computrabajo | 0/8 | — | el sitio responde como muro de login/anti-bot a un cliente automático: no se insiste |

En producción el paso 1b (URL ya guardada en `jobs`) va **antes** de
cualquier petición. Las vacantes de Computrabajo que ya están en nuestra base
se resuelven sin tocar el sitio, así que el % real con links que también
tenemos es mayor. En R3, «sin datos estructurados» pasa al LLM. Computrabajo
sigue en «pega la descripción», porque nunca se salta su bloqueo.
