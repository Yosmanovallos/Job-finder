# Tareas

- [x] Medir cobertura Computrabajo Colombia y auditar copias vinculadas.
- [x] Añadir diagnóstico de solo lectura, con muestra completa bajo `--all`.
- [x] Ajustar el emparejamiento de ciudades específicas y la reversión reciente.
- [x] Añadir pruebas de Bogotá D.C., Medellín, ubicación amplia y enlaces anteriores incorrectos.
- [x] Pasar TypeScript, lint dirigido, build, unitarias e integración aislada.
- [ ] Registrar el fallo previo del lint global en `src/sources/types.ts:40`; no atribuirlo a este cambio ni declarar el gate global aprobado.
- [x] Ejecutar canario de solo lectura: 4 copias recientes para restaurar, 31 antiguas sin redirección errónea.
- [ ] Desplegar tras CI y comprobar conteos, rutas y latencia pública.
