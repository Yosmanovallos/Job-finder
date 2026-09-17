/**
 * Transport resolution (P4, spec SRC-006).
 *
 * Transport stops being a decision baked into each scraper and becomes a
 * policy a source declares: direct by default, proxy only where it is
 * explicitly declared and authorized.
 *
 * The environment variable keeps its existing name (`WEBSHARE_PROXY_URL`) on
 * purpose — renaming it would be a deployment change dressed up as a
 * refactor. What changes is WHERE it is read: the policy decides whether a
 * source uses the proxy at all, and only then is the credential looked up.
 *
 * Nothing here weakens any access control. The proxy exists because Glassdoor
 * and Indeed are Cloudflare-blocked from datacenter IPs; it is a transport
 * for requests we are already authorized to make, not a way around a control
 * (AGENTS.md #8).
 */

import { resolvePolicy, type SourceStage } from "../sources/source-policy.js";

/**
 * A source declared a transport it cannot use. Named so that
 * `classifyFetchResult` maps it to `misconfigured` rather than to a generic
 * failure — "I have no credential" must never look like "there are no jobs".
 */
export class MisconfiguredTransportError extends Error {
  constructor(source: string, detail: string) {
    super(`[transport] ${source}: ${detail}`);
    this.name = "MisconfiguredTransportError";
  }
}

export interface ResolvedTransport {
  readonly kind: "direct" | "proxy";
  /** Present only for `proxy`. Never logged. */
  readonly proxyUrl?: string;
}

/**
 * Resolves how a (source, stage) should reach the network.
 *
 * A source that does NOT declare proxy never touches the credential, so
 * setting `WEBSHARE_PROXY_URL` cannot change the behavior of anything that
 * did not ask for it — that is the guarantee SRC-006 makes.
 */
export function resolveTransport(source: string, stage: SourceStage): ResolvedTransport {
  const policy = resolvePolicy(source, stage);
  if (policy.transport !== "proxy") return { kind: "direct" };

  const proxyUrl = process.env.WEBSHARE_PROXY_URL;
  if (!proxyUrl) {
    // Deliberately not a silent fallback to direct: a source that declares
    // proxy does so because direct does not work for it, and quietly trying
    // direct would produce a confusing "empty" instead of a stated cause.
    throw new MisconfiguredTransportError(
      source,
      "declara transporte proxy pero WEBSHARE_PROXY_URL no está configurado."
    );
  }
  return { kind: "proxy", proxyUrl };
}
