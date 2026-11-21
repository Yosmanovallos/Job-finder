# Validación — Resume Studio R1 (2026-11-21)

Base: `origin/codex/resume-studio` `16e475e`. Rama: `codex/resume-studio-r1`.
Todo local; nada desplegado ni migrado en Supabase.

## Gates

| Gate | Base `16e475e` | Rama |
| --- | --- | --- |
| `npx tsc --noEmit` | ✅ 0 errores | ✅ 0 errores |
| `npm run build` | ✅ | ✅ |
| `npm run test:unit` (todos los archivos, sin cortar en el primer fallo) | 60 ✅ / 5 ❌ de 65 | 61 ✅ / 5 ❌ de 66 (los mismos 5; +1 = la prueba nueva) |
| `npm run test:integration` | 24/24 ✅ | 26/26 ✅ |
| `lint` | no existe script en `job-radar-apify` | — |

**Fallos heredados (no son de R1, idénticos en la base):**
`validate-job-page-blocks.test.ts` (JPD-001), `validate-ssr-dollar.test.ts`,
`validate-job-meta.test.ts`, `validate-employment-type-trust.test.ts`,
`validate-fetch-context.test.ts`. Los cuatro primeros fallan porque
`buildJobPosting()` devuelve `null` con fixtures fechados que ya envejecieron
(«the fixture must emit JobPosting»). `npm run test:unit` se detiene en el
primero, así que en la base el resto de la suite no llegaba a correr; se
corrió completa con una copia temporal del runner que no corta (no se
versionó). No se suprimió nada.

## Pruebas nuevas

- `tests/validate-resume-studio.test.ts` (unit, RS-001…RS-010): bandera
  estricta, import perezoso en `server.ts` y `App.tsx`, 3 casillas, hash del
  texto, 3 plantillas, esquema estricto (rechaza foto/cédula/estado civil y
  `userId` del cliente), límites, fechas, enlaces (`javascript:`/`data:`/con
  credenciales rechazados), la migración rechaza `--allow-remote-db`.
- `tests/validate-resume-studio.ts` (integración): bloque idempotente, RLS
  activo y 0 permisos para `anon`/`authenticated` en las 3 tablas;
  `rs_consents` solo inserción (UPDATE/DELETE fallan) y sin IP; 401 sin
  sesión; 403 sin autorización y sin la casilla de guardar; 400/413/415; una
  base por usuario; versiones, conflicto 409, deshacer y restaurar como
  versión nueva; poda a 50; exportar.
  - **T-IDOR ✅**: el usuario B lee, edita, lista versiones, deshace,
    restaura y borra el CV de A → 404 sin datos de A; su exportación y su
    lista no contienen nada de A; el CV de A queda intacto.
  - **T-DEL ✅**: «Borrar todo» deja 0 filas de A en `rs_resumes` y
    `rs_resume_versions`; las 6 constancias de A se conservan; los datos de B
    siguen; borrar la cuenta (`users`) borra en cascada.
- `tests/validate-resume-studio-free.ts` (integración):
  - **T-FREE ✅**: el servidor real se arranca con la bandera sin definir y con
    `"true"`. `/dashboard`, `/dashboard?coldcheck=…`, `/`, una vacante
    `/empleos/:id`, `/empleos/bogota`, `/api/jobs`, `/api/v1/jobs`,
    `/robots.txt` y `/llms.txt` responden 200 con estado, tipo y cuerpo
    idénticos (se enmascaran solo `"now"` del SSR y el `requestId` aleatorio).
    Apagada (o `"TRUE"`), `/hoja-de-vida`, `/hoja-de-vida/editar` y
    `/api/resume/*` = 404; encendida, la API pide sesión (401).

## Runbook del dashboard

- Con la bandera apagada el único código nuevo en la ruta de cada petición
  es un booleano leído al arrancar; el módulo se importa con `import()` solo
  si está encendida y la ruta coincide. No hay caché, warmup ni consulta
  nueva en el arranque.
- CSS global: **idéntica byte a byte** a la base (`index-BeuqwIzT.css`); la
  página usa clases que ya existían o estilos en línea.
- JS inicial (entrada + `modulepreload`): 139 708 → 140 368 B gzip
  (+0,66 KB, +0,5 %). El chunk `utils` (ya precargado en la base) quedó
  dentro de `index`; la página va en su propio chunk `ResumeStudio`
  (83,6 KB, 20,7 KB gzip) que solo se descarga en `/hoja-de-vida`.
- Frío local (`home-cold`, 9 procesos por lado alternados, URLs únicas,
  medianas):

| Medida | Base | Rama |
| --- | ---: | ---: |
| Arranque | 685 ms | 565 ms |
| Primer `/` (móvil) | 442 ms | 406 ms |
| `/` escritorio | 53 ms | 57 ms |
| `/` caliente | 11 ms | 10 ms |
| `/empleos/bogota` | 85 ms | 79 ms |
| `/dashboard` | 40,3 ms | 40,0 ms |

  La diferencia de bytes de HTML que reporta ese bench (+601 B home, +1147 B
  hub) es del propio bench: solo a la rama le pasa un `MARKET_REPORTS_DIR`
  sintético. La comparación sin esa asimetría es T-FREE (cuerpos idénticos).
- No verificable localmente: caché del edge (MISS en Cloudflare) y logs de
  Render. No aplica hasta R5: nada se despliega.

## No verificado

- Revisión visual del editor y de la autorización con una sesión real
  (necesita Supabase de producción; no se usó). Las 3 plantillas se
  renderizaron a HTML estático con un perfil sintético (el `<script>` del
  perfil sale escapado), pero el navegador integrado no abrió la vista local.
- D6 (auditoría de tablas viejas en Supabase): abierta.
