# Job boards remotos → Notion "Vacantes" — guía operativa

Puente que lleva vacantes remotas QA/AI de **RemoteOK**, **Remotive** y
**We Work Remotely** a la base curada "Vacantes" (mismo tipo de registro que lo
que ya hay ahí, a diferencia de las licitaciones de SECOP). Implementado
2026-07-19.

## Acceso compatible (robots.txt verificado en vivo 2026-07-19)

- **RemoteOK**: API JSON pública `https://remoteok.com/api`. Su `robots.txt` para
  `User-agent: *` es `Allow: /` (solo bloquea bots de IA/SEO con nombre —
  GPTBot, ClaudeBot, AhrefsBot…; usamos un UA propio identificable). Atribución
  dofollow requerida → la columna URL enlaza de vuelta y "Fuente principal" dice
  "RemoteOK".
- **Remotive**: su `robots.txt` bloquea `/api/*`, así que **NO** usamos la API;
  usamos los **feeds RSS por categoría** (`/remote-jobs/<cat>/feed`, categorías
  `qa`, `artificial-intelligence`, `software-development`), que no están
  bloqueados.
- **We Work Remotely**: feed RSS general público (`/remote-jobs.rss`); su página
  oficial pide "attribute the links back". Sin categoría QA/AI → se filtra el
  feed por palabra clave.

Ninguna evadió Cloudflare/anti-bot (AGENTS.md reglas 6, 8).

## Cómo correr

```bash
pnpm discover:boards            # vista previa (no escribe)
pnpm discover:boards --execute  # crea/actualiza en Vacantes

# Incluye además las bloqueadas por el perfil, para triaje manual:
pnpm discover:boards -- --include-rejected            # vista previa
pnpm discover:boards -- --include-rejected --execute  # escribe
```

Ojo con el `--` extra: hace falta para que pnpm pase el flag al script en vez de
interpretarlo él.

Requiere `NOTION_TOKEN` y `NOTION_DATA_SOURCE_ID` (base Vacantes) en `.env`.
Estado en `var/notion/vacantes-boards-state.json`; DLQ en `var/notion/boards-dlq.jsonl`.

## Qué hace (y qué NO toca)

1. Descarga vacantes de las tres fuentes y filtra por keywords QA/testing/IA.
2. Mapea a `CanonicalJob` (sin inventar: salario/seniority/idioma quedan
   `unknown`/`null` si la fuente no los declara; `workMode: remote` porque estos
   boards son 100% remotos por diseño). El tipo de contrato declarado
   (`<type>` del RSS de Remotive/WWR: contract/freelance/part_time) se normaliza
   a `employmentTypes`; RemoteOK no lo expone, así que ahí queda vacío. El
   resumen del comando lista los leads `freelance_o_contract` para el
   independiente.
3. **Puntúa cada vacante contra tu perfil** (`config/profile.local.yaml`) con el
   mismo motor de matching que `notion:sync`, y **excluye las bloqueadas**
   (rankResults high_recall).
4. Proyecta las que pasan a Vacantes reutilizando `planSync`/`executeSync`:
   - Solo escribe campos del sistema; **nunca sobreescribe campos humanos**.
   - Antes de crear, consulta por "Job ID" (UUID determinista) para **no
     duplicar** ni las 135 páginas curadas previas ni corridas anteriores.
   - Idempotente: re-correr con contenido igual = no-op.

## Resultado de la primera carga (2026-07-19)

47 vacantes QA/AI descargadas (RemoteOK 10, Remotive 10, WWR 27). Tras puntuar
contra el perfil, **41 quedaron bloqueadas** (todas por el must-have
"Manual Testing" del perfil; algunas además por seniority manager/director), y
**6 se cargaron** a Vacantes (Remotive 5, WWR 1; RemoteOK 0 tras el filtro).
Vacantes pasó de 135 a 141 páginas; las 135 curadas quedaron intactas.

## Segunda carga — tier de revisión (2026-07-20)

51 vacantes QA/AI descargadas (RemoteOK 13, Remotive 10, WWR 28). Sí hubo
publicaciones nuevas respecto al 19-jul, pero **las 6 que pasaban el filtro
estricto ya estaban en Notion** (`noop`): 0 altas por la vía normal. El cuello de
botella es el perfil, no la fuente — **45 de 51 se rechazaron por el must-have
"Manual Testing"**.

Decisión del usuario: subirlas con marca de revisión en vez de ablandar el
perfil. Se corrió `--include-rejected --execute` → **45 creadas, 0 fallos**
(Vacantes: 141 → 186).

## Cómo obtener más volumen

El filtro fuerte es el perfil. Dos vías:

- **`--include-rejected`** (implementada): sube también las bloqueadas. Llegan
  con `Prioridad = "Descartada"` y el motivo en `Blockers`, así que en Notion se
  filtran/ordenan por esos campos para triaje manual. **No toca el perfil ni el
  motor de matching**, así que no puede regresionar `eval:matching`.
  Contrapartida: entra ruido temático real (editor de video IA, Rails, product
  manager) porque el filtro previo es solo por keyword QA/IA.
- Ajustar `config/profile.local.yaml` (p. ej. quitar "Manual Testing" de
  must-have, o ampliar seniority). Ojo: esto **sí** afecta el eval de matching
  de Fase 4 (hoy precision@10 = 1.0, escaped_blockers 0/6) y hay que re-correr
  `pnpm eval:matching` para comprobar que no regresiona.

## Límites

Puente sin Postgres (idempotencia por archivo, sin historial `job_versions` ni
dedupe cruzado con las otras fuentes de Vacantes). Fechas `firstSeen/lastVerified`
se anclan a la fecha de publicación del aviso para que el hash sea estable; la
hora real de la última corrida se ve en "Actualizado por sistema".
