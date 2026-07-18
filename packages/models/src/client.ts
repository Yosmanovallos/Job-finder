import Anthropic from "@anthropic-ai/sdk";

export interface CompletionRequest {
  model: string;
  system: string;
  user: string;
  maxOutputTokens: number;
}

export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/** Provider-agnostic seam; tests and evals inject deterministic fakes. */
export interface ModelClient {
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

/**
 * Anthropic client. Requires ANTHROPIC_API_KEY at call time — construction is
 * cheap and side-effect free so offline paths (cache hits, evals with mocks)
 * never need the key.
 */
export class AnthropicModelClient implements ModelClient {
  private sdk: Anthropic | null = null;

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Add it to .env to enable cloud model calls."
      );
    }
    this.sdk ??= new Anthropic();
    const response = await this.sdk.messages.create({
      model: request.model,
      max_tokens: request.maxOutputTokens,
      system: request.system,
      messages: [{ role: "user", content: request.user }]
    });
    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens
    };
  }
}
