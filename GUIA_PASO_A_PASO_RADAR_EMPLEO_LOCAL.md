# Guía paso a paso para construir el Radar de Empleo Local

## Estado real del proyecto

Hasta ahora **no se ha programado todavía el sistema**. Lo que está construido es la especificación técnica completa:

- la arquitectura;
- las tecnologías;
- la estructura de carpetas;
- los scrapers y conectores;
- la base de datos;
- el ranking de vacantes;
- la integración con Notion;
- los agentes, skills y MCPs;
- los prompts que debe seguir el agente de programación;
- las pruebas y criterios para aceptar cada fase.

El siguiente paso es darle el archivo `PLAN_RADAR_EMPLEO_LOCAL.md` a **Claude Code** —no “Cloud Code”— para que empiece a construir el software.

---

# Paso 1. Elige un solo agente de desarrollo

Mi recomendación para la primera implementación es:

**Claude Code como agente principal.**

No uses Claude Code y OpenCode simultáneamente sobre los mismos archivos. Podrías usar OpenCode posteriormente para revisiones independientes, pero al principio solo añadiría confusión.

Claude Code se encargará de:

1. leer el plan;
2. crear el proyecto;
3. escribir el código;
4. ejecutar pruebas;
5. corregir errores;
6. documentar cada fase.

---

# Paso 2. Prepara tu computador

Necesitas instalar:

- Git;
- Node.js 22 o superior;
- pnpm;
- Docker Desktop;
- Claude Code;
- un editor como Visual Studio Code.

El proyecto funcionará sin GPU. Lo recomendable son 16 GB de RAM o más.

## Instalar Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

Luego verifica la instalación:

```bash
claude --version
claude doctor
```

## Instalar pnpm

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

## Verificar todo

```bash
node --version
npm --version
pnpm --version
git --version
docker --version
docker compose version
claude --version
```

En Windows, Docker Desktop funciona normalmente con WSL 2.

---

# Paso 3. Crea la carpeta del proyecto

Abre una terminal y ejecuta:

```bash
mkdir job-radar-local
cd job-radar-local
git init
```

Copia dentro de esa carpeta el archivo:

```text
PLAN_RADAR_EMPLEO_LOCAL.md
```

La carpeta debe verse así:

```text
job-radar-local/
├── .git/
└── PLAN_RADAR_EMPLEO_LOCAL.md
```

No necesitas crear manualmente las demás carpetas. Claude Code deberá hacerlo.

---

# Paso 4. Abre Claude Code en modo de planificación

Desde la carpeta `job-radar-local` ejecuta:

```bash
claude --permission-mode plan
```

No uses esta opción:

```bash
claude --dangerously-skip-permissions
```

El proyecto eventualmente manejará CV, datos personales, tokens de Notion y claves de modelos. Conviene conservar las aprobaciones de seguridad.

---

# Paso 5. Envía el primer prompt

Este es el **primer mensaje exacto** que debes copiar y pegar:

```text
Lee PLAN_RADAR_EMPLEO_LOCAL.md completo.

Ejecuta únicamente el prompt D00 y trabaja exclusivamente en la Fase 0.

Por ahora estás en modo de planificación:
- no escribas código;
- no instales dependencias;
- no modifiques archivos;
- no implementes conectores;
- no configures Notion;
- no agregues llamadas a modelos de IA.

Primero presenta:

1. las decisiones técnicas concretas;
2. el árbol de archivos que crearás;
3. los paquetes y dependencias iniciales;
4. el esquema y las migraciones iniciales;
5. los comandos de verificación;
6. los riesgos y supuestos;
7. los criterios que demostrarán que la Fase 0 está terminada.

Respeta PLAN_RADAR_EMPLEO_LOCAL.md como fuente de verdad.
No avances a otra fase.
```

Claude Code deberá responderte con un plan, pero todavía no debería escribir código.

---

# Paso 6. Revisa el plan que te presente

Comprueba que proponga estas decisiones:

- monorepo TypeScript;
- Node.js 22 o superior;
- pnpm workspaces;
- PostgreSQL;
- Docker Compose;
- Drizzle ORM;
- Vitest;
- Zod;
- CLI inicial;
- logs estructurados;
- archivos `AGENTS.md` y `CLAUDE.md`;
- `.env.example`;
- `.gitignore`;
- configuración estricta de TypeScript.

Debe mantener el proyecto como un **monolito modular**, no como una colección de microservicios.

Tampoco debería implementar todavía:

- Greenhouse;
- Lever;
- Notion;
- scrapers;
- modelos de IA;
- generación de CV;
- automatización de candidaturas.

---

