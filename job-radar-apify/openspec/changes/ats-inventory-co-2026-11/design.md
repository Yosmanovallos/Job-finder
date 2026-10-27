# Diseño

## 1. Embudo

```
fuentes de referencias ──► ats_board_inventory ──► sondeo Colombia ──► employers / employer_sources
 (gratis y permitidas)      (solo refs, sin PII)    (descubrimiento)     (insert-only, habilitado)
                                                                              │
                                                       tick priorizado ◄──────┘
                                                              │
                                              direct_jobs ──► proyección en jobs ──► copias ocultas
```

## 2. Fuentes del inventario (todas gratuitas)

| Fuente | Qué aporta | Límites |
|---|---|---|
| Common Crawl CDX | Hosts y rutas de todos los ATS con conector (hoy solo Workday y SmartRecruiters) | Índice a menudo con 504; reintentos acotados; un fallo es "sin datos", nunca "cero tableros". Greenhouse y Ashby casi no aparecen (ADR 0006 §7) |
| Enlaces a ATS en vacantes de bolsas | Hosts de ATS que ya aparecen en descripciones y URLs guardadas (`domain-census`) | Texto no confiable: solo se extrae una referencia con forma válida; nunca se sigue un dominio ajeno |
| Huella del `site-probe` | Enlaces a ATS desde sitios con dominio respaldado | Mismas reglas de robots y redirects |
| Sitemaps públicos de un ATS | Listado de tableros cuando el ATS lo publica y robots lo permite | Solo tras revisión `source-researcher` por ATS |

No se usan APIs de búsqueda pagas (regla de gasto cero, ADR 0006 §11). El parser de cada fuente reutiliza `src/direct/discovery/ats-links.ts` y `cc-refs.ts`, ampliados a cada `ats_type` con conector.

## 3. Esquema (aditivo, `migrate-direct-employers.ts` con `--dry-run`)

`ats_board_inventory`:

| Columna | Uso |
|---|---|
| `ats_type`, `ats_ref` | Referencia normalizada; `UNIQUE (ats_type, ats_ref)` |
| `first_source`, `sources` | Procedencia (`commoncrawl`, `job_link`, `site_probe`, `sitemap`) |
| `status` | `pending`, `enabled`, `no_colombia`, `agency`, `ambiguous`, `blocked`, `error`, `owned` |
| `declared_name`, `colombia_count`, `total_count` | Evidencia del último sondeo |
| `probe_attempts`, `last_probed_at`, `next_probe_at` | Reintentos con backoff y recheck |
| `employer_source_id` | Enlace cuando se habilita |

RLS sin políticas + `REVOKE` para `anon`/`authenticated`, igual que las demás tablas `direct`. Tamaño estimado: ~200 B por fila; 50.000 refs ≈ 10 MB. Cada vacante oficial ocupa ~4,3 kB en `direct_jobs` más su proyección en `jobs`: 10.000 vacantes nuevas serían del orden de 100 MB, dentro del margen del plan (415 MB de 8 GB). Se mide con `db-size` antes y después de cada lote.

## 4. Habilitación automática

Un tablero pasa de `pending` a `enabled` en una transacción insert-only cuando se cumplen INV-010…INV-014. El nombre de la empresa sale del propio ATS. `company_key = companyKeySql(declared_name)`:

- Si no existe `employers` con esa clave → se crea el empleador con `discovery_origin = 'ats_inventory'`.
- Si existe y no tiene tablero de ese `ats_type` → se le añade la fuente.
- Si existe con otro tablero del mismo `ats_type`, la clave es corta o genérica, o el nombre está en la lista de agencias → `ambiguous` o `agency`, sin habilitar.

ATS que no declaran nombre (Lever, Ashby, Workday sin metadatos de empresa) → `ambiguous`, salvo que el mismo tablero ya esté asociado a un empleador por el `site-probe`. Tope: `--max-enable` por corrida (inicial 25).

## 5. Sin duplicados

Tres capas, todas deterministas:

