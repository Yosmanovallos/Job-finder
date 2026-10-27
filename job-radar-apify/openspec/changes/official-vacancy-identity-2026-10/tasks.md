# Tareas

- [x] Medir base pública y revisar grupos repetidos de Altipal.
- [x] Implementar clave de instancia para la lectura pública.
- [x] Añadir pruebas de contrato e integración.
- [x] Pasar lint dirigido, TypeScript, build y unitarias. El lint global conserva el error previo en `src/sources/types.ts:40`.
- [x] Ejecutar CI de conectores e integración y canario de lectura en runner con base de producción. CI: corridas 40534000785 y 40534008382; canarios 40533285459 y 40533508974.
- [x] Comparar el dashboard frío y MISS con el runbook tras desplegar `bdc843a` (PR #48).

Base previa al despliegue (2026-10-27, tres URL únicas por país, Cloudflare `MISS`):
`/dashboard` TTFB 363/269/249 ms; `/ve/dashboard` 336/241/253 ms.

Después del despliegue, tres URL únicas por país, todas Cloudflare `MISS`:
`/dashboard` TTFB 298/257/276 ms; `/ve/dashboard` 258/261/256 ms.
Render registró `dashboard_cache_warmed` para CO/VE en 2.194 ms antes de abrir
el puerto, seguido por `/api/health` 200 y el estado Live. Altipal devolvió 44
tarjetas con 44 IDs únicos, sin grupo de título/ubicación/descripción repetido;
dos detalles oficiales distintos respondieron 200. La consulta anterior y la
nueva tuvieron tiempos comparables en la segunda comparación del mismo runner.
