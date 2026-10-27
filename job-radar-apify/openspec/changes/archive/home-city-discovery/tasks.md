# Tareas

- [x] Inspeccionar inicio actual, baseline y contratos protegidos.
- [x] Presentar archivos, interfaces y pruebas antes de editar código.
- [x] Medir controles base y corregir medición: con eslint.config.js de esta rama hay un error en Job; los otros 23 procedían de usar configuración de otro checkout.
- [x] Resolver el error real declarando metadata opcional de Job sin any ni supresiones; lint global y typecheck pasan.
- [x] Reproducir ausencia de enlaces en pruebas de contenido.
- [x] Implementar bloque estático compartido y visible independiente de stats.
- [x] Pasar unitarias, typecheck, lint del cambio y comparar lint global.
- [x] Pasar baseline aislado y revisar capturas móvil/escritorio, incluidos clics sin stats.
- [x] Pasar integración aislada completa.
- [x] Publicar PR revisable con evidencia y limitaciones: #66 fusionado; CI completo pasa.
- [x] Desplegar tras gates y comprobar producción sin drift: 3c86082 confirmado activo en Render y por HTTP/DOM.
- [x] Cerrar gates globales pendientes antes de declarar fase completa/archivar: lint y typecheck globales pasan.