# Paso 7. Autoriza la implementación de la Fase 0

Cuando el plan sea razonable, cambia Claude Code a modo de edición. Dentro de Claude Code puedes cambiar el modo de permisos, o cerrar la sesión e iniciarlo normalmente:

```bash
claude
```

Luego envía:

```text
El plan de Fase 0 queda aprobado.

Implementa únicamente la Fase 0 siguiendo el plan presentado y PLAN_RADAR_EMPLEO_LOCAL.md.

Trabaja mediante cambios pequeños y verificables.

Al terminar:

1. instala las dependencias;
2. levanta PostgreSQL con Docker Compose;
3. ejecuta las migraciones desde cero;
4. ejecuta lint;
5. ejecuta typecheck;
6. ejecuta las pruebas;
7. verifica que ningún secreto o archivo privado quede incluido en Git;
8. presenta un resumen de archivos creados;
9. presenta los comandos ejecutados y sus resultados;
10. enumera cualquier deuda pendiente.

No avances a la Fase 1.
No marques la fase como terminada si algún comando falla.
```

---

# Paso 8. Verifica tú mismo la Fase 0

Cuando Claude Code termine, ejecuta:

```bash
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm lint
pnpm typecheck
pnpm test
git status
```

Comprueba también:

```bash
docker compose ps
```

La Fase 0 estará completa cuando:

- PostgreSQL esté funcionando;
- las migraciones funcionen desde una base vacía;
- lint pase;
- typecheck pase;
- las pruebas pasen;
- exista `.env.example`;
- `.env` esté ignorado por Git;
- exista un CLI básico;
- el proyecto tenga documentación inicial.

Haz el primer commit:

```bash
git add .
git commit -m "chore: bootstrap job radar local"
```

---

# Construcción funcional, fase por fase

## Paso 9. Implementa el perfil profesional

Ahora Claude Code construirá la parte que describe qué empleo buscas.

Envía:

```text
Lee nuevamente PLAN_RADAR_EMPLEO_LOCAL.md y revisa el estado actual del repositorio.

Implementa exclusivamente el prompt D01 y la Fase 1: perfil y dominio.

Antes de escribir código, presenta brevemente:
- archivos que modificarás;
- schemas que crearás;
- pruebas que agregarás.

Después implementa:

1. schemas Zod para el perfil profesional;
2. loader de archivos YAML;
3. schema canónico de vacantes;
4. validación de hechos autorizados del CV;
5. mensajes de error accionables;
6. pruebas válidas, inválidas y adversariales;
7. protección completa del directorio private/.

No agregues conectores, Notion ni llamadas reales a modelos.

Ejecuta lint, typecheck y tests.
No avances a otra fase.
```

Después copia la configuración de ejemplo:

```bash
cp config/profile.example.yaml config/profile.local.yaml
```

Edita `config/profile.local.yaml` con tus datos:

```yaml
roles:
  target_titles:
    - "Tu cargo principal"
    - "Otro cargo objetivo"

  title_synonyms:
    - "Nombre alternativo del cargo"

  adjacent_titles:
    - "Cargo relacionado"

  excluded_titles:
    - "Cargos que no quieres"

seniority:
  preferred:
    - junior
    - mid

skills:
  must_have:
    - "Skill obligatoria"

  strong:
    - "Skill fuerte 1"
    - "Skill fuerte 2"

  nice_to_have:
    - "Skill que deseas desarrollar"

locations:
  countries:
    - CO

  cities:
    - Bogota

  remote_worldwide: true
  remote_latam: true
  hybrid: true
  onsite: false

languages:
  Spanish: native
  English: B2
```

Valídalo:

```bash
pnpm profile:validate --profile config/profile.local.yaml
```

---

# Paso 10. Añade tu CV y los hechos autorizados

Crea:

```text
private/
└── cv/
    ├── master.md
    ├── facts.yaml
    └── variants/
```

En `private/cv/master.md`, guarda tu CV maestro.

En `private/cv/facts.yaml`, guarda solamente hechos verdaderos:

```yaml
experience:
  - id: experience_001
    company: "Empresa real"
    title: "Cargo real"
    start_date: "2023-01"
    end_date: "2025-06"
    responsibilities:
      - "Responsabilidad real"
    achievements:
      - id: achievement_001
        statement: "Logro real y verificable"
        metric: "20%"

skills:
  - id: skill_sql
    name: SQL
    evidence:
      - experience_001

education:
  - id: education_001
    institution: "Institución real"
    program: "Programa real"

languages:
  - language: Spanish
    level: native
  - language: English
    level: B2
```

La IA solo podrá usar estos hechos para personalizar el CV y las cartas. Si no tienes una habilidad, deberá mostrarla como brecha en vez de inventarla.

