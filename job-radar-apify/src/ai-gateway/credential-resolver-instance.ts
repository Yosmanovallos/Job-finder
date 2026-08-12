import { pool } from "../db/client.js";
import { CredentialResolver } from "./credential-resolver.js";

/**
 * Fase 11 de docs/RESUME-STUDIO-PLAN.md — mismo patrón lazy-singleton que
 * `registry-instance.ts`/`src/cv/gateway-instance.ts`. `CredentialResolver`
 * es un wrapper sin estado propio sobre `pool` (Fase 5), así que instanciarlo
 * más de una vez sería inofensivo, pero un singleton evita que cada caller
 * nuevo (server.ts, `resume-studio.ts`) tenga que repetir `new
 * CredentialResolver(pool)` por su cuenta.
 */
let cachedResolver: CredentialResolver | null = null;

export function getCredentialResolver(): CredentialResolver {
  if (!cachedResolver) {
    cachedResolver = new CredentialResolver(pool);
  }
  return cachedResolver;
}
