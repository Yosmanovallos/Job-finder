import { ProviderRegistry } from "./registry.js";
import { GoogleProviderAdapter } from "./adapters/google.js";
import { AnthropicProviderAdapter } from "./adapters/anthropic.js";
import { OpenAiProviderAdapter } from "./adapters/openai.js";
import { OpenRouterProviderAdapter } from "./adapters/openrouter.js";
import { OllamaProviderAdapter } from "./adapters/ollama.js";

/**
 * Fase 5 de docs/RESUME-STUDIO-PLAN.md — singleton lazy, mismo patrón que
 * `src/cv/gateway-instance.ts`. Los 5 adapters de Fase 4 se registran acá
 * una sola vez; cualquier route handler pide el registry ya armado en vez
 * de construir adapters por su cuenta. Registrar un adapter aquí NO lo
 * activa para nadie — eso depende de si el usuario conecta una credencial
 * real (Fase 6) y de si `RESUME_STUDIO_ENABLED`/`resume_studio_beta` dejan
 * pasar el request hasta acá en primer lugar (Fase 1).
 */
let cachedRegistry: ProviderRegistry | null = null;

export function getProviderRegistry(): ProviderRegistry {
  if (!cachedRegistry) {
    const registry = new ProviderRegistry();
    registry.register(new GoogleProviderAdapter());
    registry.register(new AnthropicProviderAdapter());
    registry.register(new OpenAiProviderAdapter());
    registry.register(new OpenRouterProviderAdapter());
    registry.register(new OllamaProviderAdapter());
    cachedRegistry = registry;
  }
  return cachedRegistry;
}
