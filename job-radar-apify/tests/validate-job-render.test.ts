import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  buildJobPageBody,
  buildJobPagePayload,
  buildJobPath,
  escapeJsonForScriptTag
} from "../src/lib/job-seo.js";
import { readSsrJob, isMissingJobResponse } from "../src/lib/job-page-state.js";
import { buildCompanyJobsBlock, renderCompanyJobsHtml } from "../src/lib/job-company-links.js";
import type { Job } from "../src/sources/types.js";
import { boardJob, officialJob } from "./fixtures/job-page-blocks.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const job: Job = {
  jobId: "11111111-1111-4111-8111-111111111111",
  title: "Analista de Datos Sintetico",
  company: "Empresa de prueba",
  location: "Bogota, Colombia",
  source: "Magneto",
  url: "https://example.invalid/application",
  dateText: "Hoy",
  country: "CO",
  publishedAt: new Date().toISOString(),
  description:
    "Descripcion sintetica real para verificar que el contenido permanece visible cuando la API de detalle esta bloqueada.",
  isLocked: false
};

for (const width of [390, 1440]) {
  test(`JRD-001 real client retains SSR job when API blocked (${width}px)`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        serviceWorkers: "block"
      });
      let detailRequests = 0;
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== "https://render-test.invalid") return route.abort();
        if (url.pathname.startsWith("/api/jobs/")) {
          detailRequests++;
          return route.abort("blockedbyclient");
        }
        if (url.pathname.startsWith("/assets/")) {
          const file = path.resolve(root, "public", `.${url.pathname}`);
          assert.ok(file.startsWith(path.resolve(root, "public", "assets") + path.sep));
          return route.fulfill({ path: file });
        }
        if (url.pathname === buildJobPath(job)) {
          const html = (await readFile(path.join(root, "public/index.html"), "utf8"))
            .replace('<div id="app"></div>', `<div id="app">${buildJobPageBody(job)}</div>`)
            .replace(
              "</head>",
              `<script>window.__SSR_JOB__=${escapeJsonForScriptTag(buildJobPagePayload(job))};</script></head>`
            );
          return route.fulfill({ status: 200, contentType: "text/html", body: html });
        }
        return route.abort();
      });
      const page = await context.newPage();
      await page.goto(`https://render-test.invalid${buildJobPath(job)}`, {
        waitUntil: "networkidle"
      });
      await page.getByRole("heading", { level: 1, name: job.title }).waitFor({ timeout: 5000 });
      assert.ok((await page.locator("#app").innerText()).includes(job.description!));
      assert.doesNotMatch(await page.locator("#app").innerText(), /Esta vacante ya no/);
      assert.equal(detailRequests, 0);
      await page.screenshot({
        path: path.join(process.cwd(), `job-render-${width}.png`),
        fullPage: true
      });
      await context.close();
    } finally {
      await browser.close();
    }
  });
}

test("JRD-002 public snapshot rejects wrong ids/locked payloads and escapes source text", () => {
  assert.equal(readSsrJob("different", { job }), null);
  assert.equal(readSsrJob(job.jobId, { job: { ...job, isLocked: true } }), null);
  assert.equal(readSsrJob(job.jobId, null), null);
  assert.equal(readSsrJob(job.jobId, { job: { jobId: job.jobId } }), null);
  const jobWithPrivateFields = {
    ...job,
    title: "</script><script>evil()</script>",
    accessToken: "never-expose",
    email: "never-expose",
    internal: "never-expose"
  };
  const payload = buildJobPagePayload(jobWithPrivateFields);
  const encoded = escapeJsonForScriptTag(payload);
  assert.doesNotMatch(encoded, /<script|<\/script>|never-expose/);
  assert.equal(JSON.parse(encoded).job.title, "</script><script>evil()</script>");
  const reputation = [
    {
      source: "merco",
      score: 10,
      scoreScale: "100",
      reviewCount: null,
      sourceUrl: "https://example.invalid/reputation",
      internal: "never-expose"
    }
  ];
  const badges = buildJobPagePayload({ ...job, reputation });
  assert.equal(badges.job.reputation?.[0].score, 10);
  assert.doesNotMatch(JSON.stringify(badges), /never-expose/);
  assert.equal(readSsrJob(job.jobId, { job })?.description, job.description);
  assert.equal(
    readSsrJob(job.jobId, { job })?.description,
    job.description,
    "StrictMode may read again"
  );
});

test("JRD-003 only 404/410 mean missing", () => {
  for (const status of [404, 410]) assert.equal(isMissingJobResponse(status), true);
  for (const status of [200, 401, 403, 429, 500, 502, 503])
    assert.equal(isMissingJobResponse(status), false);
});

