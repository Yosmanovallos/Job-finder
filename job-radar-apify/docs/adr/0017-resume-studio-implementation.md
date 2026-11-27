# ADR 0017 — Levantar el congelamiento de implementación del AI Resume Studio

**Fecha:** 2026-11-21
**Estado:** aceptado por el propietario (2026-11-21). Reemplaza las decisiones 2 y 5
del [ADR 0015](0015-resume-studio-design-thaw.md); el resto de ese ADR sigue vigente.
**Rama de integración:** `codex/resume-studio` (desde `origin/main` `ec9394b`, con el
paquete de diseño del PR #135 traído por cherry-pick).
**Referencias:** `docs/resume-studio/` (docs 01–11), en especial
[doc 11 §1.1, §5 y §8](../resume-studio/11-jobstep-replica.md) y
[doc 10](../resume-studio/10-implementation-roadmap.md).

## Contexto

- El ADR 0015 (2026-11-14) descongeló el Resume Studio **solo para diseño**.
  La implementación quedó congelada hasta un ADR nuevo con autorización
  explícita del propietario.
- El 2026-11-21 el propietario revisó el paquete de diseño (incluido el doc 11,
  réplica del flujo «link de vacante → CV adaptado») y aprobó **empezar la
  implementación**: R0 ahora; R1–R4 en sesiones posteriores, una fase por
  sesión (CLAUDE.md), y R5 como único merge a `main`.
- El código del CV Generator anterior (retirado el 2026-10-18, commit
  `053a21a`) y sus tablas `cv_*`, `llm_*`, `user_ai_credentials` y
  `cv_pii_vault` en Supabase **no** forman parte de esta autorización.

## Decisión

### 1. Se autoriza implementar el módulo nuevo, por fases, fuera de `main`

Se levanta el congelamiento de **implementación** del módulo nuevo «AI Resume
Studio», con este alcance y orden (doc 11 §8, que sustituye la tabla de fases
del doc 10 donde difieran):

| Fase | Contenido |
| --- | --- |
| R0 | Este ADR, textos de congelamiento, D2 corregido, cambio OpenSpec `resume-studio-r1`. Solo docs. |
| R1 | Tablas `rs_*` (solo en contenedor desechable), CV base: subir/extraer/confirmar, 3 plantillas, vista previa. Requiere antes D6 (auditoría de solo lectura de las tablas viejas). |
| R2 | Resolver de links (doc 11 §5.3) + pegar texto; `JobSnapshot`; caché por URL canónica. |
| R3 | Gateway Qwen, máquina de estados, tarjetas, validador de factualidad, dos puntajes. |
| R4 | Wompi sandbox: pases, `rs_entitlements`, cupos. R4b: «Mis postulaciones». |
| R5 | Un solo merge aprobado de `codex/resume-studio` a `main`. |

Cada fase se construye en `codex/resume-studio-rN` **a partir de
`codex/resume-studio`** (no de `origin/main`; excepción explícita a la regla
general de AGENTS.md) y vuelve a la rama de integración por PR.

### 2. Flujo del producto: «link de vacante → CV adaptado»

Como el doc 11 §1.1 y §5:

- **Máquina de estados, no agente libre.** El código decide los pasos y su
  orden (S1 requisitos → S2 evidencia → S3 puntaje → S4 guion → S5 tarjetas →
  S6 puntaje final). El LLM solo extrae, redacta y propone dentro de cada
  paso, con salida JSON validada por esquema. Una llamada por tarjeta (máx. 2
  con reintento por JSON inválido); chat libre solo dentro de la tarjeta activa
  y con tope de turnos por adaptación.
- **Tarjetas Aplicar / Editar / Omitir**, paso «N de M», diff resaltado.
- **`requirement_mapping`**: por cada requisito importante, «¿Dónde
  demostraste *{requisito}*?» con las experiencias del CV como opciones +
  «En ninguna» + «Lo hice en otro lugar». Habilidades faltantes con casillas
  una por una, **sin «Añadir todo»**.
- **Validador de factualidad en código**: una reescritura solo puede usar
  hechos citados del CV base o la respuesta del usuario; un dato nuevo se
  descarta o se convierte en pregunta (AGENTS.md regla 5).
- **Dos puntajes deterministas**, calculados por código con fórmula pública:
  «Compatibilidad estimada» (doc 05 §4) y «Calidad de tu hoja de vida»
  (legibilidad/estructura). Nunca se presentan como puntaje «ATS».

### 3. Links de LinkedIn y sitios con login → pegar texto

Para LinkedIn, sitios con login o con controles anti-bot **no se descarga
nada**: se guarda la URL y se pide al usuario pegar la descripción. El
LinkedIn User Agreement §8.2 prohíbe extraer con scripts, bots, *plugins* o
*add-ons*, y AGENTS.md regla 8 prohíbe saltar autenticación o anti-bot. El
resto de sitios sigue el orden fijo del doc 11 §5.3 (base propia → API de ATS
→ HTML con controles SSRF y JSON-LD → texto recortado).

### 4. IA: Qwen en Alibaba Cloud Model Studio, Virginia, alcance «US»

- Proveedor: **Alibaba Cloud Model Studio**, región **Virginia (us-east-1)**,
  con alcance de inferencia **«United States (inference within the region)»**,
  que se elige **por workspace**. La API key es la del workspace.
- Endpoint compatible con OpenAI:
  `https://{WorkspaceId}.us-east-1.maas.aliyuncs.com/compatible-mode/v1`.
- Modelos (alias en el gateway, nunca nombres fijos en el código de producto):
  - por defecto: **qwen3.7-flash**. El 2026-11-21 no aparecía en la página de
    modelos: **confirmar en la consola us-east-1 al empezar R3**; si no está,
    el valor por defecto es **qwen3.8-flash** (USD 0,15/0,47 por millón,
    ~USD 0,014 ≈ COP 58 por adaptación sin caché, doc 11 §8);
  - reescrituras: **qwen3.7-plus**.
- **Topes de costo en código**: por sesión, usuario, día y mes, más un
  interruptor global (`RESUME_AI_PROVIDER=none` → solo edición manual).
  Criterio de salida de R3: costo medido ≤ COP 150 por adaptación.
- Alibaba guarda prompts **hasta 30 días** (retención cero solo en plan
  enterprise) y ofrece DPA con cláusulas contractuales tipo. Esto queda como
  punto obligatorio de la revisión legal (D4) y de la política de privacidad.
- **Descartados por el propietario:** API directa de DeepSeek (almacena en
  China y puede usar el contenido para entrenar), Moonshot/Kimi (servidores
  en Singapur y uso del contenido para entrenar) y cualquier tier gratuito
  (p. ej. el de Gemini, cuyos términos permiten usar el contenido y revisarlo
  por humanos). Fuente: `docs/resume-studio/research/ai-pricing-legal-2026-11-14.md`.
- Toda vacante y todo CV van al modelo entre delimitadores como **datos**,
  nunca como instrucciones (AGENTS.md reglas 6 y 11).

### 5. Cobro: pases de pago único con Wompi, sin renovación automática

- Producto aparte, con banderas propias (`RESUME_STUDIO_ENABLED`,
  `RESUME_STUDIO_PAYMENTS`); **no** comparte bandera con el paywall de
  vacantes. `PAYWALL_ENABLED` sigue en `false`: vacantes, búsqueda y enlaces
  de aplicación siguen gratis y sin condiciones.
- **Pases de pago único** con Wompi, **sin renovación automática**:
  - pase de 7 días: precio por definir (propuesta del doc 11: COP 6.900);
  - pase de 1 mes: COP 14.900 (propuesta);
  - pase de 3 meses: COP 29.700 en un pago (propuesta).
- El **precio final (D2) sigue abierto**; estos valores son la propuesta
  vigente y sustituyen la anterior de COP 9.900 por CV.
- Sin temporizadores falsos, cifras fijas de «personas viendo» ni retención
  en la baja (doc 11 §6). Retracto según la ley, a validar con abogado (D4).

### 6. Regla vigente: nada a producción hasta el 100 %

- Ninguna fase R0–R4 se mergea a `main`, ni siquiera apagada por bandera.
- Migraciones **solo aditivas**; las tablas `rs_*` se prueban en el Postgres
  desechable de `npm run test:integration` y **no se ejecutan en Supabase**
  hasta R5.
- Pagos solo en el sandbox de Wompi; IA solo con datos sintéticos hasta la
  beta cerrada.
- **Un solo merge final**, aprobado explícitamente por el propietario, cuando
  R0–R4 estén completos y verdes.
- Sin cambios al plan de Render (Starter), a scrapers/adaptadores, a la
  búsqueda ni a la caché del dashboard.

## Lo que sigue congelado

- El **código del CV Generator anterior**: no se restaura ni se hace
  cherry-pick desde `053a21a`; solo puede leerse para auditar.
- Las **tablas viejas** (`cv_*`, `llm_*`, `user_ai_credentials`,
  `cv_pii_vault`): no se reutilizan sin la auditoría D6 de RLS, grants y
  contenido.
- El **contrato público de agentes** (REST, MCP, A2A, WebMCP, llms.txt) sigue
  sin CV. Solo se actualiza en R5 si algo público cambia.

## Textos de congelamiento actualizados en R0

- `AGENTS.md` (raíz): la línea «do not reintroduce it» se acota al código
  viejo y apunta a este ADR.
- `docs/PROD-IMPROVEMENTS-PLAN.md`: la línea «Congelado: CV Generator» se
  acota igual.
- `docs/AGENT-READINESS-RUNBOOK.md`: **sin cambios**; lo público sigue sin CV.

Estos cambios viven en `codex/resume-studio` y solo llegan a `main` con el
merge de R5. Mientras tanto, `main` conserva los textos del ADR 0015, lo cual
es correcto: en `main` no hay nada del Resume Studio.

## Decisiones abiertas

| # | Decisión | Responsable |
| --- | --- | --- |
| D2 | Precio final de los pases (incluido el de 7 días) | Propietario |
| D4 | Revisión legal: autorización Ley 1581, transmisión a EE. UU., retención de 30 días de Alibaba, retracto, publicidad con influenciadores | Abogado |
| D5 | IVA, retenciones y factura electrónica | Contador |
| D6 | Auditoría de solo lectura de las tablas viejas en Supabase (antes de R1) | Propietario aprueba; agente ejecuta |
| D7 | ¿Solo Colombia en el MVP? | Propietario |
| — | Modelo por defecto exacto (qwen3.7-flash o qwen3.8-flash) | Se confirma en consola en R3 |
| — | % de afiliados y presupuesto de UGC | Propietario |

## Consecuencias

- Los agentes pueden escribir código del módulo nuevo en ramas
  `codex/resume-studio-rN`, siguiendo el cambio OpenSpec de cada fase.
- `main` y producción no cambian hasta R5.
- El costo de IA queda acotado por código, no por confianza en el proveedor.

## Rollback

- Antes de R5: borrar `codex/resume-studio` y sus ramas `-rN`. No hay nada
  desplegado ni migrado.
- Después de R5: `RESUME_STUDIO_ENABLED=false` (404 en todo el módulo),
  `RESUME_STUDIO_PAYMENTS=false`, `RESUME_AI_PROVIDER=none`. Las tablas `rs_*`
  se conservan (migraciones aditivas).
