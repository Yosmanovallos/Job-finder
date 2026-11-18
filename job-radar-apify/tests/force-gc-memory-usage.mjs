// Test-only preload for validate-sitemap-streaming.ts. It is loaded only via
// `--import` when that suite spawns its own server (never in production, which
// neither passes --expose-gc nor imports this file).
//
// Without it, `heapUsed` from /api/health depends on when V8 last collected,
// not on what the process really retains: the same commit measured 55–68 MB
// across runs against a 64 MB budget. A full GC before each reading makes the
// number reflect live (retained) memory only.
if (typeof globalThis.gc !== "function") {
  // Never fall back to the noisy reading: a misconfigured spawn must fail loudly.
  throw new Error("force-gc-memory-usage.mjs requires node --expose-gc.");
}

const gc = globalThis.gc;
const memoryUsage = process.memoryUsage.bind(process);

function memoryUsageAfterGc() {
  const pre = memoryUsage();
  gc();
  const post = memoryUsage();
  // GC may return pages to the OS; keep the higher RSS so the RSS budget in the
  // suite is never looser than it was before this preload existed.
  return { ...post, rss: Math.max(pre.rss, post.rss) };
}

process.memoryUsage = Object.assign(memoryUsageAfterGc, { rss: process.memoryUsage.rss });
