import { ProviderError, type Transport, type TransportRequest, type TransportResponse } from "./gateway.js";

// AI Resume Studio R3 — Alibaba Cloud Model Studio, Virginia (us-east-1),
// «United States» inference scope, OpenAI-compatible mode (ADR 0017 §4).
// Per the official docs read 2026-11-21:
//   - qwen3.7-flash/plus and qwen3.8-flash think by default → we always send
//     `enable_thinking: false` (top-level body field in raw HTTP);
//   - JSON mode is `response_format: {type: "json_object"}` and the prompt
//     must contain the word «JSON» (all our prompts do);
//   - usage: prompt_tokens, completion_tokens,
//     prompt_tokens_details.cached_tokens.
// No tools are offered, `tool_calls` in a reply are ignored, redirects are
// refused and the body is capped. Errors carry the HTTP status only.

const MAX_RESPONSE_BYTES = 256 * 1024;

export function buildQwenBody(request: TransportRequest): Record<string, unknown> {
  return {
    model: request.model,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user }
    ],
    max_tokens: request.maxTokens,
    // 0: the first live run had 16 % invalid JSON at 0.2.
    temperature: 0,
    response_format: { type: "json_object" },
    enable_thinking: false,
    stream: false
  };
}

export function qwenTransport(options: { baseUrl: string; apiKey: string; fetchImpl?: typeof fetch }): Transport {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return async (request: TransportRequest): Promise<TransportResponse> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify(buildQwenBody(request)),
        redirect: "error",
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timer);
      throw new ProviderError((error as Error)?.name === "AbortError" ? "timeout" : "network");
    }
    try {
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new ProviderError("http", res.status);
      }
      const text = await readCapped(res);
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        throw new ProviderError("bad_response");
      }
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new ProviderError("bad_response");
      const usage = json?.usage;
      return {
        content,
        finishReason: typeof json?.choices?.[0]?.finish_reason === "string" ? json.choices[0].finish_reason : null,
        usage:
          usage && Number.isFinite(usage.prompt_tokens) && Number.isFinite(usage.completion_tokens)
            ? {
                promptTokens: usage.prompt_tokens,
                completionTokens: usage.completion_tokens,
                cachedTokens: Number(usage.prompt_tokens_details?.cached_tokens) || 0
              }
            : null
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError((error as Error)?.name === "AbortError" ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
    }
  };
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new ProviderError("too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