1. **Referencia:** `UNIQUE (ats_type, ats_ref)` normalizada en inventario y en `employer_sources`; un tablero con dueño nunca se reasigna.
2. **Oficial-oficial:** una empresa con dos tableros (p. ej. Workday y un front Phenom) genera la misma requisición dos veces. Se agrupa por `employer_id + title_key + location_key`; gana la fila del tablero de mayor prioridad (el que declara `published_at`, después el más antiguo). La perdedora no se proyecta. Mismo criterio de ciudad de la enmienda §12.
3. **Oficial-copia de bolsa:** `supersedeCopies()` sin cambios de regla. Para que un empleador nuevo tenga alias:
   - **igualdad exacta** de `company_key` entre el nombre declarado por el ATS y el de la bolsa (no fuzzy), con las mismas exclusiones de agencias y claves genéricas;
   - o la URL o la descripción de la copia enlazan al mismo tablero (`ats_type + ats_ref`).

   Un alias que ya pertenece a otra empresa va a `needs_review`.

Auditoría: `copy-audit-all` y una consulta nueva `duplicate-audit` (solo lectura) que cuenta grupos visibles con misma empresa, título y ciudad en más de una fila. Meta: 0.

## 6. Remoto `Internacional`

`matchColombia()` mantiene su contrato. Se añade `matchInternationalRemote()`, que solo devuelve verdadero si:

- el segmento declara modalidad remota (campo estructurado o texto "remote/remoto"), **y**
- el alcance es explícitamente regional o global: `LATAM`, `Latin America`, `Americas`, `South America`, `Anywhere`, `Worldwide`, `Global`;
- y ningún código de país estructurado ni segmento lo restringe a otro país ("Remote – US", "Remote, Brazil").

Resultado: `country = 'CO'` no se fija. Se usa `applicant_countries` vacío y un `scope = 'international'` en `direct_jobs`, y la etiqueta `Internacional` en la tarjeta y el detalle. No se proyecta ciudad. La vacante no pasa el gate de Google en este cambio (INV-042). En la tarjeta se reutiliza el sistema de badges de modalidad existente; no se cambian consultas del dashboard.

## 7. Tick priorizado, mismo costo

Mismo workflow (`17 * * * *`), mismo `timeout-minutes: 20`, mismo plazo de 14 min. Cambia solo el orden y la frecuencia por tablero:

| Nivel | Criterio | Ventana máxima |
|---|---|---|
| A | ≥ 1 vacante en Colombia o `Internacional` en la última lectura | 6 h |
| B | 0 vacantes elegibles en las últimas 3 lecturas | 7 días |
| C | Fallas seguidas | Backoff exponencial, tope 7 días; `suspect` según §3 del ADR |

**Línea base I0:** 107 tableros caben en ~6 min de job. El límite real no es la capacidad sino la cadencia: GitHub arrancó las corridas programadas con 3 a 7 h de separación pese al cron horario, y `MIN_INTERVAL_HOURS = 5` impide releer antes. Con eso, la ventana de 6 h del nivel A no está garantizada hoy. I4 debe medir la cadencia real durante una semana. Si no alcanza, evaluará opciones sin costo: bajar `MIN_INTERVAL_HOURS` solo para el nivel A, o leer el nivel A primero en cada corrida que GitHub sí lance. No se contratarán servicios externos. Antes de subir topes se mide el throughput real (tableros por corrida). Si el nivel A no cabe en 6 h con el plazo actual, se reduce `--max-enable` y se publica el déficit en `coverage`; no se agregan corridas ni minutos.

El descubrimiento usa el workflow `direct-employers-discovery.yml` con sus tres horarios actuales (`31 3,11,19`), sin horarios nuevos. Cada corrida reparte su presupuesto: primero sondea el inventario ATS y después la vía por nombre.

## 8. Rollback

`enabled = false` por `discovery_origin = 'ats_inventory'` en un comando con `--dry-run`. La proyección retira sus filas y `restoreCopies` devuelve las copias vistas en las últimas 48 h (ADR 0006 §10.6). Las tablas nuevas no se borran. La enmienda §13 se revierte con un PR.

## 9. Pruebas

- **Unitarias offline:** parsers de refs por ATS, normalización, `matchInternationalRemote` con casos positivos y adversariales ("Remote – US", "LATAM except Colombia", "Cali, CA", inyección en texto) y reglas de habilitación.
- **Integración (Postgres desechable):** inventario idempotente, habilitación insert-only, conflicto de dueño, agencia, dedupe oficial-oficial, alias exacto y oculto de copias, reversión, niveles del tick y vacantes `Internacional` fuera del gate de Google.
- **Canario en vivo** solo con `--allow-live-sources` y aprobación.
