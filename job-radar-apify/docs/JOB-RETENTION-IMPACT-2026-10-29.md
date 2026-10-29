# Retención de ofertas: medición y política propuesta

Observado el 29-Oct-2026 en producción, mediante SQL Editor autenticado de
Supabase. Solo agregados; ninguna consulta a personas, cuentas, correos o CV.
Código base a964fce. Consultas versionadas en `sql/job-retention-audit.sql`
y `sql/job-retention-seo-audit.sql`. Evidencia JSON en `seo-evidence/`.

Ambas transacciones devolvieron `transaction_read_only=on`; aislamiento
repeatable read, timeout 20 s, lock timeout 2 s y ROLLBACK. No se cambian
datos, reglas de purga, esquema, diseño, consultas de dashboard o servicios.

## Resultado principal

En el conjunto canónico apto para SEO, **2.129 de 7.906 registros (26,93%)**
alcanzan el umbral de 30 días durante los próximos siete días. **915** de
esos 2.129 tienen un `valid_through` registrado posterior al límite de
antigüedad. Esto identifica candidatos a verificar: no demuestra que sigan
aceptando postulaciones ni predice una pérdida de 26,93% del tráfico.

La respuesta a la preocupación del usuario es concreta: el corte fijo puede
retirar páginas antes del vencimiento registrado. Para conservarlas con
seguridad falta evidencia afirmativa y reciente de disponibilidad; no basta
ampliar MAX_JOB_AGE_DAYS o desactivar la purga.

## Corpus actual y exposición

Primera consulta: 2026-10-29T12:17:49Z (07:17 Bogotá).

| Agregado | Registros |
|---|---:|
| Filas almacenadas jobs | 35.422 |
| is_active=true | 34.778 |
| Activas dentro de la ventana de edad y no vencidas | 34.631 |
| Alcanzan umbral de edad en siete días, aún no vencidas al observar | 7.143 |
| De esas, plazo registrado posterior al límite de edad | 1.165 |
| De esas, vencimiento desconocido | 4.559 |
| Activas sin source_checked_at | 34.762 |

Estos son registros, no necesariamente ofertas únicas/canónicas ni páginas
elegibles para Google. Incluyen Workana y filas no aptas para JobPosting.
La proporción 7.143/34.631 = 20,63% no debe mezclarse con el universo SEO.

En ese instante había 147 filas activas que ya cumplían algún criterio de
purga: 64 por plazo vencido, 82 por antigüedad con last_seen_at dentro de
30 días y una por antigüedad más ausencia de 30 días. Es un snapshot entre
ticks; no prueba un fallo del cron ni que las 82 sigan abiertas en la fuente.

Segunda consulta: 2026-10-29T12:21:38Z (07:21 Bogotá). Reproduce el orden
del sitemap: DISTINCT ON por título/empresa/ubicación normalizados entre
activas vigentes, luego seo_ready. No devuelve esas claves ni identificadores.

| Corpus canónico apto para SEO | Registros |
|---|---:|
| Total calculado | 7.906 |
| Umbral de edad en siete días | 2.129 |
| Plazo registrado posterior al límite de edad | 915 |
| Sin fecha de vencimiento | 102 |
| Vistos nuevamente en últimas 48 h y próximos al umbral | 204 |

«Apto para SEO» es la regla de la aplicación, no indexación confirmada ni
ranking. No se deducen visitas perdidas de esos conteos. Los dos snapshots
son momentos distintos; tampoco se equiparan a una descarga anterior del
sitemap de 7.950 URLs, que puede usar caché y otro instante del corpus.

### Distribución de candidatos SEO próximos al umbral

| Fuente/mercado | Próximos a 30 días | Plazo posterior al corte |
|---|---:|---:|
| LinkedIn CO | 849 | 109 |
| LinkedIn VE | 327 | 67 |
| Computrabajo CO | 327 | 316 |
| Elempleo CO | 215 | 197 |
| Magneto CO | 171 | 119 |
| Portal oficial CO | 139 | 30 |
| Computrabajo VE | 69 | 68 |
| WeRemoto compartido/desconocido | 31 | 9 |
| Remotive compartido/desconocido | 1 | 0 |

Una redistribución entre duplicados puede cambiar el ganador canónico; no es
una predicción de 2.129 URLs que desaparecerán exactamente dentro de siete
días. Algunas pueden vencer o cerrarse antes; otras podrían cambiar de estado.

