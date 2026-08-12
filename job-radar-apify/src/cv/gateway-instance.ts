import { pool } from "../db/client.js";
import { loadModelsConfig, type ModelsConfig } from "./model-config.js";
import { ModelGateway } from "./model-gateway.js";
import { buildOpenAiCompatibleClientFromEnv, OpenAiCompatibleClient } from "./openai-compatible-client.js";
import { getProviderRegistry } from "../ai-gateway/registry-instance.js";

/**
 * Lazy singleton gateway — el único wireado en el HTTP path real
 * (docs/CV-GENERATION-PLAN.md §5.1). Config path controlado por
 * `CV_MODELS_CONFIG_PATH` (default `config/models.dev.yaml`, tier
 * gratuito) para que activar el gasto real (`config/models.local.yaml`,
 * Fase 8) sea una variable de entorno explícita, nunca un valor por
 * defecto ni un cambio de código que un commit futuro pueda arrastrar sin
 * querer — un despliegue que no setee la variable se queda en gratuito
 * automáticamente, incluso si este archivo ya trae la lógica de
 * `cv_draft`/`cv_critique` activa (`active: true`, Fase 8, §10).
 *
 * **Bloqueo real antes de poder desplegar esto, sin resolver todavía:**
 * `config/` completo está sin trackear en git (`git ls-files config/`
 * devuelve vacío) — incluyendo `models.dev.yaml`, que SÍ debe
 * comprometerse (config de tier gratuito, sin secretos; distinto de
 * `models.local.yaml`, gitignored a propósito). Sin ese archivo en el
 * repo, un deploy desde git (Render) no tendría `config/models.dev.yaml`
 * y `loadModelsConfig()` lanzaría en la primera request real.
 *
 * Extracted from `extract-facts.ts` (Fase 6) once a second real call site
 * (`server.ts`'s generate/regenerate routes, Fase 7) needed the exact same
 * singleton — not duplicated a second time.
 */
let cachedConfig: ModelsConfig | null = null;
let cachedClient: OpenAiCompatibleClient | null = null;
let cachedGateway: ModelGateway | null = null;

export function getDevGateway(): ModelGateway {
  if (!cachedGateway) {
    const configPath = process.env.CV_MODELS_CONFIG_PATH ?? "config/models.dev.yaml";
    cachedConfig = cachedConfig ?? loadModelsConfig(configPath);
    cachedClient =
      cachedClient ?? buildOpenAiCompatibleClientFromEnv(cachedConfig.providers.openai_compatible.base_url_env);
    // Fase 11 de docs/RESUME-STUDIO-PLAN.md: opcional en `ModelGateway`, sin
    // efecto para ningún caller que no pase `RunContext.providerId`/
    // `modelId`/`apiKey` — resuelve exactamente igual que antes de esta
    // fase (ver el comentario de `GatewayOptions.providerRegistry`).
    cachedGateway = new ModelGateway({ config: cachedConfig, client: cachedClient, pool, providerRegistry: getProviderRegistry() });
  }
  return cachedGateway;
}
