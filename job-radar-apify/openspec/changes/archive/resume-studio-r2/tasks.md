# Tasks — Resume Studio R2

Rama `codex/resume-studio-r2` desde `codex/resume-studio-r1`. Evidencia en
`validation.md`.

- [x] Auditoría de librerías para PDF (pdf.js 6.5.438) y decisión DOCX sin librería. Binario opcional `@napi-rs/canvas` **bloqueado** por decisión del propietario (stub local + `overrides`).
- [x] Pruebas T-FILE-1..8 (F1–F8 del doc 09 §2) + casos válidos generados en la prueba (sin binarios en el repo).
- [x] `POST /api/resume/import`: multipart con corte a 2 MB, firma de bytes, worker con 5 s y memoria acotada, 1 parseo a la vez, nada guardado.
- [x] Pruebas SSRF (IP privada directa y por DNS, redirección a IP privada, IPv4 embebida en IPv6, puertos, esquemas, > 2 MB, cuerpo lento, tipo de contenido).
- [x] Fetch seguro + `robots.txt` + `JobPosting` JSON-LD → `JobSnapshot` (Zod).
- [x] Resolver en orden: BuscoTrabajo → `jobs` por URL → ATS (Greenhouse, Lever, Ashby, SmartRecruiters) → sitio → `paste_required` (LinkedIn/login).
- [x] Pegar texto + búsqueda de la misma vacante por empresa + cargo en nuestra base.
- [x] Caché 24 h por URL canónica (`rs_job_snapshot_cache`), sin texto pegado.
- [x] UI mínima en `/hoja-de-vida`: subir archivo / pegar texto; link de vacante.
- [x] Gates: tsc, build, test:unit (JPD-001 heredado aparte), test:integration, test:resume-studio, test:direct; T-FREE sin cambios.
- [x] Muestra de 30 links reales (CO) con aprobación del propietario: 63,3 % resuelto sin LLM en el peor caso (62,1 % sin el link leído por la API de SmartRecruiters, que ahora va por la web).
- [x] Revisión: bomba de descompresión en PDF (+867 MB → rechazo a +27 MB), JS en `/ObjStm`, cupo liberado al salir el hilo.
- [x] Revisar el diff, PR en borrador contra `codex/resume-studio`, archivar este cambio.

## Pendientes antes de R5 (no bloquean R2)

- Revisión visual de las dos tarjetas nuevas con sesión real (escritorio y 375 px).
- Bitácora de eventos sin PII para subida y links (doc 08 §7).
