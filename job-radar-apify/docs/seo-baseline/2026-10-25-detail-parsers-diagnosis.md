# Diagnóstico de detalle LinkedIn / Computrabajo — 2026-10-25 (Fase 5)

Pregunta: ¿por qué los reintentos de detalle de LinkedIn y Computrabajo
aparecen como `NO_DETAIL` sin clase de fallo tras el PR #18?

## Resultado corto

1. **No es un parser roto.** Ambos fetchers hacían `if (!response.ok) return null`.
   Un 403, 429 o el 999 de LinkedIn llegaba a la máquina de estados como
   `NO_DETAIL`: sin clase de fallo, neutral para el circuito y reintentado tick
   tras tick. Con eso, "sin clase de fallo" no demostraba que el fallo fuera del
   parser.
2. **Computrabajo-CO tuvo una caída en escalón el 2026-10-07.** Pasó de ~40–65 %
   `complete` sobre lo intentado (28-sep → 06-oct) a ~1–4 % desde el 07-oct.
   Computrabajo-VE usa el mismo parser y la misma técnica, y siguió en ~40–60 %.
   El dominio CO se mudó: `www.computrabajo.com.co` responde 301 →
   `co.computrabajo.com`, y ese host responde **403** a peticiones directas
   (incluido `robots.txt`). La causa más probable es un bloqueo o una mudanza de
   host, no un cambio de JSON-LD.
3. **LinkedIn obtiene la descripción en ~70–80 % de lo intentado.** Por ejemplo,
   el 24-oct: 154 `complete` + 11 `rejected` frente a 43 `NO_DETAIL`. El freno
   real es de capacidad: ~300–500 vacantes al día quedan `pending` sin
   intentarse. Además, `robots.txt` de LinkedIn dice `User-agent: * / Disallow: /`
   (solo los rastreadores de la lista blanca pueden pasar) y prohíbe
   explícitamente `/jobs-guest/`.

## Evidencia agregada (Supabase, solo conteos, sin PII)

Vacantes creadas en los últimos 30 días, por día de creación.

| Fuente | Antes del 07-oct (complete / no_detail) | Desde el 07-oct |
|---|---|---|
| Computrabajo-CO | 472 / 237 (+396 retry, 277 backlog) | 79 complete · 912 `retry` con `NO_DETAIL` y 1 intento · 2.736 `pending` con 0 intentos |
| Computrabajo-VE | 97 / 75 | 217 complete · ~40–60 % diario |
| LinkedIn-CO (24-oct) | — | 543 creadas: 154 complete, 11 rejected, 43 no_detail, 335 sin intentar |

`source_attempts` (etapa de detalle, 24 h): Computrabajo da 8 `failed/exception`
de 13 intentos, es decir, todo vacío y contado como fallo. Ninguna fila registra
`blocked`, porque el código anterior nunca podía emitirlo.

## Qué NO se hizo, y por qué

- **No se ejecutó el canario en vivo.**
  - LinkedIn: `robots.txt` prohíbe `/jobs/view/` a cualquier agente no
    autorizado.
  - Computrabajo: el host responde 403 a peticiones directas, y la única ruta
    que funciona es el proxy `translate.goog`, que el propio código describe
    como "Proxy Bypass (100% IP Block Protection)".
  - Probar o "reparar" a través de ese proxy sería rodear un control anti-bot
    (AGENTS.md regla 8).
- **No se cambió el parser ni `assessDescription()`.** No hay evidencia de un
  cambio de HTML o JSON-LD que corregir.
- **No se apuntó el proxy al nuevo host `co.computrabajo.com`.** Haría
  funcionar el detalle de nuevo, pero solo extendiendo el bypass.

## Qué cambia este PR

`src/sources/detail-http.ts` hace que los dos fetchers informen las negativas
con los errores tipados que ya existían:

- 401/403/999 → `FetchBlockedError` (`blocked`).
- 429 → `FetchRateLimitedError`, con `Retry-After` solo si la fuente lo envió.
- 200 redirigido al muro de inicio de sesión de LinkedIn (`/authwall`,
  `/login`, `/checkpoint`) → `blocked`.

Con esto, el circuito de detalle se abre y deja de pedir a un host que dice
que no; el log del tick muestra la clase real de fallo y la fila queda en
`retry` con su clase, no como `NO_DETAIL`. 404/410/5xx siguen el camino de
siempre. No hay rutas alternativas ni reintentos extra.

## Decisiones pendientes del propietario

Los listados y el detalle actuales de ambas fuentes entran en conflicto con
la regla 8 y con `robots.txt` de LinkedIn. Desactivarlos reduce inventario,
así que la decisión es del propietario. Alternativas permitidas:

1. LinkedIn: solicitar la lista blanca (`whitelist-crawl@linkedin.com`, según
   su `robots.txt`) o un acuerdo de feed de socio.
2. Cubrir a esos empleadores con ATS oficiales (iniciativa direct-employers,
   D1–D5: Greenhouse, Lever, Workday, etc.), que tienen API pública.
3. Computrabajo: pedir un feed de socio o XML para agregadores.
4. Mientras tanto: mantener esas vacantes `noindex` (ya ocurre por readiness) y
   concentrar el esfuerzo en Elempleo y Magneto, que funcionan.

## Cómo leer el siguiente tick

Busca en el log del scrape la línea de enriquecimiento de detalle. Para
Computrabajo-CO se espera `FetchBlockedError×1` y el circuito abierto, en vez
de `NO_DETAIL`. No se espera un aumento de descripciones completas ni del
sitemap por este cambio: es telemetría y cumplimiento, no recuperación.