## Retiradas históricas que sí podemos contar

Ventanas completas en America/Bogota: **22–28-Oct** frente a **15–21-Oct**.
Se cuentan hashes únicos que siguen guardados en expired_job_urls y cuya
última marca de retiro cae en el periodo. NO es un ledger de todos los eventos.

| Motivo almacenado | 15–21 Oct | 22–28 Oct | Variación calculada |
|---|---:|---:|---:|
| expired: edad/plazo/ausencia mezclados | 8.494 | 7.745 | −8,82% |
| source_closed: camino de cierre de fuente | 52 | 306 | +488,46% |

No afirmar «7.745 ofertas vigentes borradas por edad»: esa atribución no
existe en los datos. El ON CONFLICT actual puede actualizar expired_at y
reason; la tabla conserva hashes durante 180 días, no cuerpos, estados SEO
al retiro ni el motivo exacto dentro de expired. Tampoco demuestra cuántos
de esos URLs estaban indexados o tenían tráfico.

## Por qué falta evidencia de disponibilidad

source_checked_at es un cursor, no un resultado de apertura. El código de
source-closure rota también respuestas unknown/timeouts y 404 en una tanda
degradada. Los 16 registros activos con ese cursor son de Torre; no sería
correcto usarlo como `verified_open_at` ni extender por ello su retención.

last_seen_at indica redescubrimiento. Un portal puede listar una vacante
cerrada, responder 200 con un aviso o refrescar un listado sin comprobar
postulación. valid_through futuro tampoco prueba apertura actual. Para
portales oficiales, la pertenencia a una API/feed de vacantes publicadas
puede ser evidencia fuerte solo si el contrato de esa fuente lo garantiza.

## Política propuesta

El ADR 0007 detalla la decisión objetivo; está **propuesto y no desplegado**.
ADR 0005 y el límite actual siguen vigentes hasta que pase la implementación.

1. Conservar una oferta >30 días únicamente con resultado afirmativo de
   apertura, fuente/método soportado y comprobación de menos de 24 horas.
   Mantener ID, URL y fecha originales; no «republicarla» para parecer nueva.
2. Cierre explícito o plazo real vencido retira postulación/JobPosting/sitemap
   de activas. No compensar eso con una fecha inventada o una redirección a
   una categoría no equivalente.
3. Disponibilidad desconocida no se traduce en «abierta» o «cerrada». Al pasar
   la ventana admitida, desactivar aplicación y marcado; preservar identidad
   para revalidar, con cola acotada y estado honesto.
4. Categorías de ciudad/cargo conservan su URL al rotar las ofertas. Ahí debe
   sostenerse la estrategia para búsquedas generales, sin archivos masivos
   pobres ni páginas duplicadas para cada sinónimo.

## Implementación siguiente, delimitada

Primero instrumentar motivos exactos de retiros futuros (sin backfill
inventado) y persistir resultado/fecha/método de disponibilidad aparte del
cursor. Después activar un piloto en fuente oficial con contrato verificable;
la auditoría identifica 139 candidatos SEO próximos al umbral en portales
oficiales, pero **ninguno queda automáticamente aprobado por este conteo**.

La ampliación requiere un cambio coherente en lecturas, ingesta, elegibilidad
Google, sitemap y purga: modificar solo MAX_JOB_AGE_DAYS crearía reglas
contradictorias. El dry-run deberá comparar el comportamiento actual con el
propuesto y listar solo agregados de retenidas/retiradas/unknown, sin cambios.

Gates: pruebas SQL/TypeScript de equivalencia, límites temporales exactos,
fuente cerrada/unknown, expiración real, identidad estable y cero cambios
de diseño. Integración en PostgreSQL desechable; baseline móvil/escritorio;
compatibilidad de colas/tombstones y rollback. Mantener SWR/warmup y planes
Render actuales. Ninguna compra, servicio nuevo o canario de fuente en esta fase.

## Lo que esta medición no demuestra

No hay causalidad medida entre purga y pérdida de clics/registros, no se ha
verificado la apertura de los 915 candidatos y no existe un total histórico
exacto de retiros solo por edad. No se declara la meta SEO cumplida. Esta
entrega sí fija una línea base real y una política implementable con gates.
