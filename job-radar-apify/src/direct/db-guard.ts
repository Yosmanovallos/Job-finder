/**
 * The direct-employer scripts write. The `.env` of the main checkout points
 * at PRODUCTION (there is no separate test database), so every script
 * refuses a non-loopback DATABASE_URL unless the caller passes
 * --allow-remote-db on purpose (the future GitHub Actions workflow, phase D2).
 * Runs before anything opens a connection.
 */
export function assertDirectDatabaseAllowed(databaseUrl: string | undefined, argv: string[]): void {
  if (!databaseUrl) throw new Error("[direct] Falta DATABASE_URL.");
  if (argv.includes("--allow-remote-db")) return;
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error("[direct] DATABASE_URL no es una URL válida.");
  }
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw new Error(
      `[direct] Bloqueado: DATABASE_URL apunta a "${host}", no a una base local. ` +
        "Usa la BD local (npm run direct:local-db -- up) o pasa --allow-remote-db a propósito."
    );
  }
}
