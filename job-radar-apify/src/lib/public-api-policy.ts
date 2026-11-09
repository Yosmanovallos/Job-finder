/** Shared by runtime validation, tool schemas and discovery documents. */
export const PUBLIC_API_POLICY = {
  results: 3,
  offset: 0,
  perMinute: 5,
  perDay: 25,
  globalPerMinute: 30,
  globalPerDay: 500,
  concurrent: 2,
  bodyBytes: 16 * 1024,
  bodyTimeoutMs: 5000
} as const;

export const PUBLIC_API_USAGE = `Muestra gratuita: máximo ${PUBLIC_API_POLICY.results} resultados por búsqueda, sin paginación (offset=0). REST, MCP, A2A y WebMCP comparten ${PUBLIC_API_POLICY.perMinute} peticiones por minuto y ${PUBLIC_API_POLICY.perDay} por cada 24 horas por IP, incluyendo consultas de detalle, metadatos, solicitudes inválidas e inicialización de protocolos. Protección global por proceso: ${PUBLIC_API_POLICY.globalPerMinute} peticiones por minuto, ${PUBLIC_API_POLICY.globalPerDay} por cada 24 horas y ${PUBLIC_API_POLICY.concurrent} solicitudes simultáneas. HTTP 429 y Retry-After indican cuándo reintentar. Los contadores son temporales, se reinician al reiniciar el servidor y se mantienen por proceso.`;