for (const status of [0, 200, 503, 404, 410]) {
  test(`JRD-002/003 no matching snapshot: API ${status || "blocked"} has honest state and retry`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ serviceWorkers: "block" });
      let attempts = 0;
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== "https://render-test.invalid") return route.abort();
        if (url.pathname.startsWith("/api/jobs/")) {
          attempts++;
          if (attempts > 1) return route.fulfill({ json: { job } });
          return status === 0
            ? route.abort("blockedbyclient")
            : route.fulfill({ status, json: { error: "fixture" } });
        }
        if (url.pathname.startsWith("/assets/")) {
          const file = path.resolve(root, "public", `.${url.pathname}`);
          assert.ok(file.startsWith(path.resolve(root, "public", "assets") + path.sep));
          return route.fulfill({ path: file });
        }
        if (url.pathname === buildJobPath(job)) {
          // A stale previous-route snapshot must never display that old job.
          const html = (await readFile(path.join(root, "public/index.html"), "utf8")).replace(
            "</head>",
            `<script>window.__SSR_JOB__=${escapeJsonForScriptTag({ job: { ...job, jobId: "other", title: "Wrong prior job" } })};</script></head>`
          );
          return route.fulfill({ status: 200, contentType: "text/html", body: html });
        }
        return route.abort();
      });
      const page = await context.newPage();
      await page.goto(`https://render-test.invalid${buildJobPath(job)}`, {
        waitUntil: "networkidle"
      });
      assert.equal(await page.getByRole("heading", { name: "Wrong prior job" }).count(), 0);
      if (status === 404 || status === 410) {
        await page.getByText("Esta vacante ya no está disponible.", { exact: false }).waitFor();
        assert.equal(await page.getByRole("alert").count(), 0);
      } else {
        await page.getByRole("alert").waitFor();
        assert.doesNotMatch(await page.locator("#app").innerText(), /Esta vacante ya no/);
        await page.getByRole("button", { name: "Reintentar", exact: true }).click();
        await page.getByRole("heading", { level: 1, name: job.title }).waitFor();
      }
      await context.close();
    } finally {
      await browser.close();
    }
  });
}

test("JRD-004 client navigation ignores stale snapshot and aborted old response", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const slowId = "22222222-2222-4222-8222-222222222222";
    const next = {
      ...job,
      jobId: "33333333-3333-4333-8333-333333333333",
      title: "Nueva vacante sintetica"
    };
    let releaseSlow: (() => Promise<void>) | undefined;
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== "https://render-test.invalid") return route.abort();
      if (url.pathname === `/api/jobs/${slowId}`) {
        releaseSlow = async () => {
          await route
            .fulfill({ json: { job: { ...job, jobId: slowId, title: "Respuesta antigua" } } })
            .catch(() => {});
        };
        return;
      }
      if (url.pathname === `/api/jobs/${next.jobId}`) return route.fulfill({ json: { job: next } });
      if (url.pathname.startsWith("/assets/")) {
        const file = path.resolve(root, "public", `.${url.pathname}`);
        assert.ok(file.startsWith(path.resolve(root, "public", "assets") + path.sep));
        return route.fulfill({ path: file });
      }
      if (url.pathname === buildJobPath(job)) {
        const html = (await readFile(path.join(root, "public/index.html"), "utf8")).replace(
          "</head>",
          `<script>window.__SSR_JOB__=${escapeJsonForScriptTag(buildJobPagePayload(job))};</script></head>`
        );
        return route.fulfill({ contentType: "text/html", body: html });
      }
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(`https://render-test.invalid${buildJobPath(job)}`, {
      waitUntil: "networkidle"
    });
    await page.getByRole("heading", { level: 1, name: job.title }).waitFor();
    const slowRequest = page.waitForRequest((request) =>
      request.url().endsWith(`/api/jobs/${slowId}`)
    );
    await page.evaluate((id) => {
      history.pushState({}, "", `/empleos/${id}/slow`);
      dispatchEvent(new PopStateEvent("popstate"));
    }, slowId);
    await slowRequest;
    assert.equal(await page.getByRole("heading", { level: 1, name: job.title }).count(), 0);
    await page.evaluate((url) => {
      history.pushState({}, "", url);
      dispatchEvent(new PopStateEvent("popstate"));
    }, buildJobPath(next));
    await page.getByRole("heading", { level: 1, name: next.title }).waitFor();
    await releaseSlow?.();
    assert.equal(await page.getByRole("heading", { level: 1 }).innerText(), next.title);
    await context.close();
  } finally {
    await browser.close();
  }
});

// JPD-007: B1, B2 and B3 read the same in the raw HTML and after React mounts
// (createRoot replaces the server markup), from the same embedded payloads.
const parityReputation = [
  { source: "merco", score: 7.5, scoreScale: "0-10", reviewCount: null, sourceUrl: "https://merco.example.invalid/ranking" },
  { source: "computrabajo", score: 4.2, scoreScale: "1-5", reviewCount: 318, sourceUrl: "https://ct.example.invalid/empresa" }
];
const companyRows = Array.from({ length: 9 }, (_, index) => ({
  jobId: `dddddddd-0000-4000-8000-${String(index).padStart(12, "0")}`,
  title: `Consultor ${index}`,
  company: "ACCENTURE S.A.S.",
  location: index % 3 ? "Medellín, Antioquia" : "Bogotá, D.C.",
  url: `https://example.invalid/c/${index}`,
  isLocked: false
}));
const parityCases = [
  { name: "warm B1 + reputation + careers", job: { ...boardJob, reputation: parityReputation }, snapshot: { total: 10, jobs: companyRows } },
  { name: "cold B1 + official employer", job: officialJob, snapshot: undefined }
];

