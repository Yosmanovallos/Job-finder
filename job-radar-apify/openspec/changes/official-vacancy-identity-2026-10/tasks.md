# Tareas

- [x] Medir base pública y revisar grupos repetidos de Altipal.
- [x] Implementar clave de instancia para la lectura pública.
- [x] Añadir pruebas de contrato e integración.
- [x] Pasar lint dirigido, TypeScript, build y unitarias. El lint global conserva el error previo en `src/sources/types.ts:40`.
- [x] Ejecutar CI de conectores e integración y canario de lectura en runner con base de producción. CI: corridas 40534000785 y 40534008382; canarios 40533285459 y 40533508974.
- [ ] Comparar el dashboard frío y MISS con el runbook antes de cerrar la fase.

Base previa al despliegue (2026-10-27, tres URL únicas por país, Cloudflare `MISS`):
`/dashboard` TTFB 363/269/249 ms; `/ve/dashboard` 336/241/253 ms.