Vuelve a ejecutar:

```bash
pnpm profile:validate --profile config/profile.local.yaml
```

Haz otro commit:

```bash
git add .
git commit -m "feat: add profile and domain schemas"
```

Los archivos de `private/` no deberían aparecer en el commit.

---

# Paso 11. Implementa Greenhouse

Greenhouse será la primera fuente porque ofrece información estructurada y es más estable que intentar raspar LinkedIn.

Envía:

```text
Implementa exclusivamente el prompt D02 para SOURCE=greenhouse.

Usa la skill build-source-adapter y el subagente source-researcher.

Antes de escribir código:

1. consulta la documentación oficial actual de Greenhouse;
2. crea docs/source-catalog/greenhouse.md;
3. explica el endpoint y la estrategia de paginación;
4. enumera los campos disponibles;
5. identifica límites, errores y campos faltantes;
6. presenta los archivos que modificarás.

Después:

- implementa el adaptador usando API, no navegador;
- guarda fixtures sanitizados;
- implementa timeout, retries y límites;
- añade healthcheck;
- añade contract tests;
- conserva la evidencia y URL original;
- soporta modo dry-run;
- limita el canary a 20 resultados.

Ejecuta lint, typecheck, tests y un canary en dry-run.
No implementes otra fuente.
```

Después prueba:

```bash
pnpm sources:list
pnpm source:health --source greenhouse
pnpm discover \
  --profile default \
  --source greenhouse \
  --limit 20 \
  --dry-run
```

Revisa que cada resultado tenga como mínimo:

- título;
- empresa;
- URL;
- descripción;
- ubicación, cuando exista;
- fuente;
- identificador externo;
- fecha, cuando exista;
- evidencia original.

---

# Paso 12. Implementa Lever

Usa el mismo prompt, cambiando la fuente:

```text
Implementa exclusivamente el prompt D02 para SOURCE=lever.

Sigue exactamente el mismo contrato utilizado por Greenhouse.
API-first. No navegador.

Antes de escribir código, documenta la fuente y presenta el plan de archivos.

Incluye:
- fixtures;
- paginación;
- timeout;
- retries;
- healthcheck;
- contract tests;
- evidencia;
- dry-run;
- canary limitado.

No modifiques el modelo de dominio salvo que demuestres una incompatibilidad real.
No implementes otra fuente.
```

Prueba:

```bash
pnpm source:health --source lever
pnpm discover \
  --profile default \
  --source lever \
  --limit 20 \
  --dry-run
```

En este punto ya deberías poder encontrar ofertas reales de empresas que utilicen Greenhouse o Lever.

---

# Paso 13. Implementa almacenamiento, deduplicación y vigencia

Ahora las ofertas dejarán de ser resultados temporales y se guardarán correctamente.

Envía:

```text
Implementa exclusivamente el prompt D03 y la Fase 3.

Antes de editar, solicita una revisión del diseño al subagente data-quality-reviewer.

Implementa:

1. almacenamiento de documentos raw;
2. tabla canónica de vacantes;
3. historial de versiones;
4. canonicalización de URLs;
5. deduplicación exacta;
6. deduplicación aproximada;
7. verificación de vigencia;
8. estado de fuente;
9. circuit breaker;
10. trazabilidad y evidencia por campo.

Añade fixtures que representen:

- la misma vacante obtenida desde dos fuentes;
- una vacante cuya descripción cambió;
- una vacante cerrada;
- dos vacantes parecidas que no deben fusionarse.

No uses modelos de lenguaje.

Demuestra idempotencia ejecutando dos veces el mismo pipeline.
Ejecuta lint, typecheck y tests.
No avances a otra fase.
```

Luego ejecuta:

```bash
pnpm discover --profile default --dry-run
pnpm ingest --run latest
pnpm dedupe --run latest
pnpm verify --due
```

Vuelve a ejecutar el mismo ciclo:

```bash
pnpm ingest --run latest
pnpm dedupe --run latest
```

El número de vacantes no debería duplicarse.

---

# Paso 14. Implementa el ranking sin IA

Antes de gastar dinero en modelos, el sistema debe funcionar con reglas.

Envía:

```text
Implementa exclusivamente el prompt D04 y la Fase 4.

No utilices ningún modelo cloud.

Implementa:

1. filtros obligatorios;
2. normalización de títulos;
3. taxonomía básica de skills;
4. detección de seniority;
5. compatibilidad geográfica;
6. compatibilidad de idioma;
7. full-text search;
8. score configurable;
9. ranking;
10. feedback humano;
11. embeddings locales opcionales.

Crea un dataset de prueba sintético y herramientas para importar etiquetas humanas.

Genera un informe baseline que incluya:
- precision@10;
- precision@25;
- falsos positivos;
- blockers escapados;
- explicación de cada puntuación.

Ejecuta lint, typecheck, tests y evals.
No agregues todavía un LLM judge.
```

