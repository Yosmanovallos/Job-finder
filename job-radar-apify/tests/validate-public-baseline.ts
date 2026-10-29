import "./require-isolated-database.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { buildJobPath } from "../src/lib/job-seo.js";
import type { SeoJob } from "../src/lib/job-seo.js";

const base = `http://127.0.0.1:${process.env.TEST_HTTP_PORT}`;

async function main(): Promise<void> {
  const server = spawn(
    process.execPath,
    [...process.execArgv, fileURLToPath(new URL("../src/server.ts", import.meta.url))],
    {
      cwd: process.cwd(),
      env: { ...process.env, PORT: process.env.TEST_HTTP_PORT },
      stdio: "inherit"
    }
  );
  const stop = () => {
    server.kill("SIGTERM");
  };
  process.once("exit", stop);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (server.exitCode !== null)
        throw new Error("[P0] El servidor del baseline terminó antes de iniciar.");
      try {
        const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        ready = false;
      }
      await delay(250);
    }
    assert.ok(ready, "[P0] El servidor del baseline no inició.");
    const response = await fetch(`${base}/api/jobs?country=CO&limit=1`);
    assert.equal(response.status, 200);
    const data = (await response.json()) as { jobs: SeoJob[] };
    assert.ok(data.jobs.length > 0, "[P0] Faltan las vacantes sintéticas del baseline.");
    const expandedCategories = new Map([
      ["/empleos/armenia", "CO"],
      ["/empleos/neiva", "CO"],
      ["/empleos/ibague", "CO"],
      ["/empleos/popayan", "CO"],
      ["/empleos/santa-marta", "CO"],
      ["/ve/empleos/ingeniero-civil", "VE"]
    ]);
    const routes = [
      "/",
      "/ve",
      "/dashboard",
      "/ve/dashboard",
      "/empleos/bogota",
      "/ve/empleos/project-manager",
      ...expandedCategories.keys(),
      "/empresas",
      "/ve/empresas",
      "/docs",
      "/about",
      "/contact",
      "/privacy",
      buildJobPath(data.jobs[0])
    ];
    const categoryRoutes = new Set(["/empleos/bogota", "/ve/empleos/project-manager", ...expandedCategories.keys()]);
    const snapshots: object[] = [];
    const browser = await chromium.launch({ headless: true });
    try {
      for (const [index, route] of routes.entries()) {
        const response = await fetch(`${base}${route}`, { signal: AbortSignal.timeout(10000) });
        assert.equal(response.status, 200, route);
        const html = await response.text();
        const homePilot = route === "/"
          ? { heading: "Ciudades destacadas en Colombia", paths: ["/empleos/bogota", "/empleos/santa-marta", "/empleos/neiva", "/empleos/armenia", "/empleos/ibague", "/empleos/valledupar", "/empleos/popayan", "/empleos/villavicencio", "/empleos/palmira", "/empleos/cucuta"], foreign: "/empleos/caracas" }
          : route === "/ve"
            ? { heading: "Ciudades y cargos destacados en Venezuela", paths: ["/empleos/caracas", "/empleos/maracay", "/empleos/valencia", "/ve/empleos/ingeniero-civil"], foreign: "/empleos/cucuta" }
            : null;
        if (homePilot) {
          for (const href of homePilot.paths) {
            assert.ok(html.includes(`href="${href}"`), `HCD-001 ${route}: SSR link ${href}`);
            const destination = await fetch(`${base}${href}`);
            assert.equal(destination.status, 200, `HCD-003 destination ${href}`);
            const destinationHtml = await destination.text();
            assert.ok(destinationHtml.includes(`rel="canonical" href="https://buscotrabajo.co${href}"`));
            if (expandedCategories.has(href)) {
              const raw = destinationHtml.match(/window\.__SSR_CATEGORY__=([\s\S]*?);<\/script>/)?.[1];
              assert.ok(raw, `MDE-004 snapshot ${href}`);
              const snapshot = JSON.parse(raw) as { country: string; total: number };
              assert.equal(snapshot.country, expandedCategories.get(href), `MDE-004 country ${href}`);
              assert.ok(snapshot.total > 0, `MDE-004 inventory ${href}`);
            }
          }
          assert.ok(!html.includes(`href="${homePilot.foreign}"`), `HCD-003 ${route}: foreign city`);
          const markdownResponse = await fetch(`${base}${route}`, { headers: { Accept: "text/markdown" } });
          assert.equal(markdownResponse.status, 200);
          assert.match(markdownResponse.headers.get("vary") || "", /Accept/i);
          const markdown = await markdownResponse.text();
          for (const href of homePilot.paths) assert.ok(markdown.includes(`](${href})`));
        }
        const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1];
        const canonical = html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/)?.[1];
        assert.ok(title && canonical, `[P0] ${route} no tiene metadatos SSR.`);
        const schema = [
          ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)
        ].map((match) => JSON.parse(match[1]) as unknown);
        if (categoryRoutes.has(route)) {
          assert.ok(
            html.includes("data-category-overview"),
            `[P0] ${route} no tiene resumen enriquecido en SSR.`
          );
          assert.ok(
            html.includes("Empresas en la muestra") &&
              html.includes("Fuentes verificables") &&
              html.includes("Publicadas en 7 días"),
            `[P0] ${route} no tiene las estadísticas verificables esperadas en SSR.`
          );
          // An empty hub (0 jobs) has nothing to describe and no stats section.
          const hasJobs = !html.includes("No hay vacantes en esta categoría por ahora.");
          assert.ok(
            !hasJobs ||
              html.includes("data-category-stats") &&
              html.includes("cifras de las ofertas activas") &&
              html.includes("en los últimos 30 días;"),
            `[P0] ${route} no tiene las cifras del hub en el HTML inicial.`
          );
        }
        if (route === "/empleos/santa-marta") {
          // Synthetic fixture: 3 "Asesor comercial" rows with COP salaries,
          // 2 "Auxiliar administrativo" rows, one free-text salary.
          for (const expected of [
            "Empresas que más contratan",
            "Empresa Sintetica Stats 1: 3 ofertas",
            'href="/empleos/asesor-comercial"',
            "Salario publicado por la fuente en 3 de las 5 ofertas de la muestra: entre COP 1.600.000 y COP 2.800.000.",
            "5 vacantes activas publicadas en los últimos 30 días; 0 son de los últimos 7 días."
          ]) {
            assert.ok(html.includes(expected), `[P0] /empleos/santa-marta: falta "${expected}" en SSR.`);
          }
        }
        await writeFile(path.join(process.cwd(), `baseline-${index}.html`), html);
        const pageErrors: string[] = [];
        for (const viewport of [
          { width: 1440, height: 900 },
          { width: 390, height: 844 }
        ]) {
          const context = await browser.newContext({ viewport, serviceWorkers: "block" });
          await context.route("**/*", (request) =>
            new URL(request.request().url()).origin === base ? request.continue() : request.abort()
          );
          const page = await context.newPage();
          page.on("pageerror", (error) => pageErrors.push(error.message));
          await page.goto(`${base}${route}`, { waitUntil: "networkidle", timeout: 15000 });
          await page.locator("#app").waitFor({ state: "visible", timeout: 10000 });
          if (categoryRoutes.has(route)) {
            const overview = page.locator("[data-category-overview]");
            await overview.waitFor({ state: "visible", timeout: 10000 });
            const overviewText = await overview.textContent();
            assert.ok(
              overviewText?.includes("Empresas en la muestra") &&
                overviewText.includes("Fuentes verificables") &&
                overviewText.includes("Publicadas en 7 días"),
              `[P0] ${route} perdió el resumen enriquecido después de cargar React.`
            );
            const stats = page.locator("[data-category-stats]");
            const emptyHub = html.includes("No hay vacantes en esta categoría por ahora.");
            assert.ok(
              emptyHub || (await stats.textContent())?.includes("cifras de las ofertas activas"),
              `[P0] ${route} perdió las cifras del hub después de cargar React.`
            );
          }
          await page.screenshot({
            path: path.join(process.cwd(), `baseline-${index}-${viewport.width}.png`),
            fullPage: true
          });
          if (route === "/empleos/santa-marta") {
            // The full-page capture leaves below-the-fold reveal animations
            // unplayed; center the stats block so its own capture is legible.
            const stats = page.locator("[data-category-stats]");
            await stats.evaluate((element) => element.scrollIntoView({ block: "center" }));
            await stats.screenshot({ path: path.join(process.cwd(), `city-stats-${index}-${viewport.width}.png`) });
          }
          if (homePilot) {
            const discovery = page.getByRole("navigation", { name: homePilot.heading, exact: true });
            await discovery.waitFor({ state: "visible" });
            assert.deepEqual(await discovery.locator("a").evaluateAll((links) => links.map((link) => link.getAttribute("href"))), homePilot.paths);
            // Optional stats cannot erase navigation. Keep this separate from
            // the normal screenshots and exercise the mobile tab state too.
            await page.route("**/api/home-stats*", (request) => request.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
            await page.reload({ waitUntil: "networkidle" });
            if (viewport.width < 768) await page.getByRole("tab", { name: "Por cargo", exact: true }).click();
            await page.getByRole("navigation", { name: homePilot.heading, exact: true }).waitFor({ state: "visible" });
            for (const href of homePilot.paths) {
              const link = page.getByRole("navigation", { name: homePilot.heading, exact: true }).locator(`a[href="${href}"]`);
              assert.ok(await link.isVisible());
              await link.click({ trial: true });
            }
            await page.getByRole("navigation", { name: homePilot.heading, exact: true }).evaluate((element) => element.scrollIntoView({ block: "center" }));
            await page.getByRole("navigation", { name: homePilot.heading, exact: true }).screenshot({ path: path.join(process.cwd(), `home-discovery-${index}-${viewport.width}.png`) });
          }
          await context.close();
        }
        snapshots.push({
          route,
          title,
          canonical,
          hreflang: [...html.matchAll(/<link[^>]*hreflang[^>]*>/g)].map((match) => match[0]),
          schema,
          pageErrors
        });
        assert.equal(pageErrors.length, 0, `[P0] ${route}: ${pageErrors.join("; ")}`);
      }
      await writeFile(
        path.join(process.cwd(), "public-baseline.json"),
        JSON.stringify({ synthetic: true, snapshots }, null, 2)
      );
      console.log(
        `[P0] Baseline público: ${snapshots.length} rutas, escritorio y móvil, sin acceder a producción.`
      );
    } finally {
      await browser.close();
    }
  } finally {
    stop();
    process.off("exit", stop);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "[P0] Falló el baseline público.");
  process.exitCode = 1;
});
