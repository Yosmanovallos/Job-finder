# Tasks — Resume Studio R3

Rama `codex/resume-studio-r3` desde `codex/resume-studio-r2`. Evidencia en
`validation.md`.

- [ ] OpenSpec (este cambio).
- [ ] Módulos puros: `src/lib/resume-tailor/` (texto normalizado, habilidades, requisitos por reglas, evidencia por cobertura, dos puntajes, validador de factualidad, cola de tarjetas).
- [ ] Esquema R1: `source` = `"user" | "file"` (aditivo).
- [ ] Prompts versionados con delimitadores, presupuesto y esquema; minimización de datos.
- [ ] Gateway: config `RESUME_AI_*`, transporte Qwen (sin thinking, JSON mode), mock adversarial, caché en memoria, reintento único, ledger con reserva atómica y 4 topes.
- [ ] Tabla `rs_ai_usage` en el bloque del esquema y en `migrate-resume-studio.ts`; anonimizar en «borrar todo»/revocar.
- [ ] Extracción del CV con `source_span` verificado y exclusión de datos sensibles.
- [ ] Rutas: `/api/resume/extract`, `/api/resume/tailor/start`, `/api/resume/tailor/card`.
- [ ] UI del agente en `/hoja-de-vida` (prototipo, pestañas en móvil), CSS global idéntico.
- [ ] Pruebas unitarias (puntajes, validador ≥ 40 casos, cola, gateway), T-INJ, integración (ledger, concurrencia de topes, rutas, IDOR, T-DEL).
- [ ] Evals 20 × 10 con `mock`: 0 hechos inventados aceptados; costo estimado ≤ COP 150.
- [ ] Gates: tsc, build, test:unit, test:integration, T-INJ, T-FREE.
- [ ] PR en borrador contra `codex/resume-studio`; archivar el cambio.

## Pendiente con aprobación del propietario

- Corrida única de evals contra Qwen real (llave y aprobación explícita).