Ejecuta:

```bash
pnpm match --profile default
pnpm eval:matching
pnpm report:latest
```

Ya deberías obtener algo parecido a:

```text
Oferta: Data Analyst
Score: 84/100

Coincidencias:
- SQL requerido y presente
- Power BI requerido y presente
- remoto para LATAM
- seniority compatible

Brechas:
- dbt no aparece en el perfil

Bloqueadores:
- ninguno
```

Este es el primer punto en el que el sistema ya puede ser útil.

---

# Paso 15. Añade IA selectiva

La IA no analizará absolutamente todas las ofertas. Primero pasan por reglas baratas y solo las mejores reciben análisis profundo.

Envía:

```text
Implementa exclusivamente el prompt D05 y la Fase 5.

Usa la skill add-prompt.

Implementa:

1. model gateway desacoplado;
2. aliases funcionales de modelos;
3. prompts versionados;
4. JSON Schema para las respuestas;
5. caché por input_hash, modelo y versión;
6. relevance gate;
7. fit judge;
8. crítico selectivo;
9. límites diarios;
10. registro de tokens y costo;
11. protección contra prompt injection;
12. evals comparativos contra el baseline.

El modelo de alto razonamiento solo debe ejecutarse en casos configurados.
No envíes CV completo cuando no sea necesario.
No actives un prompt que no supere los gates de evaluación.

Ejecuta lint, typecheck, tests y evals.
Presenta el costo estimado de una ejecución diaria.
```

Para comenzar, usa modo económico:

```yaml
budgets:
  max_llm_jobs_per_run: 20
  max_reasoning_high_calls_per_run: 3
  max_daily_cloud_cost_usd: 1.00
  stop_on_budget_exceeded: true
```

Más adelante puedes aumentarlo.

---

# Paso 16. Conecta Notion

Primero crea en Notion una página para el radar de empleo. Después crea una integración y concede acceso solamente a esa página.

Guarda los valores en `.env`, nunca en Git:

```env
NOTION_TOKEN=
NOTION_DATA_SOURCE_ID=
```

Luego envía:

```text
Implementa exclusivamente el prompt D06 y la Fase 6.

Usa el SDK oficial de Notion y la API vigente.

Primero implementa:

1. inspección del schema;
2. validación del data source;
3. modo dry-run;
4. preview de cambios.

Después implementa:

5. create;
6. update;
7. no-op;
8. lectura de campos humanos;
9. manejo de rate limits y Retry-After;
10. dead-letter queue;
11. reconciliación sin borrar contenido humano.

PostgreSQL continúa siendo la fuente de verdad.
No permitas duplicados en Notion.
No ejecutes escrituras reales hasta que el dry-run sea revisado.
```

Ejecuta:

```bash
pnpm notion:schema:check
pnpm notion:sync --dry-run
```

Revisa el preview. Solamente entonces ejecuta:

```bash
pnpm notion:sync --execute
```

En Notion deberías ver columnas similares a:

- cargo;
- empresa;
- ubicación;
- modalidad;
- fuente;
- URL;
- fecha;
- score;
- compatibilidad;
- brechas;
- riesgos;
- estado;
- fecha de aplicación;
- notas;
- prioridad.

---

# Paso 17. Añade Ashby y SmartRecruiters

Repite D02 por separado.

## Primero Ashby

```text
Implementa exclusivamente D02 para SOURCE=ashby.
Usa el contrato actual de adaptadores.
API-first, fixtures, healthcheck, contract tests, dry-run y canary.
No implementes otra fuente.
```

## Después SmartRecruiters

```text
Implementa exclusivamente D02 para SOURCE=smartrecruiters.
Usa el contrato actual de adaptadores.
API-first, fixtures, healthcheck, contract tests, dry-run y canary.
No implementes otra fuente.
```

No envíes ambos en una sola sesión.

---

# Paso 18. Añade fuentes más difíciles

Solo después de que las cuatro fuentes anteriores funcionen:

1. JSON-LD de páginas de empleo;
2. sitemaps;
3. páginas de empresas prioritarias;
4. algún agregador con API;
5. Crawlee y Cheerio;
6. Playwright únicamente cuando no exista alternativa;
7. Apify como conector opcional.

No comiences por LinkedIn, Indeed o Glassdoor. No intentes evadir CAPTCHA, autenticación ni controles anti-bot.

