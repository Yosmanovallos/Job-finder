# Línea base de fechas y vigencia — 2026-10-25

Consulta agregada de solo lectura en Supabase Production, alrededor de las 16:10 UTC. Cuenta filas de `jobs` con `is_active = true`, `published_at` dentro de 30 días y `valid_through` vigente o desconocido. Excluye proyecciones de empleadores directos. Los conteos varían con la ingesta y el reloj; no son una estimación de vacantes cerradas.

| Fuente | Visibles | Texto de minutos guardado hace >1 día | Sin redetectar >7 días | Sin redetectar >14 días |
| --- | ---: | ---: | ---: | ---: |
| Computrabajo | 5.851 | 853 | 2.803 | 1.535 |
| LinkedIn | ~16.980 | 2.254 | 11.262 | 7.410 |
| Workana | 3.257 | 207 | 2.341 | 1.594 |
| Elempleo | 1.111 | 0 | 700 | 452 |

En total, 3.314 filas de Computrabajo, LinkedIn y Workana conservaban un texto de **minutos** más de un día después de la publicación guardada. Esta es una medida del defecto de presentación; no demuestra que la fecha del origen sea incorrecta ni que la vacante esté cerrada. Las filas sin redetección pueden seguir abiertas, pero su vigencia no está confirmada por una visita reciente al listado.

Caso reportado, ID `27a2f2f3-d237-47ae-8fa3-ef4bcfdcb75d`: `date_text = 'Hace 37 minutos'`, `published_at = 2026-09-30 14:32:15 UTC`, `created_at = 2026-09-30 14:33:46 UTC`, `last_seen_at = 2026-09-30 14:33:46 UTC`, `source_checked_at = NULL`. El 25 de octubre, la interfaz aún mostraba “Hace 37 minutos” y Computrabajo indicaba que la oferta ya no estaba disponible. El límite general de 30 días todavía permitía mostrarla.

El campo `source_checked_at` se llena actualmente mediante la comprobación de cierre de Torre. Su valor nulo en Computrabajo no significa que haya fallado una comprobación; significa que **no existe** esa comprobación por oferta para la fuente. El propietario decidió mantener esas ofertas visibles y explicar la incertidumbre junto a **Aplicar**, sin una insignia en cada resultado. Un feed/API o permiso de la fuente es el requisito para verificar cierres sin ampliar un bypass anti-bot.

Repetir los agregados con `npm run audit:job-trust` en un entorno que tenga `DATABASE_URL`, sin copiar secretos al repositorio. La consulta corre dentro de una transacción de solo lectura y no imprime URLs, títulos ni datos personales.
