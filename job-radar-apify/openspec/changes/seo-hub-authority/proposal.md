# (Borrador) Autoridad de los hubs de ciudad existentes

Prioridad 3 de `docs/SEO-GROWTH-ROADMAP-2026-11.md`. Es **solo una
propuesta**: el design, las tareas y las specs se escriben cuando empiece
esta fase.

## Por qué

En las búsquedas de ciudad, nuestras vacantes ganan en Google Empleos, pero
el resultado orgánico lo ganan Computrabajo y elempleo. Nuestros hubs
quedan en:

| Hub | Posición |
|---|---|
| Bogotá y Cali | no están en el top 3 de nuestras URL |
| Ibagué | 15,2 |
| Armenia | 10,4 |
| Caracas | 37,3 |
| Valencia | 34,9 |
| Cúcuta | 35,2 |
| Maracaibo | 45,6 |

Fuente: GSC, 28 días hasta el 2026-11-04, y la vista «aparición en
búsquedas» del 2026-11-07.

## Qué se propone (a validar con datos el 2026-11-26)

1. **Contenido propio por hub**, con datos reales: empresas que más
   publican, modalidades, cargos frecuentes y una pregunta frecuente
   respondida con cifras.
2. **Enlaces internos hacia el hub** con anclaje descriptivo desde cada
   vacante, empresa y página de intención de la ciudad. Hay que medir antes
   cuánto aporta ya `job-link-graph`.
3. **Enlaces externos hacia hubs concretos:** alcaldías y secretarías de
   desarrollo económico, SENA regional, universidades y medios locales. El
   gancho es un informe mensual de empleo por ciudad con datos propios.
4. **Limpieza:**
   - `/empresas/elempleo` posiciona por la marca de un competidor;
   - `/ve/dashboard` posiciona por «trabajo en venezuela»;
   - comprobar el canonical de las vacantes con `utm_*`.

## Condiciones para empezar

- Lectura de los checkpoints del 2026-11-26 de `city-hub-pages`,
  `city-hub-stats`, `job-link-graph` y `home-role-hubs`, que siguen abiertos.
  Esta fase no debe contaminar sus mediciones.
- **Nunca debilitar las páginas de vacante** (Google Empleos da ~50 % de los
  clics): ni `noindex`, ni cambios de canonical, ni quitar la ciudad del
  título.
- El experimento de título «Trabajo en {ciudad}» va en un cambio aparte, con
  hubs de control. Revierte parcialmente `city-hub-pages`.
