# Altipal: vacantes del portal CreeSer

Revisión: 2026-10-27. La [página «Trabaja con nosotros» de Altipal](https://altipal.co/trabaja-con-nosotros/) enlaza el [listado público CreeSer](https://creeser.hr-suite.app/vacantes.php). La fuente corresponde al portal de empleabilidad elegido por la empresa; las vacantes no se obtienen de Computrabajo.

El listado respondió HTTP 200 con el identificador `BuscoTrabajoBot/1.0`. Se observaron 51 tarjetas, 51 enlaces de aplicación e identificadores únicos, sin paginación. `robots.txt` permite listado y detalle. El canario local, de solo lectura, obtuvo 3/3 fichas con descripción y fecha declarada. No se inició sesión ni se envió una postulación.

El conector exige el marcador y la estructura del listado, un enlace único por tarjeta, ciudad colombiana conocida, fechas válidas y ausencia de paginación. Interpreta «Publicado en» como hora local de Colombia (`UTC−05:00`) y «Fecha Fin de Postulación» hasta el final de ese día local. Si una ficha nueva no está disponible, su detalle no coincide o el sitio cambia de forma, falla el listado sin guardar ni cerrar ofertas. El presupuesto es 25 fichas nuevas por tick; las restantes se difieren a la próxima lectura.

El seed empieza con `enabled: false`. Antes de habilitarlo se requiere un canario exitoso en GitHub Actions con el mismo entorno del tick de producción. La lectura local no prueba accesibilidad desde ese runner. Una vacante oficial no equivale automáticamente a cada anuncio de Computrabajo; la proyección reemplaza copias solo cuando las reglas de coincidencia lo respaldan.
