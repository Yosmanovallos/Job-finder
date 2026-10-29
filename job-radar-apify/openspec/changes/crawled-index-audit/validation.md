# Validación — 2026-10-29

Base de aplicación a964fce; rama aislada codex/seo-lifecycle-strategy.
Cambios solo en docs/ y OpenSpec. No se modifica src/, tests/, estilos,
scripts, workflows, configuración ni datos de producción.

- CNI-001: informe 22-Oct con ejemplos 23/24-Oct frente a cinco inspecciones
  individuales que dicen indexada; cuatro muestran canonical propio aceptado
  y rastreo 26-Oct. No se interpreta el grupo antiguo como estado actual.
- CNI-002: JSON consistente: 10 URLs únicas / 5 inspecciones, IDs coinciden;
  las diez HTTP 200, canonical propio, SSR, 1 JobPosting y en sitemap actual.
  Datos públicos permitidos, sin HTML completo, credenciales o datos de usuarios.
- CNI-003: no se reproduce un fallo; no se modifica producción ni se solicita
  indexación de URLs ya indexadas. Caso de 80 palabras también está indexado.
- CNI-004: límites de indexación, ranking y disponibilidad real separados.
  No se declara crecimiento o recuperación global de las 9.745.
- pnpm lint: pasa.
- pnpm typecheck: pasa.
- pnpm test: 214 pasan; 8 pruebas de integración omitidas, no contadas como
  pasadas. No se reejecutan runners app de render/DB por documentos sin código.
- Comprobación local de JSON: pasa, incluida correspondencia de IDs, hashes
  distintos, rango 80–558 palabras y exactamente cinco registros Google.
- git diff --check: pasa antes de este cierre; repetir con diff staged.

La inspección de Consultor comercial quedó abierta para revisión del usuario.
La captura de pantalla de esta sesión falló por timeout del navegador; no se
presenta como guardada ni se usa una imagen anterior como prueba de este grupo.
Los estados se verificaron en la URL visible, DOM y accesibilidad de Google.

Salida de la fase: auditoría acotada terminada, sin parche de aplicación
justificado ni despliegue. Seguimiento global/ranking y las fases de retención
y landings quedan pendientes según el plan maestro, no realizados aquí.
