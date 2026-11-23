# Tasks: Resume Studio R4c

Rama `codex/resume-studio-r4c`, creada desde `codex/resume-studio-r4b`. La
evidencia va en `validation.md`.

- [x] OpenSpec (este cambio).
- [x] Integrar `codex/resume-studio-r3` (ajuste con Qwen real) que faltaba en R4/R4b.
- [x] `cv_extract@3` con anclas y copia literal (`sliceBetween`), 4000 tokens, 60 s.
- [x] Diagnóstico por llamada sin contenido (`finish_reason`, tokens, largo).
- [x] `/tailor/start` idempotente por `clientKey` + índice único `uq_rs_ai_usage_start`.
- [x] Pruebas: unitarias R4c (anclas, ataques, tamaño, diagnóstico, claim) e integración (5 inicios simultáneos = 1 cupo).
- [x] Pantalla inicial: link + CV + autorizaciones; nada más.
- [x] Agente con pasos de carga, puntaje y tarjetas; CV en vivo (pestañas en móvil).
- [x] Pase solo al descargar, en un diálogo.
- [x] Menú «Más opciones» (editor, versiones, exportar, borrar, autorización, revocar).
- [x] Diálogos propios; 0 `window.confirm`/`alert`/`prompt`.
- [x] Header «Hoja de vida» detrás de la bandera; HTML idéntico con la bandera apagada.
- [ ] Prueba real: CV del propietario + vacante Workday de Amadeus (extracción, tarjetas, ≥ 1 respuesta, 0 inventos).
- [x] Capturas escritorio y 375 px.
- [ ] Gates: tsc, build (hash CSS), test:unit, test:integration, test:resume-studio.
- [ ] PR en borrador contra `codex/resume-studio`; archivar el cambio.
