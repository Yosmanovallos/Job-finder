# Prompt para Claude Code — ejecutar WORKANA-V2-PLAN.md

Copia/pega esto en una sesión NUEVA de Claude Code (una por fase, no
encadenes fases). Ajusta `[FASE N]` en cada sesión sucesiva.

```
Trabajamos en el repo job-radar-apify (dentro de
C:\Users\yosma.DESKTOP-RQ0SDF3\OneDrive\Job-finder\job-radar-apify).

Lee completo job-radar-apify/docs/WORKANA-V2-PLAN.md antes de hacer nada —
es el plan ya acordado para integrar el adaptador WorkanaV2 (POC ya
validado en src/scrapers/workana-v2-scraper.ts y src/sources/workana-v2.ts,
hoy sin conectar) al pipeline de scraping existente.

Ejecuta ÚNICAMENTE la [FASE N] de ese plan (sección "7. Fases de
ejecución"). No adelantes fases siguientes aunque tengas contexto de sobra.

Reglas duras (ya están en el plan, repetidas aquí porque importan):
- No hagas commit ni push de nada sin que yo lo apruebe explícitamente
  después de revisar el diff.
- No modifiques el adaptador Workana original (src/sources/workana.ts) sin
  antes mostrarme la decisión pendiente de la sección 3.3 del plan y
  esperar mi respuesta.
- Si algo requiere leer .env, private/**, secrets/** o backups/**, detente
  y pregúntame — no lo intentes de otra forma.
- Corre tú mismo cualquier verificación/test relevante de la fase (no me
  pidas a mí que confirme que algo "debería funcionar") y muéstrame el
  resultado real.
- Si la fase es la 3 (verificación en GitHub Actions), no dispares el
  workflow contra main sin mi confirmación explícita del criterio de éxito
  descrito en el plan.

Al terminar la fase, dime en 3-5 líneas qué hiciste, qué verificaste (con
resultado real, no supuesto) y qué queda pendiente para la siguiente fase.
No sigas de largo hacia la fase siguiente.
```
