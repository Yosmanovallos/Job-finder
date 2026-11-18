// adsense-readiness F3 (ADS-040): real HTTP checks of /guias against the
// isolated runner's disposable PostgreSQL. Works in both states of
// GUIDES_ENABLED: off → every /guias path is a real 404, nothing in the
// sitemap, menu or hubs; on → live guides answer 200 with the full text and
// hubs link related guides. Read-only: inserts nothing.
import "./require-isolated-database.js";
import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { GUIDES_ENABLED } from "../src/config.js";
import { getPublishedGuides } from "../src/server/guides-store.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TEST_HTTP_PORT);
let failures = 0;

function check(condition: boolean, passMsg: string, failMsg: string): void {
  if (condition) console.log(`✅ [PASSED] ${passMsg}`);
  else {
    console.error(`❌ [FAILED] ${failMsg}`);
    failures++;
  }
}

function startServer(port: number): ChildProcess {
  return spawn(process.execPath, [...process.execArgv, path.join(__dirname, "..", "src", "server.ts")], {
    cwd: process.cwd(),
    shell: false,
    stdio: "inherit",
    env: { ...process.env, PORT: String(port) }
  });
}

async function waitFor(server: ChildProcess, base: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error(`El servidor terminó con código ${server.exitCode}.`);
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("El servidor de prueba no respondió.");
}

function stop(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    server.once("exit", () => resolve());
    server.kill("SIGTERM");
  });
}

async function main(): Promise<void> {
  const base = `http://127.0.0.1:${PORT}`;
  const live = getPublishedGuides();
  console.log(`\n--- ADS-040 /guias por HTTP (GUIDES_ENABLED=${GUIDES_ENABLED}, ${live.length} guías vigentes hoy) ---\n`);
  const server = startServer(PORT);
  try {
    await waitFor(server, base);
    const index = await fetch(`${base}/guias`);
    const indexHtml = await index.text();
    const sitemapIndex = await (await fetch(`${base}/sitemap.xml`)).text();
    const hubHtml = await (await fetch(`${base}/empleos/bogota`)).text();
    const llms = await (await fetch(`${base}/llms.txt`)).text();

    if (live.length === 0) {
      check(index.status === 404, "/guias responde 404 real con el interruptor apagado o sin guías vigentes.", `/guias respondió ${index.status}.`);
      check((await fetch(`${base}/guias/trabajo-remoto-colombia`)).status === 404, "Una guía responde 404 mientras no está publicada.", "Una guía no publicada no respondió 404.");
      check((await fetch(`${base}/sitemap-guides.xml`)).status === 404, "/sitemap-guides.xml responde 404.", "/sitemap-guides.xml no respondió 404.");
      check(!sitemapIndex.includes("sitemap-guides.xml"), "El índice del sitemap no lista guías.", "El índice del sitemap lista guías estando apagado.");
      check(!hubHtml.includes("data-related-guides"), "El hub no enlaza guías.", "El hub enlaza guías estando apagado.");
      check(!llms.includes("/guias"), "llms.txt no menciona /guias.", "llms.txt menciona /guias estando apagado.");
    } else {
      const first = live[0]!;
      const page = await fetch(`${base}/guias/${first.meta.slug}`);
      const html = await page.text();
      check(index.status === 200 && indexHtml.includes(`href="/guias/${first.meta.slug}"`), "/guias responde 200 y lista las guías vigentes.", `/guias respondió ${index.status} o no lista ${first.meta.slug}.`);
      check(page.status === 200 && html.includes(`data-guide="${first.meta.slug}"`) && html.includes('"@type":"Article"'), `/guias/${first.meta.slug} responde 200 con el texto y el JSON-LD Article.`, `La guía respondió ${page.status} o le falta el texto o el Article.`);
      check(html.includes('<meta name="bt-ads" content="on" />') && !indexHtml.includes('<meta name="bt-ads" content="on" />'), "Marcador de anuncios en la guía, no en el índice.", "El marcador de anuncios no está donde corresponde.");
      const markdown = await fetch(`${base}/guias/${first.meta.slug}`, { headers: { Accept: "text/markdown" } });
      check(markdown.status === 200 && (markdown.headers.get("content-type") || "").startsWith("text/markdown"), "La guía se sirve en Markdown con Accept: text/markdown.", "La guía no se sirvió en Markdown.");
      check((await fetch(`${base}/guias/no-existe`)).status === 404, "Una guía inexistente responde 404.", "Una guía inexistente no respondió 404.");
      const guidesSitemap = await (await fetch(`${base}/sitemap-guides.xml`)).text();
      check(sitemapIndex.includes("sitemap-guides.xml") && guidesSitemap.includes(`/guias/${first.meta.slug}</loc>`), "El sitemap de guías está en el índice y lista las guías vigentes.", "Falta el sitemap de guías o la guía en él.");
      const hidden = ["trabajo-de-temporada", "trabajo-sin-experiencia", "trabajo-remoto-colombia", "agencia-publica-de-empleo-sena", "medio-tiempo-fines-de-semana-por-dias", "ofertas-de-empleo-falsas", "prestaciones-sociales", "tipos-de-contrato-de-trabajo", "periodo-de-prueba", "liquidacion-del-contrato", "como-hacer-una-hoja-de-vida", "entrevista-de-trabajo"].filter((slug) => !live.some((guide) => guide.meta.slug === slug));
      for (const slug of hidden) {
        check((await fetch(`${base}/guias/${slug}`)).status === 404 && !guidesSitemap.includes(`/guias/${slug}<`), `${slug} (programada para después) sigue en 404 y fuera del sitemap.`, `${slug} se publicó antes de su fecha.`);
      }
      check(hubHtml.includes("data-related-guides") && hubHtml.includes("window.__SSR_GUIDE_LINKS__"), "El hub de Bogotá enlaza guías relacionadas en el HTML y en el payload.", "El hub de Bogotá no enlaza guías relacionadas.");
      check(llms.includes("/guias"), "llms.txt menciona /guias.", "llms.txt no menciona /guias estando encendido.");
    }
  } finally {
    await stop(server);
  }
  if (failures > 0) {
    console.error(`\n${failures} comprobaciones fallaron.`);
    process.exit(1);
  }
  console.log("\nTodas las comprobaciones de /guias pasaron.");
}

await main();
