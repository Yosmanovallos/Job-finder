# Tasks — Resume Studio R1

Nada de esto se ejecuta en R0. Una sesión propia, rama `codex/resume-studio-r1`
desde `codex/resume-studio`.

- [ ] Leer ADR 0017, doc 06 §3–§6, doc 08 y doc 09; registrar línea base de gates en la rama.
- [ ] D6: auditoría de solo lectura de las tablas viejas `cv_*`/`llm_*` (aprobada por el propietario) y escribir el resultado.
- [ ] Escribir pruebas rojas: T-FILE, T-IDOR, T-DEL, T-FREE.
- [ ] Migración aditiva `rs_consents`, `rs_resumes`, `rs_resume_versions` (solo contenedor desechable).
- [ ] Bandera `RESUME_STUDIO_ENABLED` (por defecto `false`) → 404 en todo el módulo.
- [ ] Autorización en la subida (3 casillas) guardada en `rs_consents`.
- [ ] Subida PDF/DOCX con validaciones de firma, tamaño, páginas y contenido activo; auditar las librerías nuevas.
- [ ] Extracción determinista a hechos con `source_span` + revisión campo a campo.
- [ ] 3 plantillas y vista previa.
- [ ] Versiones, borrar y exportar.
- [ ] Gates: tsc, build, test:unit, test:integration; dashboard sin cambios con la bandera apagada.
- [ ] Revisar el diff completo, PR contra `codex/resume-studio` (no `main`), y archivar este cambio al cerrar R1.
