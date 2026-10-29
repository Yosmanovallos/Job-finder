# Requisitos observables

## CNI-001 — Estado y fecha
El diagnóstico DEBE distinguir fecha del informe y estado individual.
Escenario: una URL en «sin indexar» aparece indexada en su inspección; se
registra la discrepancia y no se anuncia una exclusión actual para esa URL.

## CNI-002 — Muestra acotada
El diagnóstico DEBE identificar las URLs, método, tamaño y límites.
Escenario: diez GET y cinco inspecciones no se convierten en diez inspecciones
ni se extrapolan a 9.745 páginas; los datos no contienen secretos/HTML/PII.

## CNI-003 — Sin reparaciones inventadas
El resultado NO DEBE cambiar robots, canonical, calidad, retención o diseño
sin fallo reproducible. Una descripción corta ya indexada no justifica
inventar contenido, empleador, salario o fecha.

## CNI-004 — Resultado distinto de posicionamiento
La entrega DEBE diferenciar inclusión en índice, elegibilidad de JobPosting
y ranking para una consulta. No declara meta de crecimiento cumplida.