// A string, not a function: tsx's keepNames would inject a __name helper
// that doesn't exist inside the page.
const READ_BLOCKS = `(() => {
  const links = (selector) =>
    [...document.querySelectorAll(selector)].map((a) => [
      a.getAttribute("href"),
      (a.textContent || "").replace(/\\s+/g, " ").trim(),
      a.getAttribute("rel") || ""
    ]);
  const reputation = document.querySelector("[data-company-reputation]");
  return {
    company: links("[data-company-jobs] a").map(([href, text]) => [href, text]),
    reputationLinks: [...(reputation ? reputation.querySelectorAll("a") : [])].map((a) => a.getAttribute("href")),
    reputationText: ((reputation && reputation.textContent) || "").replace(/\\s+/g, " "),
    careers: links("[data-official-careers] a"),
    officialSource: links("[data-official-source] a"),
    overflow: document.documentElement.scrollWidth - window.innerWidth
  };
})()`;

interface Blocks {
  company: string[][];
  reputationLinks: string[];
  reputationText: string;
  careers: string[][];
  officialSource: string[][];
  overflow: number;
}

for (const width of [390, 1440]) {
  for (const parity of parityCases) {
    test(`JPD-007 SSR and React show the same blocks: ${parity.name} (${width}px)`, async () => {
      const block = buildCompanyJobsBlock(parity.job, parity.snapshot)!;
      const browser = await chromium.launch({ headless: true });
      try {
        const html = (await readFile(path.join(root, "public/index.html"), "utf8"))
          .replace('<div id="app"></div>', `<div id="app">${buildJobPageBody(parity.job)}${renderCompanyJobsHtml(block)}</div>`)
          .replace(
            "</head>",
            `<script>window.__SSR_JOB_LINKS__=${escapeJsonForScriptTag({ jobId: parity.job.jobId, related: [], company: block })};</script>` +
              `<script>window.__SSR_JOB__=${escapeJsonForScriptTag(buildJobPagePayload(parity.job))};</script></head>`
          );
        const snapshots: Blocks[] = [];
        for (const javaScriptEnabled of [false, true]) {
          const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block", javaScriptEnabled });
          await context.route("**/*", async (route) => {
            const url = new URL(route.request().url());
            if (url.origin !== "https://render-test.invalid") return route.abort();
            if (url.pathname.startsWith("/assets/")) {
              const file = path.resolve(root, "public", `.${url.pathname}`);
              assert.ok(file.startsWith(path.resolve(root, "public", "assets") + path.sep));
              return route.fulfill({ path: file });
            }
            if (url.pathname === buildJobPath(parity.job)) return route.fulfill({ status: 200, contentType: "text/html", body: html });
            return route.abort();
          });
          const page = await context.newPage();
          await page.goto(`https://render-test.invalid${buildJobPath(parity.job)}`, { waitUntil: "networkidle" });
          if (javaScriptEnabled) {
            // React mounted: its own card (not the server <article>) holds the h1.
            await page.locator("#app h1").first().waitFor({ timeout: 5000 });
            await page.waitForFunction(() => !document.querySelector("#app > article"), null, { timeout: 5000 });
            await page.screenshot({ path: path.join(process.cwd(), `job-blocks-${parity.snapshot ? "warm" : "cold"}-${width}.png`), fullPage: true });
          }
          snapshots.push((await page.evaluate(READ_BLOCKS)) as Blocks);
          await context.close();
        }
        const [server, client] = snapshots;
        assert.deepEqual(client.company, server.company, "B1 links");
        assert.ok(server.company.length > 0, "B1 present");
        assert.deepEqual(client.reputationLinks, server.reputationLinks, "B2 source links");
        for (const entry of parity.job.reputation || []) {
          for (const side of [server, client]) {
            assert.ok(side.reputationText.includes(String(entry.score)) && side.reputationText.includes(`(${entry.scoreScale})`), entry.source);
            if (entry.reviewCount !== null) assert.ok(side.reputationText.includes(`${entry.reviewCount} reseñas`), side.reputationText);
          }
        }
        assert.deepEqual(client.careers, server.careers, "B3 careers link");
        assert.deepEqual(client.officialSource, server.officialSource, "B3 official source");
        if (parity.job.source === "Portal oficial") assert.equal(server.officialSource.length, 1);
        else assert.equal(server.careers.length, 1);
        assert.ok(client.overflow <= 0 && server.overflow <= 0, `no horizontal scroll at ${width}px`);
      } finally {
        await browser.close();
      }
    });
  }
}
