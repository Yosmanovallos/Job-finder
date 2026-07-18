import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpClient, HttpError } from "./http-client.js";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HttpClient", () => {
  it("returns status and body for a successful request", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(200, { jobs: [] }));
    const client = new HttpClient({ ratePerMinute: 100_000 });
    const response = await client.get("https://example.test/jobs");
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ jobs: [] });
  });

  it("returns non-retryable statuses like 404 to the caller", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse(404, { error: "not found" }));
    const client = new HttpClient({ ratePerMinute: 100_000 });
    const response = await client.get("https://example.test/nope");
    expect(response.status).toBe(404);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("retries 429 responses honoring Retry-After and then succeeds", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(429, {}, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = new HttpClient({ ratePerMinute: 100_000 });
    const response = await client.get("https://example.test/limited");
    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("retries network errors and throws HttpError after exhausting attempts", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("socket hang up"));
    const client = new HttpClient({ ratePerMinute: 100_000, maxRetries: 1, timeoutMs: 50 });
    await expect(client.get("https://example.test/down")).rejects.toThrow(HttpError);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("spaces requests according to the per-minute rate limit", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse(200, {}));
    const client = new HttpClient({ ratePerMinute: 6000 });
    const start = Date.now();
    await client.get("https://example.test/a");
    await client.get("https://example.test/b");
    await client.get("https://example.test/c");
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });
});