Prompt recomendado:

```text
Implementa exclusivamente la Fase 7 para la fuente {{SOURCE_NAME}}.

Antes de escribir código:

1. investiga si existe una API pública o feed estructurado;
2. determina si hay JSON-LD, sitemap o endpoints internos permitidos;
3. documenta términos, riesgos y límites;
4. selecciona el método menos frágil;
5. presenta el plan y espera revisión.

Orden permitido:
API pública -> JSON-LD -> HTML con Cheerio -> Crawlee -> Playwright.

No evadas CAPTCHA, autenticación ni controles anti-bot.
Mantén el contrato existente de adaptadores.
Incluye fixtures, healthcheck, pruebas, límites, dry-run y evidencia.
Implementa una sola fuente.
```

---

# Paso 19. Añade preparación de candidaturas

Este módulo no enviará aplicaciones automáticamente.

Envía:

```text
Implementa exclusivamente el prompt D07 y la Fase 8.

No implementes auto-apply.

Implementa:

1. análisis de requisitos de la vacante;
2. patch sugerido para el CV;
3. carta o mensaje;
4. respuestas a preguntas comunes;
5. supporting_fact_ids;
6. factuality validator;
7. bloqueo cuando no exista evidencia;
8. aprobación humana explícita;
9. exportación Markdown;
10. DOCX opcional.

La IA no puede:
- inventar experiencia;
- inventar métricas;
- aumentar años de experiencia;
- cambiar el nivel de idiomas;
- afirmar skills no presentes;
- enviar formularios.

Añade una prueba donde la vacante exige una skill que el candidato no posee.
La salida debe mostrarla como brecha.
```

La salida debería ser un paquete revisable:

```text
Vacante
├── análisis de compatibilidad
├── brechas
├── cambios propuestos al CV
├── carta
├── respuestas sugeridas
└── hechos que respaldan cada afirmación
```

---

# Paso 20. Configura la ejecución diaria

Cuando todo funcione individualmente:

```bash
pnpm run:daily --profile default
```

El ciclo será:

1. buscar ofertas;
2. normalizar;
3. guardar;
4. deduplicar;
5. verificar vigencia;
6. calcular score base;
7. analizar las mejores con IA;
8. sincronizar Notion;
9. generar un resumen diario;
10. esperar tu feedback.

Frecuencia inicial sugerida:

```text
08:00 — búsqueda y sincronización
18:00 — búsqueda y sincronización
23:00 — backup
```

Usa la zona horaria:

```text
America/Bogota
```

---

# Paso 21. Ejecuta la auditoría final

Envía:

```text
Ejecuta exclusivamente el prompt D08 como release-reviewer.

No implementes nuevas funcionalidades.

Audita el proyecto completo contra PLAN_RADAR_EMPLEO_LOCAL.md.

Ejecuta:

1. lint;
2. typecheck;
3. pruebas unitarias;
4. pruebas de integración;
5. evals de matching;
6. secret scan;
7. dependency audit;
8. restore test;
9. Notion dry-run;
10. revisión de seguridad;
11. revisión de presupuesto;
12. revisión de idempotencia.

Entrega una matriz:

requisito -> evidencia -> resultado -> estado

Clasifica cada hallazgo como:
- critical;
- high;
- medium;
- low.

Bloquea el release si existe un hallazgo critical o high sin mitigación.
No cambies código durante esta auditoría.
```

---

# Orden exacto de prompts

Usa una sesión o contexto nuevo para cada etapa:

```text
1. D00 — Bootstrap
2. D01 — Perfil y dominio
3. D02 — Greenhouse
4. D02 — Lever
5. D03 — Persistencia, dedupe y vigencia
6. D04 — Matching sin IA
7. D05 — Matching con IA
8. D06 — Notion
9. D02 — Ashby
10. D02 — SmartRecruiters
11. Fase 7 — Fuentes adicionales, una por una
12. D07 — Candidatura asistida
13. Fase 9 — Operación y hardening
14. D08 — Auditoría final
```

---

# Regla fundamental

Nunca le envíes todos los prompts a Claude Code de una sola vez.

Después de cada fase:

```bash
pnpm lint
pnpm typecheck
pnpm test
git status
```

Cuando todo pase:

```bash
git add .
git commit -m "descripción de la fase terminada"
```

---

# Acción inmediata

Tu acción inmediata es únicamente esta:

```bash
mkdir job-radar-local
cd job-radar-local
git init
```

Copia allí el archivo del plan, abre:

```bash
claude --permission-mode plan
```

Y envía el prompt de **Fase 0** indicado en el Paso 5.
