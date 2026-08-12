import type { ProviderId } from "./types.js";
import type { ProviderAdapter } from "./provider-adapter.js";

/**
 * Fase 4 de docs/RESUME-STUDIO-PLAN.md (§3.1) — objeto runtime, server-only
 * (los adapters concretos hacen `fetch` real). El registro es lo que evita
 * `if (provider === "google") ... else if (provider === "anthropic") ...`
 * desparramado por el código de negocio — cualquier caller pide un adapter
 * por id y llama la misma interfaz, sin saber qué proveedor hay detrás.
 */
export class UnknownProviderError extends Error {
  constructor(readonly providerId: ProviderId) {
    super(`Proveedor "${providerId}" no registrado en el ProviderRegistry.`);
    this.name = "UnknownProviderError";
  }
}

export class ProviderRegistry {
  private readonly adapters = new Map<ProviderId, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.providerId, adapter);
  }

  get(providerId: ProviderId): ProviderAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) throw new UnknownProviderError(providerId);
    return adapter;
  }

  has(providerId: ProviderId): boolean {
    return this.adapters.has(providerId);
  }

  list(): ProviderId[] {
    return [...this.adapters.keys()];
  }
}
