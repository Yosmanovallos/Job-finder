/**
 * IndexNow (Bing, Yandex, Seznam, Naver...) — SEO Fase B, ADR 0011.
 *
 * A separate, free notification channel from the Google Indexing API (ADR
 * 0004 and its 50/50 URL_UPDATED/URL_DELETED split are untouched): Bing's
 * index also feeds ChatGPT Search and Copilot. The key is PUBLIC by design —
 * the protocol proves site ownership by serving it at keyLocation
 * (static/<key>.txt, copied to public/ by the build).
 *
 * Pure except submitIndexNow(), which only touches the network when called
 * with `execute: true` and an injected fetch (scripts/indexnow-submit.ts).
 */
export const INDEXNOW_KEY = "a3d74e25e2888e95aec229405fb04ae1";
export const INDEXNOW_HOST = "buscotrabajo.co";
export const INDEXNOW_KEY_LOCATION = `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`;
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
/** Protocol limit per POST. */
export const INDEXNOW_MAX_URLS = 10_000;
const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 15_000;

export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

/**
 * Only absolute https URLs of this host, deduplicated, at most
 * INDEXNOW_MAX_URLS (the protocol rejects a batch with a foreign host).
 */
export function buildIndexNowPayload(urls: readonly string[]): IndexNowPayload {
  const seen = new Set<string>();
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.hostname !== INDEXNOW_HOST) continue;
    seen.add(url.toString());
    if (seen.size >= INDEXNOW_MAX_URLS) break;
  }
  return { host: INDEXNOW_HOST, key: INDEXNOW_KEY, keyLocation: INDEXNOW_KEY_LOCATION, urlList: [...seen] };
}

export type IndexNowResult =
  | { status: "dry-run"; urlCount: number }
  | { status: "skipped"; reason: "no-urls" }
  | { status: "sent"; httpStatus: number; attempts: number; urlCount: number }
  | { status: "failed"; httpStatus: number | null; attempts: number; urlCount: number; error: string };

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number }>;

/**
 * One bounded POST: at most MAX_ATTEMPTS, retrying only on 429/5xx/network
 * errors, each attempt with a timeout. 200 and 202 are success (202 = key
 * validation pending on the engine side). Without `execute`, never calls fetch.
 */
export async function submitIndexNow(
  payload: IndexNowPayload,
  options: { execute: boolean; fetch?: FetchLike; sleep?: (ms: number) => Promise<void> }
): Promise<IndexNowResult> {
  const urlCount = payload.urlList.length;
  if (urlCount === 0) return { status: "skipped", reason: "no-urls" };
  if (!options.execute) return { status: "dry-run", urlCount };
  if (!options.fetch) throw new Error("submitIndexNow: execute requires a fetch implementation.");
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastStatus: number | null = null;
  let lastError = "";
  let attempts = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await options.fetch(INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      lastStatus = response.status;
      if (response.status === 200 || response.status === 202) {
        return { status: "sent", httpStatus: response.status, attempts: attempt, urlCount };
      }
      lastError = `HTTP ${response.status}`;
      // 400/403/422 are permanent (bad request, key not verified, foreign URL).
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastStatus = null;
      lastError = error instanceof Error ? error.name : "network error";
    } finally {
      clearTimeout(timer);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(attempt * 5_000);
  }
  return { status: "failed", httpStatus: lastStatus, attempts, urlCount, error: lastError };
}
