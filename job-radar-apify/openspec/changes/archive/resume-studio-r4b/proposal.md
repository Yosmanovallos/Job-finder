# Resume Studio R4b: «Mis postulaciones» (tracker)

**Estado:** implementado y archivado (2026-11-22). La evidencia está en [`validation.md`](validation.md).
**ADR:** [`docs/adr/0017-resume-studio-implementation.md`](../../../../docs/adr/0017-resume-studio-implementation.md).
**Rama:** `codex/resume-studio-r4b`, cortada de `codex/resume-studio-r4`
(PR #151). El PR va en borrador contra `codex/resume-studio`. Nada va a
`main` ni a Supabase.
**Guías:** doc 11 §1 (fila 3: tablero «Tus solicitudes» del video) y §5.1
(fila «Mis postulaciones»); prototipo
`docs/resume-studio/mockups/resume-tailor-link-prototype.html`, pantalla
«5 · Postulaciones».

## Problema

Después de R4 el CV adaptado vive en el navegador y se pierde al cerrar la
pestaña. No hay dónde ver qué vacantes guardé, a cuáles me postulé ni en qué
va cada proceso. En JobStep el CV adaptado vive dentro de un tablero de
postulaciones (doc 11 §1, fila 3): eso da retención más allá de un solo CV.

## Alcance

### 1. Tabla `rs_applications` (aditiva, bloque `resume-studio`)

| Columna | Tipo | Nota |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID NOT NULL → `users` ON DELETE CASCADE | Toda consulta filtra por él. |
| `job_title` | VARCHAR(200) NOT NULL | Copia: la caché de vacantes es compartida y vence en 24 h, no sirve como referencia. |
| `job_company` | VARCHAR(200) NULL | |
| `job_url` | VARCHAR(2000) NULL | Solo `http:`/`https:` (CHECK y Zod). Nunca se consulta desde esta ruta. |
| `job_url_key` | CHAR(64) NULL | SHA-256 de la URL. Índice único parcial `(user_id, job_url_key)`: guardar y luego «Marcar como postulé» actualizan la misma fila. |
| `adaptation_id` | UUID NULL, sin FK | Solo se acepta si es una adaptación del usuario (fila `start` del ledger R3); si no, 404. |
| `resume_id`, `resume_version_no` | UUID / INTEGER NULL, sin FK | Versión base de la que salió la adaptación. Borrar la base no borra el tracker. |
| `adapted_facts_json` | JSONB NULL | El CV adaptado, validado con `resumeFactsSchema` (≤ 64 KB). Solo con la autorización «Guardar en mi cuenta». |
| `score_before`, `score_after` | SMALLINT NULL, 0–100 | Compatibilidad estimada antes y después (fórmula pública del doc 05). |
| `status` | VARCHAR(12) CHECK `saved`, `applied`, `interview`, `offer`, `discarded` | |
| `note` | VARCHAR(280) NOT NULL DEFAULT '' | Nota corta del usuario. |
| `applied_at` | TIMESTAMPTZ NULL | Se fija la primera vez que pasa a `applied` o más allá. |
| `status_changed_at`, `created_at`, `updated_at` | TIMESTAMPTZ | |

- RLS activo y `REVOKE ALL … FROM anon, authenticated`. También en la lista
  `TABLES` de `scripts/migrate-resume-studio.ts`.
- Tope de **200 postulaciones por usuario** (409 `limit`).

### 2. Rutas `/api/resume/applications` (CRUD propio)

- `GET /applications`: lista del usuario, sin el CV adaptado (solo `hasCv`).
- `GET /applications/:id`: una, con el CV adaptado.
- `POST /applications`: crea, o actualiza por `job_url_key` si ya existe.
- `PATCH /applications/:id`: `status` y/o `note`.
- `DELETE /applications/:id`.
- Un id ajeno o inventado responde **404**, igual que uno que no existe.
  `user_id` siempre sale de la sesión; uno en el cuerpo se rechaza (esquema
  estricto).
- **Gratis para todos:** ninguna ruta mira el pase ni el cupo. Nunca 402.
- **Autorizaciones:** leer, exportar y borrar no las piden (derechos del
  titular). Escribir pide las dos obligatorias **y** «Guardar en mi cuenta»,
  porque la autorización dice que sin esa casilla nada queda en el servidor.
- Límite de escritura propio (`resume-applications`, 120 cada 10 min) para
  que mover tarjetas no gaste el cupo de guardado del editor.

### 3. Puntos de entrada en la UI

- Al terminar una adaptación (agente de tarjetas): botón **«Guardar en Mis
  postulaciones»**, con la vacante, el CV adaptado y los dos puntajes.
- Al abrir el link de la vacante («Ir a la vacante»): opción **«Marcar como
  postulé»**. Solo cambia un estado propio; no se envía nada.
- Página **`/hoja-de-vida/postulaciones`**: columnas Guardada / Postulé /
  Entrevista / Oferta / Descartada. Cada tarjeta muestra cargo, empresa, su
  CV adaptado (vista previa) y el puntaje. Para mover: **selector de estado**
  en cada tarjeta (teclado, lector de pantalla y celular) y, además,
  arrastrar y soltar en escritorio. En móvil las columnas se apilan.
- La vista previa del CV en el tablero lleva la misma marca «Vista previa»
  que el editor sin pase y no imprime ni descarga: el tracker gratis no es
  un atajo al CV limpio. «Usar en el editor» lo lleva al editor, donde
  siguen las reglas de R4.

### 4. Derechos del titular

- «Borrar todo» (`DELETE /api/resume/data`) borra también las postulaciones.
- «Exportar JSON» incluye `applications` con su CV adaptado.
- «Revocar» y desmarcar «Guardar en mi cuenta» borran las postulaciones
  (misma transacción que ya borra las hojas de vida).

## Fuera de alcance

- **Nada de autopostulación ni contacto a empleadores** (AGENTS.md regla 7):
  ni correos, ni recordatorios, ni envío de la hoja de vida. «Postulé» es un
  estado que pone el usuario.
- Ninguna migración en Supabase (R5). Sin dependencias nuevas.
- Sin cambios en el CSS global (hash sin cambios): solo clases existentes y
  estilos en línea.

## Riesgos y decisiones

- `adapted_facts_json` hereda el pendiente de R1: cifrado de aplicación de
  `facts_json` antes de R5.
- La URL de la vacante la escribe el usuario: solo `http(s)`, tope de
  longitud, y se muestra con `rel="noopener noreferrer nofollow"`.
- Todo detrás de `RESUME_STUDIO_ENABLED`; con la bandera apagada
  `/hoja-de-vida/postulaciones` y `/api/resume/applications` son 404 (T-FREE).

## Criterio de salida (doc 11 §8)

Flujo completo vacante → CV → postulé → entrevista, probado con
`npm run dev:resume-studio`. Gates: tsc, build, test:unit,
test:integration, test:resume-studio (T-IDOR de postulaciones y T-FREE).
