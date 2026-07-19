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
```

Requiere `NOTION_TOKEN` y `NOTION_DATA_SOURCE_ID` (base Vacantes) en `.env`.
Estado en `var/notion/vacantes-boards-state.json`; DLQ en `var/notion/boards-dlq.jsonl`.

## Qué hace (y qué NO toca)

1. Descarga vacantes de las tres fuentes y filtra por keywords QA/testing/IA.
2. Mapea a `CanonicalJob` (sin inventar: salario/seniority/idioma quedan
   `unknown`/`null` si la fuente no los declara; `workMode: remote` porque estos
   boards son 100% remotos por diseño).
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

## Cómo obtener más volumen

El filtro fuerte es el perfil. Si quieres ver más vacantes de estos boards:

- Ajusta `config/profile.local.yaml` (p. ej. quitar "Manual Testing" de
  must-have, o ampliar seniority), y re-corre `pnpm discover:boards --execute`.
- O pídeme una variante que incluya también las de decisión "discard"/"consider"
  (no solo las bien rankeadas), aceptando más ruido.

## Límites

Puente sin Postgres (idempotencia por archivo, sin historial `job_versions` ni
dedupe cruzado con las otras fuentes de Vacantes). Fechas `firstSeen/lastVerified`
se anclan a la fecha de publicación del aviso para que el hash sea estable; la
hora real de la última corrida se ve en "Actualizado por sistema".
