/**
 * Minimal HTTP client for source adapters: timeout, bounded retries with
 * exponential backoff + jitter, per-instance rate limiting and Retry-After
 * support. No external dependencies — Node 22 global fetch.
 *
 * Circuit breaking with persistent state is a Phase 3 deliverable and is
 * intentionally not implemented here.
 */

export interface HttpResponse {
  status: number;
  contentType: string;
  body: string;
}

/** Minimal getter contract; contract tests inject fixture-backed stubs. */
export interface HttpGetter {
  get(url: string): Promise<HttpResponse>;
}

export interface HttpClientOptions {
  timeoutMs?: number;
  /** Retries after the first attempt; total attempts = maxRetries + 1. */
  maxRetries?: number;
  ratePerMinute?: number;
  userAgent?: string;
}

export class HttpError extends Error {
  readonly status: number | null;
  readonly url: string;

  constructor(url: string, status: number | null, message: string) {
    super(`${message} (${url})`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export class HttpClient implements HttpGetter {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly minIntervalMs: number;
  private readonly userAgent: string;
  private nextSlotAt = 0;

  constructor(options: HttpClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.minIntervalMs = 60_000 / (options.ratePerMinute ?? 30);
    this.userAgent = options.userAgent ?? "job-radar-local/0.1 (personal job search)";
  }

  /**
   * GET a URL and return status + body. Retries transient failures
   * (network errors, 429, 5xx); non-retryable statuses (404, 403, …) are
   * returned to the caller, who decides what they mean for the source.
   */
  async get(url: string): Promise<HttpResponse> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.waitForSlot();
      try {
        const response = await fetch(url, {
          headers: { "user-agent": this.userAgent, accept: "application/json" },
          redirect: "follow",
          signal: AbortSignal.timeout(this.timeoutMs)
        });
        const body = await response.text();
        if (RETRYABLE_STATUS.has(response.status) && attempt < this.maxRetries) {
          await sleep(this.backoffMs(attempt, response.headers.get("retry-after")));
          continue;
        }
        return {
          status: response.status,
          contentType: response.headers.get("content-type") ?? "",
          body
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.maxRetries) {
          await sleep(this.backoffMs(attempt, null));
        }
      }
    }
    throw new HttpError(
      url,
      null,
      `Request failed after ${this.maxRetries + 1} attempts: ${lastError?.message ?? "unknown error"}`
    );
  }

  /** Serializes calls so this client never exceeds its per-minute budget. */
  private async waitForSlot(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = slot + this.minIntervalMs;
    if (slot > now) {
      await sleep(slot - now);
    }
  }

  private backoffMs(attempt: number, retryAfterHeader: string | null): number {
    if (retryAfterHeader !== null) {
      const seconds = Number(retryAfterHeader);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, 60_000);
      }
    }
    const base = 500 * 2 ** attempt;
    return base + Math.floor(Math.random() * base);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
