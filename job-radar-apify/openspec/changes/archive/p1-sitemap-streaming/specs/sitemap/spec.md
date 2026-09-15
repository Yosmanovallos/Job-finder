# Spec delta — sitemap de vacantes (P1, retrospectivo)

## SMP-001 — Memoria acotada

Dado un corpus sintético de 100.000 vacantes y varias solicitudes
concurrentes, cuando se solicita `/sitemap-jobs.xml`, el servicio debe
mantener su presupuesto de memoria (≥30% de margen RSS) y continuar
atendiendo las rutas de salud y navegación.

**Resultado:** ✅ heap extra ~34 MB, RSS máx ~304/512 MB.

## SMP-002 — Compatibilidad

Dada la misma instantánea de datos y la misma política pública, las URLs
elegibles deben conservar identidad, canonical y reglas de visibilidad.

**Resultado:** ✅ mismo conjunto y formato de URLs; elegibilidad sin
cambios; 50.000 URLs emitidas.

## SMP-003 — Cancelación

Cuando el cliente interrumpe la descarga, el servidor debe liberar la
consulta, conexión y recursos asociados dentro del plazo definido.

**Resultado:** ✅ cursor PostgreSQL cancelado al desconectarse; timeouts
10 s consulta / 30 s total; `503` ante saturación o fallo de BD.
