# Validación documental — 2026-10-28

Base `195cb21`, rama `codex/seo-market-coverage`. Solo documentación y JSON
agregado. No cambios en src/, scripts/, workflows, configuración o dependencias.

- Consistencia JSON: veinte IDs únicos, 21 observaciones de inventario, cinco
  destinos del lote con 200, total visible >0, canonical propio y señal de
  página reciente. Parseo/contraste local pasa, sin acceso a producción.
- `git diff --check`: pasa.
- `pnpm lint`: pasa con la configuración de este checkout.
- `pnpm typecheck`: pasa.
- `pnpm test`: 214 pasan; ocho de integración del monorepo omitidas por su
  configuración, no contadas como pasadas.
- App `npx tsc --noEmit --pretty false`: pasa.
- App `npm run test:unit`: pasa, 40 suites offline/TCP bloqueado. Evidencia:
  OS temp `job-radar-test-e90a6a898715288349c6501a92a47b17-02xTfs/results.json`.
- No se repiten build, integración o baseline de aplicación para estos
  documentos; no se declaran corridos en esta entrega.

Acceso directo a GSC comprobado el 28-Oct sin Wizard. Windsor.ai localizado y
sugerido, instalación/conexión no confirmadas. Semrush sin unidades de API.
No se solicitan compras como condición de avance ni se leen claves/.env.

Las cifras GSC recientes terminan 26-Oct y las trimestrales 25-Oct. No miden
el piloto publicado 27-Oct. No se cierra la meta de crecimiento ni la fase 4.
