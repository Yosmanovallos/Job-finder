# Tasks: Resume Studio R4b

Rama `codex/resume-studio-r4b`, creada desde `codex/resume-studio-r4`. La
evidencia va en `validation.md`.

- [x] OpenSpec (este cambio).
- [x] Esquema `rs_applications` en el bloque `resume-studio` (RLS, REVOKE, TABLES del script de migración).
- [x] Validación pura (`src/lib/resume-applications.ts`) y repositorio con todas las consultas por `user_id`.
- [x] Rutas `/api/resume/applications` (GET, POST con upsert, PATCH, DELETE), 404 para ids ajenos, sin pase.
- [x] «Borrar todo», «Exportar JSON» y «Revocar» incluyen las postulaciones.
- [x] Botón «Guardar en Mis postulaciones» al final de la adaptación; «Marcar como postulé» al abrir la vacante.
- [x] Tablero `/hoja-de-vida/postulaciones` con selector de estado (teclado y móvil) y arrastre en escritorio.
- [x] Pruebas: unitarias de validación; integración T-IDOR, sin pase, borrar/exportar/revocar; T-FREE con las rutas nuevas.
- [x] Gates: tsc, build (hash del CSS igual), test:unit, test:integration, test:resume-studio.
- [ ] Prueba local con `npm run dev:resume-studio` (el lanzador se niega sin `.env` de sandbox en este worktree; queda para el propietario).
- [x] PR en borrador contra `codex/resume-studio`; archivar el cambio.
