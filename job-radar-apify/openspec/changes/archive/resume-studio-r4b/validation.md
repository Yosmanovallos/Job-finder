# Validación: Resume Studio R4b (2026-11-22)

Rama `codex/resume-studio-r4b`, cortada de `codex/resume-studio-r4` en
`2346c7c`. Nada se corrió contra Supabase ni contra la base del `.env`:
todas las pruebas usan el Postgres desechable del runner.

## Gates

| Gate | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ sin errores |
| `npm run build` | ✅ el CSS global sigue en `index-BeuqwIzT.css` (sha256 `1d7ac0969c32df8a…c048`), igual que en R3 y R4 |
| `npm run test:unit` | ✅ exit 0, 703 pruebas, 0 fallos (la rama ya trae el arreglo de fechas de #148, `2346c7c`) |
| `npm run test:integration` | ✅ exit 0, incluye `validate-resume-studio-r4b.ts` y T-FREE |
| `npm run test:resume-studio` | ✅ exit 0: 11 archivos unitarios (nuevo `validate-resume-studio-applications.test.ts`) y 6 de integración (nuevo `validate-resume-studio-r4b.ts`) |
| `test:paywall` / `test:payment-flow` | ⛔ no se corrieron (leen el `.env` de producción); R4b no toca pagos |

## Integración (`validate-resume-studio-r4b.ts`)

| Prueba | Qué se comprueba |
|---|---|
| Esquema | El bloque se aplica dos veces sin error; RLS activo; 0 permisos para `anon`/`authenticated`; CHECKs rechazan estado desconocido, `javascript:`, puntaje 101 y cargo vacío |
| Autorizaciones | Sin sesión 401. Escribir sin las obligatorias: 403 `consent_required`; sin «guardar en mi cuenta»: 403 `storage_consent_required`. Leer no pide nada |
| CRUD | Crear 201; el mismo link (mayúsculas en el host, `#fragmento`) cae en la misma tarjeta: «Guardar» y luego «Marcar como postulé» → 200 `created:false`, `applied_at` fijado, se conservan CV y puntajes. La lista no trae el CV; el detalle sí |
| Mover | Postulé → Entrevista conserva `applied_at`; Descartada sin postular no inventa fecha; Oferta fija `applied_at`. Cuerpos inválidos 400; PUT 405 |
| **T-IDOR** | B hace GET/PATCH/DELETE sobre la tarjeta de A → 404 y la fila no cambia; la lista de B no ve a A; id inventado o mal formado 404; `userId` en el cuerpo 400; adaptación de A o inventada 404 `reference_not_found`; hoja de vida de A 404; el mismo link guardado por B crea la tarjeta de B |
| **Gratis** | Sin `rs_entitlements` y con el cupo gratis en 9999 usados: crear, mover y guardar CV funciona, nunca 402, el cupo no cambia |
| Tope | 200 tarjetas por usuario → 409 `limit` |
| Derechos | Exportar incluye las tarjetas con su CV (solo las propias); «Borrar todo» devuelve `deleted.applications` y las borra sin tocar a otro usuario; «Revocar» y quitar «guardar en mi cuenta» las borran |

## T-FREE

`/hoja-de-vida/postulaciones` y `/api/resume/applications` son 404 con la
bandera apagada; con la bandera encendida la API pide sesión (401) y la
página existe. Las 9 superficies de vacantes siguen idénticas.

## No verificado

- **Prueba local con `npm run dev:resume-studio`:** el lanzador se negó a
  arrancar en este worktree (sin `.env` de sandbox: llaves Wompi no
  `pub_test_` y sin `VITE_SUPABASE_*`), como debe. El flujo completo
  vacante → CV → postulé → entrevista en el navegador, a 1024 px y 375 px,
  queda para el propietario con su sesión real.
- El texto de la autorización «Guardar mi hoja de vida en mi cuenta» no
  menciona las postulaciones. Cambiarlo cambia el `text_hash` y conviene
  subir `RESUME_POLICY_VERSION`: decisión del propietario y del abogado
  (D4), no de esta fase.
- `adapted_facts_json` hereda el pendiente de cifrado de R1 antes de R5.

## Adenda (2026-11-22): login de desarrollo solo local

Pedido de la sesión principal: el propietario no podía probar en local (sin
cuenta de correo y contraseña; Google OAuth vuelve al dominio de producción).

- `src/auth/dev-auth.ts`: usuario fijo `dev@localhost.test`
  (`d0000000-0000-4000-8000-00000000de00`), solo en la base desechable.
  Activo solo si se cumplen **todas** estas condiciones:
  - `RESUME_STUDIO_DEV_AUTH=1`;
  - `DATABASE_URL` es loopback;
  - `NODE_ENV` no es `production`;
  - `WOMPI_PUBLIC_KEY` empieza por `pub_test_`;
  - la petición es loopback: socket local, `Host` localhost y sin `X-Forwarded-*`/`Forwarded`.

  Si la variable está pero falla una condición, se ignora y se registra una vez. El token es aleatorio por proceso y se compara en tiempo constante.
- `verifySession`: un token `rsdev_…` nunca va a Supabase. Sin `VITE_SUPABASE_*` el servidor arranca solo en ese modo.
- `/api/resume/dev-auth` y `/api/resume/dev-login`: 404 fuera de las guardas.
- UI: `/hoja-de-vida` se protege sola, igual que `RequireAuth`.
  - El botón «Entrar como usuario de prueba (solo local)» existe solo en el build del lanzador (`__RS_DEV_LOGIN__`, `define` de Vite) y aparece solo si el servidor responde 200.
  - El token vive en `sessionStorage`, así que sobrevive al retorno de Wompi.
- `npm run dev:resume-studio`:
  - pone las dos banderas;
  - si `.env` no trae Supabase, usa marcadores que no apuntan a nada;
  - rechaza `NODE_ENV=production`.
- **Checkout:** `redirect-url` = `${window.location.origin}/hoja-de-vida?pase=retorno` (`ResumePass.tsx`), es decir, `http://localhost:<puerto>/…` en local.

| Prueba | Resultado |
|---|---|
| `validate-resume-studio-dev-auth.test.ts` (unitaria) | ✅ guardas de proceso y de petición, token |
| `validate-resume-studio-dev-launcher.test.ts` | ✅ banderas, marcadores de Supabase, `NODE_ENV` |
| `validate-resume-studio-dev-auth.ts` (integración, `verifySession` real, sin Supabase) | ✅ build normal sin rastro del botón y build del lanzador con él; 7 guardas de proceso y 4 de petición → 401/404; tokens inventados 401; flujo completo: link → CV → tarjetas (IA mock) → checkout sandbox → confirmación → DOCX → postulación → Entrevista |
| tsc, build (CSS `1d7ac096…c048`), `test:unit`, `test:integration`, `test:resume-studio` | ✅ |
| Lanzador real (llaves sandbox sintéticas, Docker, :3100) | ✅ botón → autorización → tablero en 1024 px y 375 px; selector de estado mueve a «Oferta» y persiste; recargar conserva la sesión. **El pago real en el sandbox de Wompi no se probó** (requiere las llaves sandbox del propietario) |
