# Requisitos de medición y decisión

## RET-001 — Seguridad y privacidad
La medición DEBE ejecutarse en READ ONLY con timeout/rollback y devolver
solo agregados. Escenario: la UI devuelve transaction_read_only=on sin
identificadores, títulos, URLs ni datos de usuarios.

## RET-002 — Universos separados
La entrega DEBE distinguir filas activas de candidatos canónicos SEO.
Escenario: 7.143 filas próximas al umbral no se presentan como 7.143 URLs
indexadas; el subconjunto SEO calculado es 2.129 de 7.906, no tráfico perdido.

## RET-003 — Historia no fabricada
La entrega DEBE separar source_closed de expired y declarar que expired
mezcla edad/plazo/ausencia. No DEBE inventar retiros exclusivamente por edad.
Escenario: el conteo semanal de hashes retenidos no se etiqueta como ledger
completo de eventos o como ofertas que seguían abiertas al eliminarse.

## RET-004 — Retención con evidencia
La política DEBE conservar identidad/fecha, privilegiar cierre/plazo real y
exigir verificación afirmativa reciente para >30 días. Unknown o cursor de
chequeo no DEBEN renovar apertura. No cambia producción sin sus gates.
