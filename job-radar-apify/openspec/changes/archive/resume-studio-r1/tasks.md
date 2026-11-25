# Tasks — Resume Studio R1

Rama `codex/resume-studio-r1` desde `codex/resume-studio`. Alcance ajustado:
sin subida de archivos (ver la nota en `proposal.md`). Evidencia en
`validation.md`.

- [x] Leer ADR 0017, doc 06 §3–§6, doc 08 y doc 09; registrar línea base de gates en la rama.
- [ ] D6: auditoría de solo lectura de las tablas viejas `cv_*`/`llm_*` — **abierta**: requiere acceso a Supabase y aprobación del propietario. R1 no reutiliza ni toca esas tablas.
- [x] Escribir pruebas: T-IDOR, T-DEL, T-FREE (T-FILE → cambio posterior, con la subida).
- [x] Migración aditiva `rs_consents`, `rs_resumes`, `rs_resume_versions` (solo contenedor desechable; el script rechaza `--allow-remote-db` hasta R5).
- [x] Bandera `RESUME_STUDIO_ENABLED` (por defecto `false`; solo `"true"` la enciende) → 404 en todo el módulo.
- [x] Autorización (3 casillas: 2 obligatorias + guardar en la cuenta opcional) guardada en `rs_consents` (solo inserción, versión y SHA-256 del texto).
- [ ] Subida PDF/DOCX con validaciones de firma, tamaño, páginas y contenido activo; auditar librerías — **movida a un cambio posterior**.
- [ ] Extracción determinista a hechos con `source_span` + revisión campo a campo — **movida a un cambio posterior**.
- [x] CV base creado desde cero y editado a mano (esquema Zod estricto, sin foto/cédula/estado civil).
- [x] 3 plantillas de una columna y vista previa (mismo componente que usará el PDF).
- [x] Versiones (máx. 50), deshacer/restaurar como versión nueva, borrar uno, borrar todo y exportar JSON.
- [x] Gates: tsc, build, test:unit, test:integration; dashboard sin cambios con la bandera apagada (y encendida).
- [x] Revisar el diff completo, PR contra `codex/resume-studio` (no `main`), y archivar este cambio.

## Pendientes antes de R5 (no bloquean R1)

- Cifrado de aplicación de `facts_json` (AES-256-GCM, `RESUME_DATA_KEY_V1`, doc 08 §4).
- Textos legales revisados por abogado (D4); hoy son borrador `v2026-11`.
- Revisión visual del editor en escritorio y móvil (375 px) con sesión real.
- Borrado automático por inactividad (doc 06 §8) y bitácora de eventos (doc 08 §7).
