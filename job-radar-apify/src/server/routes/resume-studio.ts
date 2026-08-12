import type { IncomingMessage, ServerResponse } from "node:http";
import { verifySession } from "../../auth/verify-session.js";
import { getProviderRegistry } from "../../ai-gateway/registry-instance.js";
import { getCredentialResolver } from "../../ai-gateway/credential-resolver-instance.js";
import type { ModelDescriptor, ProviderConnectionStatus, ProviderId } from "../../ai-gateway/types.js";
import { checkSensitiveRateLimit, readJsonBodyCapped, respondToUnexpectedError } from "../http-helpers.js";

export interface ResumeStudioRouteContext {
  pathname: string;
  method: string;
  parsedUrl: URL;
  clientIp: string;
}

/**
 * Route module for Resume Studio + BYOK (docs/RESUME-STUDIO-PLAN.md,
 * plan aprobado 2026-08-09). Mounted from server.ts for any pathname under
 * `/api/ai/` or `/api/resume-studio/` — keeps this feature's growing route
 * surface fuera de la cadena de 26 ramas ya existente en server.ts.
 * Devuelve `true` si manejó el request, `false` si nada calzó.
 *
 * Fase 5: primeras rutas reales — CRUD de credenciales BYOK. Mismo
 * criterio de acceso que las rutas de CV existentes (§2 del plan
 * aprobado: "Pro/Pro Max sigue como gate de acceso a la función", no solo
 * a la generación) — nunca alcanzable sin sesión verificada y tier real.
 */

const credentialResolver = getCredentialResolver();

function requireProAuth(session: Awaited<ReturnType<typeof verifySession>>): session is NonNullable<typeof session> {
  return !!session && (session.tier === "pro" || session.tier === "pro_max");
}

async function handleListProviders(res: ServerResponse, userId: string): Promise<void> {
  const registry = getProviderRegistry();
  const connected = await credentialResolver.listConnected(userId);
  const providers: ProviderConnectionStatus[] = registry.list().map((providerId) => {
    const row = connected.get(providerId);
    return {
      providerId,
      connected: !!row,
      label: row?.label ?? null,
      last4: row?.last4 ?? null,
      validatedAt: row?.validatedAt ?? null
    };
  });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ providers }));
}

interface ModelPickerGroup {
  providerId: ProviderId;
  connected: boolean;
  models: ModelDescriptor[];
}

/**
 * Fase 11 — respaldo del `ModelPicker.tsx` del header del Studio. Solo
 * pide `listModels()` a un adapter cuando el usuario SÍ tiene una
 * credencial conectada para ese proveedor — nunca hay un fallback de
 * catálogo "genérico" inventado (AGENTS.md regla 5 aplicada a metadata de
 * modelos, mismo criterio que Fase 4). Un proveedor real que falle al
 * listar (rate limit, key revocada del lado del proveedor sin que el
 * usuario la haya desconectado acá) nunca debe tumbar el picker completo
 * para los demás proveedores — se degrada a una lista vacía para ESE
 * proveedor, no un error 500 para toda la respuesta.
 */
async function handleListModels(res: ServerResponse, userId: string): Promise<void> {
  const registry = getProviderRegistry();
  const connected = await credentialResolver.listConnected(userId);
  const groups: ModelPickerGroup[] = await Promise.all(
    registry.list().map(async (providerId): Promise<ModelPickerGroup> => {
      if (!connected.has(providerId)) {
        return { providerId, connected: false, models: [] };
      }
      try {
        const resolved = await credentialResolver.resolve(userId, providerId);
        const models = resolved ? await registry.get(providerId).listModels(resolved.apiKey) : [];
        return { providerId, connected: true, models };
      } catch {
        return { providerId, connected: true, models: [] };
      }
    })
  );
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ providers: groups }));
}

