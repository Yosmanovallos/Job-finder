# ADR 0003 — Dónde vive el disparador del scraping

**Fecha:** 2026-09-15
**Estado:** aceptado para P3 · recomendación pendiente de aprobación de coste
**Contexto:** `docs/PROD-IMPROVEMENTS-PLAN.md` §P3,
`openspec/changes/p3-execution-deadlines/`

## Problema

GitHub Actions entrega una fracción de los ticks programados.

| Workflow | Cron solicitado | Realidad observada (2026-09-14/15) |
|---|---|---|
| `scrape-jobs.yml` | `*/15` → 96/día | 12 ejecuciones en 47 h (~6/día) |
| `scrape-jobs-ve.yml` | `*/15` → 96/día | 8 ejecuciones en 47 h |
| `scrape-browser-tick.yml` | `0 13 */2 * *` | 15:40, 16:41, 16:47, 16:55, 17:21, 17:58 UTC |

La última fila es la que descarta las explicaciones cómodas: dura 4 minutos,
tiene su propio grupo de concurrencia y pide **un** disparo diario. Aun así
llega con 3-5 h de retraso, siempre. Ni el solapamiento de ticks ni su
duración lo explican — el retraso lo introduce el planificador de GitHub.

## Impacto real (medido, no estimado)

Menor que el titular del 94%. El tick es sin estado: un rol vencido **sigue
vencido** hasta que alguien lo scrapea, así que las cadencias de 4-6 h
(LinkedIn, Torre, Computrabajo, Elempleo, Magneto) se absorben solas. Las
víctimas reales son **RemoteOK y GetOnBoard**, configuradas a 1 h: a ~6
ticks/día pierden la mayor parte de sus ventanas.

## Decisión

**El disparador se queda en GitHub Actions durante P3.** No por inercia, sino
por orden de dependencias:

1. **El lease atómico es requisito previo, no acompañante.** Hoy dos ticks
   solapados son raros *solo porque los ticks son raros*. Dar un disparador
   fiable de 15 min antes de que exista `scrape_leases` convertiría un fallo
   latente — dos ticks reclamando el mismo par rol/fuente — en uno constante,
   duplicando el volumen de peticiones contra fuentes ya sensibles al ritmo.
2. **El plan maestro condiciona la mudanza a coste aprobado**, y esa es una
   decisión del usuario, no del agente.
3. **El destino obvio no sirve tal cual.** Render ya hospeda la app y tiene
   `server:cron` con `ENABLE_CRON`, pero meter scrapes de 20 min dentro del
   dyno web de 512 MB sería un retroceso directo sobre el OOM que P1 acaba
   de resolver. Un cron job de Render aparte sí es viable — y es de pago.

## Qué se hace en su lugar (P3)

- Se implementa el lease atómico (`scrape_leases`), que es lo que hace
  *seguro* cualquier disparador fiable posterior.
- Se baja el cron de `*/15` a `*/30` como **experimento medible**: ya se
  reciben ~6/día en cualquier caso, así que no se pierde cadencia real, y
  pedir 96 disparos/día podría ser parte de lo que hace que GitHub
  despriorice este repositorio. **No es un arreglo conocido**: es una
  hipótesis que no puede verificarse desde aquí, porque las heurísticas de
  throttling de GitHub no son públicas.

## Recomendación para la fase siguiente

Si a los **7 días** (revisar el 2026-09-22) `scrape_runs` no muestra mejora
en la cadencia real, mover disparador y worker a un scheduler gestionado, con
coste aprobado previamente por el usuario. Con el lease ya desplegado, ese
movimiento deja de ser arriesgado.

Medida a usar, ahora que P2 persiste el historial:

```sql
SELECT date_trunc('hour', started_at) AS hora, COUNT(*)
  FROM scrape_runs
 WHERE workflow = 'scrape-tick' AND started_at > NOW() - INTERVAL '7 days'
 GROUP BY 1 ORDER BY 1;
```

## Consecuencias

- **Positiva:** la coordinación existe antes de que la carga la necesite.
- **Positiva:** la decisión queda respaldada por medidas propias, no por la
  documentación genérica de GitHub sobre retrasos de cron.
- **Negativa:** RemoteOK y GetOnBoard siguen perdiendo ventanas hasta que se
  resuelva la cadencia. Aceptado a sabiendas: son catálogos globales que se
  vuelven a leer enteros en cada pasada, así que lo que se pierde es
  frescura, no cobertura.
- **Reversible:** el cron es una línea por workflow en ambos sentidos.
