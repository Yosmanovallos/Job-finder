# Tasks: Resume Studio R4d

Rama `codex/resume-studio-r4d`, creada desde `codex/resume-studio-r4c` (`5473cc6`).

- [x] OpenSpec (este cambio).
- [x] P0-1 tarjeta `tool` por herramienta faltante (Sí / Algo parecido / No), antes de redactar; vocabulario QA; «Office» sin falsos positivos; huecos en tarjetas de mapeo y al final.
- [x] P0-2 estado de acción: spinner en el botón, 10 s → Cancelar, respuesta en el lugar del botón.
- [x] P0-3 mensaje «qué falta / no lo inventamos / qué hacer»; procedencia CV vs. «lo que nos contaste».
- [x] P0-4 «~X años» solo cuando la tarjeta pregunta años y la cifra lo responde.
- [x] P0-5 detector de idioma, idioma en los 5 prompts que redactan (versiones subidas), reintento y descarte; títulos y fechas del CV en su idioma.
- [x] Pruebas unitarias `validate-resume-studio-r4d.test.ts` (unit y resume-studio).
- [ ] Gates: tsc, build (hash CSS), test:unit, test:integration, test:resume-studio.
- [ ] Prueba real con Qwen, CV del propietario y vacante de Amadeus, 1280 y 375 px.
- [ ] Capturas sintéticas en `screens/`.
- [ ] PR en borrador contra `codex/resume-studio-r4c`; archivar el cambio.