async function handleConnectProvider(
  req: IncomingMessage,
  res: ServerResponse,
  clientIp: string,
  userId: string,
  providerId: string
): Promise<void> {
  if (!checkSensitiveRateLimit(clientIp, res, `POST /api/ai/providers/${providerId}/credentials`)) return;

  const registry = getProviderRegistry();
  if (!registry.has(providerId)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Proveedor "${providerId}" no reconocido.` }));
    return;
  }

  const body = await readJsonBodyCapped(req, 8 * 1024); // una API key nunca pesa más que unos pocos KB
  if (!body.ok) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Cuerpo de la solicitud inválido." }));
    return;
  }
  const { apiKey, label } = body.value ?? {};
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Falta apiKey." }));
    return;
  }
  if (label !== undefined && typeof label !== "string") {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "label debe ser texto si se envía." }));
    return;
  }

  // Nunca se guarda una key sin antes confirmar que el proveedor la acepta
  // — el plan aprobado (§ "Connect Google Gemini" wireframe) es explícito:
  // "No permitiría guardar una API key inválida sin advertir."
  const validation = await registry.get(providerId).validateCredentials(apiKey.trim());
  if (!validation.ok) {
    res.writeHead(422, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: validation.detail ?? "No se pudo validar la credencial con el proveedor." }));
    return;
  }

  const { last4 } = await credentialResolver.save(userId, providerId, apiKey.trim(), label?.trim() || undefined);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      providerId,
      connected: true,
      label: label?.trim() || null,
      last4,
      validatedAt: new Date().toISOString()
    } satisfies ProviderConnectionStatus)
  );
}

async function handleDisconnectProvider(res: ServerResponse, clientIp: string, userId: string, providerId: string): Promise<void> {
  if (!checkSensitiveRateLimit(clientIp, res, `DELETE /api/ai/providers/${providerId}/credentials`)) return;
  const removed = await credentialResolver.remove(userId, providerId);
  if (!removed) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "No había una credencial conectada para ese proveedor." }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok" }));
}

// /api/ai/providers/:id/credentials — captura el segmento :id sin traer un
// router de terceros (mismo estilo string-matching que el resto del
// proyecto, ver server.ts).
const PROVIDER_CREDENTIALS_PATTERN = /^\/api\/ai\/providers\/([a-z0-9_-]+)\/credentials$/;

export async function handleResumeStudioRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ResumeStudioRouteContext
): Promise<boolean> {
  const { pathname, method, clientIp } = ctx;

  // server.ts monta este módulo dentro de `http.createServer(async (req,
  // res) => {...})`, que NO tiene try/catch propio — un throw sin atrapar
  // en cualquier punto de abajo (ej. BYOK_ENCRYPTION_KEY faltante al
  // cifrar, ver credential-crypto.ts) se vuelve un unhandled rejection que
  // tumba el proceso Node ENTERO, para todos los usuarios, no solo esta
  // request (confirmado en vivo durante la verificación de Fase 6 con un
  // usuario Pro real). Un solo try/catch en este punto de entrada evita
  // que un error de cualquiera de los handlers de abajo se propague fuera
  // de este módulo.
  try {
    if (pathname === "/api/ai/providers" && method === "GET") {
      const session = await verifySession(req);
      if (!requireProAuth(session)) {
        res.writeHead(session ? 403 : 401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: session ? "Esta función requiere una suscripción Pro." : "No autenticado" }));
        return true;
      }
      await handleListProviders(res, session.id);
      return true;
    }

    if (pathname === "/api/ai/models" && method === "GET") {
      const session = await verifySession(req);
      if (!requireProAuth(session)) {
        res.writeHead(session ? 403 : 401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: session ? "Esta función requiere una suscripción Pro." : "No autenticado" }));
        return true;
      }
      await handleListModels(res, session.id);
      return true;
    }

    const credentialsMatch = pathname.match(PROVIDER_CREDENTIALS_PATTERN);
    if (credentialsMatch && (method === "POST" || method === "DELETE")) {
      const providerId = credentialsMatch[1]!;
      const session = await verifySession(req);
      if (!requireProAuth(session)) {
        res.writeHead(session ? 403 : 401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: session ? "Esta función requiere una suscripción Pro." : "No autenticado" }));
        return true;
      }
      if (method === "POST") {
        await handleConnectProvider(req, res, clientIp, session.id, providerId);
      } else {
        await handleDisconnectProvider(res, clientIp, session.id, providerId);
      }
      return true;
    }

    return false;
  } catch (err) {
    respondToUnexpectedError(res, err, `${method} ${pathname}`, "No se pudo procesar la solicitud de IA.");
    return true;
  }
}
