# P5 — Recuperación de adaptadores (una fuente por entrega)

**Estado:** borrador de propuesta. Requiere aprobación + `design.md` +
`tasks.md` + spec delta antes de implementar (próxima sesión).

## Problema

P4 puso el contrato; **ningún adaptador lo usa todavía salvo Torre**, y esa
migración demuestra el mecanismo, no clasificación fina. Los 16 restantes
siguen devolviendo `Job[]` a través de `liftJobArray`, que deliberadamente no
inventa lo que el adaptador no dijo. Traducido: hoy seguimos sin poder
distinguir «no hay vacantes» de «me bloquearon» **en la propia fuente**, que
es donde se sabe.

P5 es donde eso deja de ser cierto, una fuente por entrega.

## Evidencia ya medida (no hay que volver a recolectarla)

Todo esto sale de `source_attempts` con
`scripts/verify-p4-source-contract.ts`, ventana de 7 días, 2026-09-16/17.
El orden de abajo **es** el orden de adopción propuesto, y sale del fallo
concentrado en detalle, no de la intuición ni del presupuesto (que no
escasea: 0 listados omitidos en 7 días).

| Prioridad | Fuente | Evidencia |
| --- | --- | --- |
| 1 | **Computrabajo** | 102 páginas de detalle → **0 detalles útiles** en 24 intentos; post-P4 sigue en 70/1 y 33/1. El listado está sano (373/373 `success`). |
| 2 | **Computrabajo-VE** | 22 páginas → 0 útiles en 4 de 8 intentos. Mismo parser que CO. |
| 3 | **LinkedIn / LinkedIn-VE** | Parciales masivos: 335→132 y 88→60. El listado es la mayor fuente de volumen (8668 y 2649), así que no se puede degradar. |
| 4 | **Jooble** | 14 recibidas → **0 válidas**: es la única fuente estampada que falta en `KNOWN_SOURCES` (`src/db/job-validator.ts`). Arreglo de una línea, pero es reparación de adaptador y por eso no se hizo en P4. |
| 5 | Resto | Baselines y canarios de conservación; corregir solo con evidencia de degradación. |

## Los tres límites que P4 dejó por escrito y P5 hereda

1. **SRC-008 sigue siendo heurístico para el rechazo por validación.**
   `liftJobArray` fija `valid = received` porque la validación ocurre después,
   en `saveJobs`. La rama `all_rejected_by_validation` del contrato existe
   pero no es alcanzable para un adaptador sin migrar. Deja de serlo cuando un
   adaptador migrado informe contadores **posteriores** a la validación — eso
   es trabajo de P5 y conviene resolverlo con la primera fuente que se migre.
2. **Torre demuestra el mecanismo, no clasificación fina.** `scrapeTorre`
   (en `src/index.ts`) se traga tanto una respuesta HTTP no-ok como cualquier
   excepción y devuelve `[]`. Mientras esa función no distinga, el adaptador
   migrado no tiene nada más fino que informar. Es el patrón exacto que P5
   tiene que romper fuente por fuente.
3. **El circuito `-detail` se cerró por spec y prueba de integración, no por
   canario.** En los tres ticks de P4 no hubo un solo fallo real de detalle,
   así que la fila sigue legítimamente ausente. P5 debería confirmar la
   apertura real en cuanto una fuente reparada empiece a clasificar fallos de
   verdad.

## Pendiente observado de P4, no cubierto

**Glassdoor-CO/VE e Indeed-CO/VE siguen sin verificar.** Tienen n=1 en la
ventana y viven en `scrape-browser-tick.yml`, que corre cada 2 días y que P3
ya dejó sin verificar. Ninguna afirmación de P4 sobre la ruta de navegador
—ni sobre el proxy, que es quien la usa— está respaldada por datos. Antes de
tocar esas cuatro fuentes hay que observarlas al menos una vez.

## Alcance propuesto

- **Una fuente por entrega.** Cada una: migrar a `fetchResult`, distinguir
  deny / rate limit / cambio de esquema / vacío real, meter el `AbortSignal`
  de P3 dentro del adaptador (que P4 dejó fuera para 16 de 17), declarar su
  `SourcePolicy` y medir antes/después con el script de P4.
- Fixtures sanitizados y pruebas de contrato por fuente.
- Baseline de conservación: ninguna reparación puede reducir el volumen de
  listado que la fuente ya aporta.

## Fuera de alcance

- Cola persistente de enriquecimiento (P6).
- Nuevas fuentes (P9).
- Quitar `[key: string]: any` de `Job` — sigue siendo trampa de línea base
  hasta que haya menos adaptadores sin tipar.
- Sin evasión de CAPTCHA, login ni anti-bot (AGENTS.md #8).

## Gates propuestos

- Ninguna fuente reparada reduce su volumen de listado frente a su baseline.
- Cada fuente migrada distingue por **tipo** al menos: deny, rate limit,
  vacío real y rechazo por validación.
- `tsc`/`eslint` sin errores nuevos sobre la línea base heredada.
- Canario leído por log, nunca por código de salida.
