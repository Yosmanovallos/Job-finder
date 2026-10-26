# Computrabajo Colombia: primera revisión manual posterior a TP

Fecha: 2026-10-25 (Colombia). Conjunto: empresas con vacantes vigentes de Computrabajo CO, según el [censo 40257210332](https://github.com/Yosmanovallos/Job-finder/actions/runs/40257210332). Una revisión de portal propio es distinta del sondeo automatizado por nombre de ATS. Los estados son observaciones que se deben volver a comprobar antes de habilitar un tablero.

| Empresa | Vacantes Computrabajo en el censo | Evidencia y resultado | Estado |
|---|---:|---|---|
| Smurfit Westrock | 3 | Su [página de carreras de Colombia](https://www.smurfitkappa.com/co/people/careers) enlaza Magneto. `GET /co/empresas/smurfit-westrock/empleos` respondió 200 al UA del bot, pero declaró `totalRows=5`, `totalHits=14`, faceta=14 e ItemList=5; el conector exige que coincidan. Una fila visible nombra Colrecicladora, así que también hace falta revisar la atribución de cada oferta. | `official_incomplete` |
| Grupo Éxito | 12 | La [página del grupo](https://www.grupoexito.com.co/es/colaboradores/juntos-lo-logramos) enlaza Magneto. El [canario previo](magneto-official.md) halló 20 filas frente a `totalRows=66` y `totalHits=2904`; el conector lo rechaza. También hay un portal Pandapé, que no se cuenta como fuente independiente. | `official_incomplete` |
| Salesland Colombia | 27 | El [portal de empleos propio](https://trabajo.salesland.net/jobs) ofrece RSS Teamtailor permitido por robots. Se paginaron 100 + 68 entradas; ninguna tenía `tt:country` Colombia/CO. No se debe inferir que sus ofertas de Computrabajo estén en ese feed. | `official_no_colombia` |
| D1 S A S | 2 | El [sitio de reclutamiento](https://reclutamiento.d1.com.co/) presenta un formulario de hoja de vida, sin listado verificable de vacantes en la página observada. | `form_only` |
| Bancamia S.A. | 15 | Su [página corporativa](https://www.bancamia.com.co/somos_bancamia-nosotros/) enlaza `bancamia-co.sherlockhr.com` y Pandapé. El primero falló la validación TLS por nombre de certificado con el UA del bot; no se desactiva la verificación TLS. Pandapé pertenece al ecosistema de Computrabajo. | `blocked` |

`data/computrabajo-official-reviews.json` guarda los estados y enlaces. La revisión no implica que todas las vacantes de Computrabajo tengan una contraparte oficial. Ninguno de estos cinco tableros se habilita en este lote.

El modo manual `computrabajo-backlog` del workflow Direct Employers Tick imprime una línea JSON por empresa con `companyKey`, cantidad de vacantes, tablero habilitado, decisión automática y estado manual. El resumen `computrabajo-coverage` informa cuántas empresas tienen revisión manual documentada y cuántas siguen pendientes. La exportación no lee páginas de Computrabajo ni escribe en la base.
