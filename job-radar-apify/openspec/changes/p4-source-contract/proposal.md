# P4 — Contrato de fuentes y transporte

**Estado:** borrador de propuesta. Requiere aprobación + `design.md` +
`tasks.md` + spec delta antes de implementar (próxima sesión).

## Problema

El contrato de fuente (`src/sources/types.ts`) es
`fetch(keywords, dateRange): Promise<Job[]>`. Un array es todo lo que una
fuente puede decir, así que **vacío significa a la vez «no hay vacantes»,
«me bloquearon», «falló el parseo» y «no hay credencial»**. P2 recuperó esa
distinción *por fuera*, con señales (`reportSourceSignal`) y clasificación
heurística; P4 la lleva al propio contrato, que es donde pertenece.

Consecuencias concretas ya medidas, no supuestas:

- **Los scrapers de `src/index.ts` distintos de Jooble siguen tragando
  errores** y devolviendo `[]` sin señal. P2 solo cubrió
  `executeWithResilience`, Jooble y los de navegador (hallazgo registrado en
  el plan maestro).
- **Jooble descarta el 100% de lo que trae**: `validateJobs()` no lo incluye
  en `KNOWN_SOURCES`. Visible desde P2 como
  `failed / all_rejected_by_validation`, confirmado en todas las
  ejecuciones del 2026-09-15/16.
- **Un circuito por fuente, compartido entre listado y detalle**: un bloqueo
  en las páginas de detalle abre el circuito del listado sano de la misma
  fuente, y viceversa (`executeWithResilience(`${adapter.name}-detail`)`
  mitiga esto a medias usando otro nombre, pero la política sigue siendo
  única).
- **`Retry-After` no se respeta** en ninguna ruta.
- **`[key: string]: any` en `Job`** deja pasar cualquier campo sin tipo.

## Objetivo

Que una fuente pueda decir *qué pasó* sin que el llamador lo adivine, y que
el transporte (directo o proxy) sea una política declarada por fuente, no
una decisión incrustada en cada adaptador.

## Alcance propuesto

- `SourceFetchResult` tipado: datos + estado + contadores por etapa + error
  clasificado. **Adopción gradual**, adaptador por adaptador, con un
  envoltorio que siga aceptando los que devuelven `Job[]`.
- Separar descubrimiento, detalle y verificación como operaciones distintas
  del contrato, no como convenciones de nombre.
- Registro de capacidades/políticas por fuente (`SourcePolicy`): métodos
  autorizados, mercado, límites, atribución.
- Límites centralizados y respeto de `Retry-After`.
- Circuitos separados para listado y detalle.
- Proxy como transporte configurable y autorizado: directo por defecto,
  credenciales fuera del código, límites por fuente, feature flag. La ruta
  de navegador ya contempla `WEBSHARE_PROXY_URL`.
- **Aquí encaja llevar el `AbortSignal` de P3 dentro de cada adaptador**,
  que P3 dejó deliberadamente fuera: cada adaptador se abre igualmente en
  esta fase.

## Fuera de alcance

- Reparar adaptadores concretos (P5, una fuente por entrega). P4 pone el
  contrato; P5 lo usa.
- Cola persistente de enriquecimiento (P6).
- Sin evasión de CAPTCHA, login ni anti-bot (AGENTS.md #8).

## Contratos involucrados

`SourceFetchResult`, `SourcePolicy` (tabla de contratos del plan maestro).
Base: `FetchContext` de P3 y `RunRecorder`/`source_attempts` de P2 para
medir antes/después.

## Datos que conviene reunir ANTES de diseñar

P3 lleva desplegado desde el 2026-09-16 y `source_attempts` ya acumula
historial real. Antes de fijar el diseño, mirar:

```sql
SELECT source_name, status, reason, COUNT(*), AVG(duration_ms)::int
  FROM source_attempts
 WHERE started_at > NOW() - INTERVAL '7 days'
 GROUP BY 1,2,3 ORDER BY 1, 4 DESC;
```

Eso dice **qué fuentes se quedan sin presupuesto, cuáles fallan de verdad y
cuáles solo están vacías** — que es lo que debe priorizar el orden de
adopción, en vez de la intuición. También permite calibrar
`BUDGET_ESTIMATES` (P3 los dejó como primera aproximación explícita, no
como constantes derivadas).

## Gates

- Ninguna fuente puede volver a comunicar un fallo como éxito vacío, ahora
  por tipo y no por heurística.
- Adopción gradual demostrable: adaptadores sin migrar siguen funcionando
  sin cambios.
- Circuito de detalle independiente del de listado, comprobado.
- `Retry-After` respetado donde la fuente lo envía.
- Proxy desactivado por defecto; activarlo no cambia el comportamiento de
  ninguna fuente que no lo declare.

## Pendiente de diseñar

- Forma exacta de `SourceFetchResult` y del envoltorio de compatibilidad.
- Dónde vive `SourcePolicy` (código vs. tabla vs. `docs/source-catalog/`).
- Si el proxy se modela como transporte inyectable o como capacidad del
  adaptador.
