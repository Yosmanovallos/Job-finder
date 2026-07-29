#!/usr/bin/env node
// Driver for job-radar-apify — build, launch (frontend-only or full
// server+API), and drive it with a real headless Chromium. See SKILL.md.
//
// Usage:
//   node driver.mjs build                                   # vite build -> public/
//   node driver.mjs serve                                   # build + tsx src/server.ts on :3000, waits for /api/health
//   node driver.mjs stop                                    # kill whatever's on :3000 and :5173
//   node driver.mjs screenshot <url> <outfile> [waitForSel]  # navigate, wait, screenshot, print console errors
//   node driver.mjs smoke <outDir>                           # build+serve+screenshot /,/login,/dashboard+stop, exit non-zero on console errors

import { chromium } from "playwright";
import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../.."); // .claude/skills/run-job-radar-apify -> job-radar-apify

const LIB_CACHE = path.join(os.homedir(), ".cache", "job-radar-apify-chromium-libs");
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
  "libcairo2"
];

// The playwright-downloaded Chromium binary dynamically links libnspr4.so /
// libnss3.so / etc, which are NOT part of the playwright download — normally
// `npx playwright install-deps` apt-installs them, but that needs sudo with
// a TTY, which a non-interactive agent doesn't have. This downloads the
// .debs (apt-get download needs no root) and extracts them (no root either)
// into a cache dir outside the repo, reused across runs.
function ensureChromiumLibs() {
  const libDir = path.join(LIB_CACHE, "usr", "lib", "x86_64-linux-gnu");
  if (fs.existsSync(path.join(libDir, "libnspr4.so"))) return libDir;

  console.error("[driver] Chromium runtime libs missing — downloading without sudo (one-time)...");
  const debDir = path.join(LIB_CACHE, "_debs");
  fs.mkdirSync(debDir, { recursive: true });
  execSync(`apt-get download ${REQUIRED_DEBS.join(" ")}`, { cwd: debDir, stdio: "inherit" });
  for (const deb of fs.readdirSync(debDir).filter((f) => f.endsWith(".deb"))) {
    execSync(`dpkg-deb -x "${deb}" "${LIB_CACHE}"`, { cwd: debDir, stdio: "inherit" });
  }
  if (!fs.existsSync(path.join(libDir, "libnspr4.so"))) {
    throw new Error(`[driver] libnspr4.so still missing after download — apt-get download likely failed (see output above).`);
  }
  return libDir;
}

function waitForPort(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      execSync(`curl -sf ${url} -o /dev/null`, { stdio: "ignore" });
      return true;
    } catch {
      execSync("sleep 1");
    }
  }
  return false;
}

function killPort(port) {
  try {
    const pids = execSync(`lsof -ti:${port} -sTCP:LISTEN`).toString().trim();
    if (pids) execSync(`kill ${pids.split("\n").join(" ")}`);
  } catch {
    // nothing listening — fine
  }
}

function build() {
  console.error("[driver] vite build --outDir public ...");
  execSync("npx vite build --outDir public", { cwd: PROJECT_ROOT, stdio: "inherit" });
}

function serve() {
  killPort(3000);
  console.error("[driver] starting tsx src/server.ts on :3000 ...");
  const child = spawn("npx", ["tsx", "src/server.ts"], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  const up = waitForPort("http://localhost:3000/api/health", 30000);
  if (!up) throw new Error("[driver] server did not come up on :3000 within 30s — check .env (DATABASE_URL, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) and re-run `npx tsx src/server.ts` directly to see the error.");
  console.error("[driver] server up on http://localhost:3000");
}

async function screenshot(url, outPath, waitForSelector) {
  const libDir = ensureChromiumLibs();
  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    args: ["--no-sandbox"],
    env: { ...process.env, LD_LIBRARY_PATH: `${libDir}:${process.env.LD_LIBRARY_PATH || ""}` }
  });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(url, { waitUntil: "load", timeout: 20000 });
  if (waitForSelector) {
    await page.waitForSelector(waitForSelector, { timeout: 15000 });
  }
  await page.waitForTimeout(500);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath });
  await browser.close();

  console.error(`[driver] screenshot -> ${outPath}`);
  console.error(`[driver] console errors: ${consoleErrors.length ? JSON.stringify(consoleErrors) : "none"}`);
  return consoleErrors;
}

async function smoke(outDir) {
  build();
  serve();
  try {
    const routes = [
      { path: "/", selector: "text=BuscoTrabajo" },
      { path: "/login", selector: "form" },
      { path: "/dashboard", selector: 'input[placeholder*="palabra clave"]' }
    ];
    let anyErrors = false;
    for (const r of routes) {
      const out = path.join(outDir, `smoke${r.path.replace(/\//g, "_") || "_home"}.png`);
      const errors = await screenshot(`http://localhost:3000${r.path}`, out, r.selector);
      if (errors.length > 0) anyErrors = true;
    }
    if (anyErrors) {
      console.error("[driver] smoke FAILED — console errors on at least one route.");
      process.exitCode = 1;
    } else {
      console.error("[driver] smoke OK — all routes rendered with zero console errors.");
    }
  } finally {
    killPort(3000);
  }
}

const [, , cmd, ...args] = process.argv;

switch (cmd) {
  case "build":
    build();
    break;
  case "serve":
    serve();
    break;
  case "stop":
    killPort(3000);
    killPort(5173);
    console.error("[driver] stopped :3000 and :5173");
    break;
  case "screenshot": {
    const [url, outPath, waitForSelector] = args;
    if (!url || !outPath) {
      console.error("Usage: node driver.mjs screenshot <url> <outfile> [waitForSelector]");
      process.exit(1);
    }
    await screenshot(url, outPath, waitForSelector);
    break;
  }
  case "smoke": {
    const outDir = args[0] || "/tmp/job-radar-apify-smoke";
    await smoke(outDir);
    break;
  }
  default:
    console.error("Usage: node driver.mjs <build|serve|stop|screenshot|smoke> ...");
    process.exit(1);
}
