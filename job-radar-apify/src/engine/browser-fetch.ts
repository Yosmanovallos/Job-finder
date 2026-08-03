/**
 * Headless-browser fetch via Playwright + a residential proxy — the only
 * combination that gets past Cloudflare's block on Glassdoor and Indeed
 * from GitHub Actions' Azure IPs (see docs/BROWSER-SCRAPING-PLAN.md).
 *
 * Empirically established, in order:
 *   1. got-scraping's Chrome TLS fingerprint alone (no proxy) — hard 403
 *      from Azure IPs on both sites, flat "Forbidden" body, no challenge.
 *      That's a Cloudflare WAF rule blocking the datacenter ASN outright,
 *      not a fingerprint/behavior check — no HTTP-client-side trick gets
 *      past it.
 *   2. Residential proxy (Webshare Rotating Residential) + plain HTTP
 *      request — Cloudflare stops hard-blocking (no more flat 403) but
 *      serves a JS challenge page (`cf-mitigated: challenge` header) that a
 *      non-browser HTTP client cannot solve.
 *   3. Residential proxy + a REAL headless browser (this file) — passes
 *      cleanly, HTTP 200, real data, confirmed on both Glassdoor and Indeed.
 *
 * This is deliberately NOT used by the fast 15-min tick
 * (scripts/run-scrape-tick.ts / GLOBAL_SOURCE_CADENCE_MS /
 * SOURCE_CADENCE_MS) — a headless browser is much heavier (real Chromium
 * process, several seconds per page vs. sub-second HTTP fetches) and would
 * risk that tick's 3-minute global-catalog budget and 27-minute workflow
 * ceiling. It runs from a completely separate workflow/cadence instead —
 * see scripts/run-browser-tick.ts and
 * .github/workflows/scrape-browser-tick.yml.
 */

import { chromium, type Browser } from "playwright";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const LIB_CACHE = path.join(os.homedir(), ".cache", "job-radar-chromium-libs");
const REQUIRED_DEBS = [
  "libnspr4",
  "libnss3",
  "libatk1.0-0t64",
  "libatk-bridge2.0-0t64",
  "libcups2t64",
  "libdrm2",
  "libxkbcommon0",
  "libxcomposite1",
  "libxdamage1",
  "libxfixes3",
  "libxrandr2",
  "libgbm1",
  "libasound2t64",
  "libpango-1.0-0",
  "libcairo2",
];

/**
 * The Playwright-downloaded Chromium binary dynamically links libnspr4.so/
 * libnss3.so/etc, not bundled with the download. `npx playwright
 * install-deps` normally apt-installs these but needs root — GitHub
 * Actions' ubuntu-latest runners DO have that (unlike this repo's sandboxed
 * dev environment, where the same gotcha needed a no-root apt-get-download
 * workaround — see .claude/skills/run-job-radar-apify/driver.mjs). This
 * checks for the libs first and only downloads if missing, so it's a no-op
 * on a runner where `playwright install --with-deps` already handled it.
 */
function ensureChromiumLibs(): string {
  const libDir = path.join(LIB_CACHE, "usr", "lib", "x86_64-linux-gnu");
  if (fs.existsSync(path.join(libDir, "libnspr4.so"))) return libDir;

  console.log("[browser-fetch] Chromium runtime libs missing — downloading without sudo...");
  const debDir = path.join(LIB_CACHE, "_debs");
  fs.mkdirSync(debDir, { recursive: true });
  execSync(`apt-get download ${REQUIRED_DEBS.join(" ")}`, { cwd: debDir, stdio: "inherit" });
  for (const deb of fs.readdirSync(debDir).filter((f) => f.endsWith(".deb"))) {
    execSync(`dpkg-deb -x "${deb}" "${LIB_CACHE}"`, { cwd: debDir, stdio: "inherit" });
  }
  if (!fs.existsSync(path.join(libDir, "libnspr4.so"))) {
    throw new Error("[browser-fetch] libnspr4.so still missing after download");
  }
  return libDir;
}

function parseProxyUrl(proxyUrl: string) {
  const url = new URL(proxyUrl);
  return {
    server: `${url.protocol}//${url.hostname}:${url.port}`,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

let sharedBrowser: Browser | null = null;

/**
 * Lazily launches one shared browser instance for the whole process — each
 * `chromium.launch()` starts a real Chromium process (expensive), so a
 * multi-URL scraper run (Glassdoor's city queries, for instance) reuses one
 * browser across pages/contexts instead of launching N of them.
 * `closeBrowser()` must be called once at the end of the run.
 */
async function getBrowser(): Promise<Browser> {
  if (sharedBrowser) return sharedBrowser;

  const proxyUrl = process.env.WEBSHARE_PROXY_URL;
  if (!proxyUrl) {
    throw new Error(
      "[browser-fetch] WEBSHARE_PROXY_URL not set — required for browser-based scraping (Glassdoor/Indeed are Cloudflare-blocked from datacenter IPs without a residential proxy)."
    );
  }

  const libDir = ensureChromiumLibs();
  sharedBrowser = await chromium.launch({
    headless: true,
    executablePath: chromium.executablePath(),
    args: ["--no-sandbox"],
    env: { ...process.env, LD_LIBRARY_PATH: `${libDir}:${process.env.LD_LIBRARY_PATH || ""}` },
    proxy: parseProxyUrl(proxyUrl),
  });
  return sharedBrowser;
}

export async function closeBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}

/**
 * Navigates to `url` through the shared headless browser + residential
 * proxy and returns the RAW initial response body (not the post-hydration
 * DOM) — both Glassdoor's and Indeed's existing parsers expect the
 * server-rendered HTML with an embedded JSON blob in a `<script>` tag,
 * which is what the browser's first response carries, same as a plain HTTP
 * fetch would (just able to actually get a 200 instead of a block).
 *
 * Retries once on failure (403/timeout/connection error). This is safe to
 * do more freely than the fast tick's retry policy (gsFetch/executeWithResilience
 * fail fast on 401/403, deliberately not retrying a "no") because a
 * Rotating Residential proxy hands out a fresh exit IP per new browser
 * context — a retry here is a genuinely different network identity to the
 * target site, not hammering the same one that just said no. Confirmed
 * empirically: real Actions runs see roughly half of individual city
 * queries fail transiently (proxy-pool variance, not a systemic block —
 * the surrounding queries in the same run routinely succeed), so a retry
 * meaningfully improves coverage without increasing ban risk.
 */
async function browserFetchOnce(url: string, timeoutMs: number): Promise<string> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "es-CO",
  });
  try {
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    if (!response) {
      throw new Error(`[browser-fetch] No response for ${url}`);
    }
    const status = response.status();
    const body = await response.text();
    if (status !== 200) {
      throw new Error(`[browser-fetch] HTTP ${status} for ${url}`);
    }
    return body;
  } finally {
    await context.close();
  }
}

export async function browserFetch(url: string, timeoutMs = 30_000): Promise<string> {
  try {
    return await browserFetchOnce(url, timeoutMs);
  } catch (firstError: any) {
    console.warn(`[browser-fetch] First attempt failed for ${url}: ${firstError.message} — retrying once (fresh proxy IP)...`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return await browserFetchOnce(url, timeoutMs);
  }
}
