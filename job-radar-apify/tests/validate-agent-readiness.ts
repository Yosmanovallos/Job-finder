import "./require-isolated-database.js";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const base = `http://127.0.0.1:${process.env.TEST_HTTP_PORT}`;

function textLength(html: string): number {
  return html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
}

async function json(pathname: string, init?: RequestInit): Promise<{ response: Response; body: any }> {
  const response = await fetch(`${base}${pathname}`, { signal: AbortSignal.timeout(10000), ...init });
  return { response, body: await response.json() };
}

async function main(): Promise<void> {
  const server = spawn(process.execPath, [...process.execArgv, fileURLToPath(new URL("../src/server.ts", import.meta.url))], {
    cwd: process.cwd(), env: { ...process.env, PORT: process.env.TEST_HTTP_PORT }, stdio: "inherit"
  });
  const stop = () => server.kill("SIGTERM");
  process.once("exit", stop);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (server.exitCode !== null) throw new Error("El servidor de agent-readiness terminó antes de iniciar.");
      try {
        const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) { ready = true; break; }
      } catch { ready = false; }
      await delay(250);
    }
    assert.ok(ready, "El servidor de agent-readiness no inició.");

    const home = await fetch(`${base}/`, { headers: { Accept: "text/html", "Accept-Encoding": "gzip" } });
    const homeHtml = await home.text();
    assert.equal(home.status, 200);
    assert.match(home.headers.get("content-type") || "", /^text\/html; charset=utf-8/);
    assert.match(home.headers.get("cache-control") || "", /no-store/);
    assert.ok(textLength(homeHtml) >= 500);
    assert.equal((homeHtml.match(/<h1\b/g) || []).length, 1);
    assert.match(homeHtml, /href="\/docs"/);
    assert.match(homeHtml, /property="og:image"/);
    assert.match(homeHtml, /property="og:url"/);
    assert.match(homeHtml, /"contactPoint"/);
    assert.match(homeHtml, /"address"/);
    assert.match(home.headers.get("link") || "", /rel="api-catalog"/);

    const markdown = await fetch(`${base}/`, { headers: { Accept: "text/markdown", "Accept-Encoding": "gzip" } });
    assert.equal(markdown.status, 200);
    assert.match(markdown.headers.get("content-type") || "", /^text\/markdown; charset=utf-8/);
    assert.match(markdown.headers.get("cache-control") || "", /no-store/);
    const vary = (markdown.headers.get("vary") || "").toLowerCase();
    assert.ok(vary.includes("accept"));
    assert.ok(vary.includes("accept-encoding"));
    assert.ok((await markdown.text()).length >= 500);

    for (const pathname of ["/docs", "/about", "/contact", "/privacy"]) {
      const response = await fetch(`${base}${pathname}`);
      assert.equal(response.status, 200, pathname);
      assert.ok(textLength(await response.text()) >= 500, pathname);
    }

    const missingPath = `/missing-agent-readiness-${randomUUID()}`;
    const missingHtml = await fetch(`${base}${missingPath}`, { headers: { Accept: "text/html" } });
    assert.equal(missingHtml.status, 404);
    assert.match(missingHtml.headers.get("content-type") || "", /^text\/html; charset=utf-8/);
    assert.match(await missingHtml.text(), /sitemap\.xml|llms\.txt/);
    const missingMarkdown = await fetch(`${base}${missingPath}`, { headers: { Accept: "text/markdown" } });
    assert.equal(missingMarkdown.status, 404);
    assert.match(missingMarkdown.headers.get("content-type") || "", /^text\/markdown; charset=utf-8/);
    assert.ok((await missingMarkdown.text()).length >= 20);
    assert.equal((await fetch(`${base}/login`)).status, 200);

    const unknownApi = await json("/api/not-real");
    assert.equal(unknownApi.response.status, 404);
    assert.match(unknownApi.response.headers.get("content-type") || "", /^application\/json/);
    assert.equal(unknownApi.body.error.code, "route_not_found");
    assert.ok(unknownApi.body.error.requestId);

    const invalid = await json("/api/v1/jobs?limit=51");
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.body.error.code, "invalid_parameter");
    assert.ok(invalid.body.error.resolution);

    const listed = await json("/api/v1/jobs?country=CO&limit=2");
    assert.equal(listed.response.status, 200);
    assert.ok(listed.body.jobs.length > 0 && listed.body.jobs.length <= 2);
    assert.ok(listed.body.pagination.limit === 2);
    assert.match(listed.response.headers.get("access-control-allow-origin") || "", /^\*$/);
    const forbiddenFields = ["url_hash", "content_fingerprint", "email", "userId"];
    for (const field of forbiddenFields) assert.equal(field in listed.body.jobs[0], false, field);

    const jobId = listed.body.jobs[0].id;
    const detail = await json(`/api/v1/jobs/${jobId}`);
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.job.id, jobId);
    const absent = await json(`/api/v1/jobs/${randomUUID()}`);
    assert.equal(absent.response.status, 404);
    assert.equal(absent.body.error.code, "job_not_found");

    const countries = await json("/api/v1/countries");
    assert.equal(countries.response.status, 200);
    assert.deepEqual(countries.body.countries.map((country: any) => country.code), ["CO", "VE"]);

    const openapi = await json("/openapi.json");
    assert.equal(openapi.response.status, 200);
    assert.equal(openapi.body.openapi, "3.1.2");
    const operationIds = Object.values(openapi.body.paths).map((pathItem: any) => pathItem.get.operationId);
    assert.equal(new Set(operationIds).size, operationIds.length);

    const llms = await fetch(`${base}/llms.txt`);
    assert.equal(llms.status, 200);
    assert.match(llms.headers.get("content-type") || "", /^text\/plain; charset=utf-8/);
    const llmsText = await llms.text();
    for (const text of ["Cuándo usar", "Cuándo no usar", "No inventes", "No apliques automáticamente", "/openapi.json"]) assert.match(llmsText, new RegExp(text));

    const robots = await fetch(`${base}/robots.txt`);
    const robotsText = await robots.text();
    assert.match(robotsText, /Content-Signal: ai-train=no, search=yes, ai-input=yes/);
    const sitemap = await fetch(`${base}/sitemap-pages.xml`);
    const sitemapText = await sitemap.text();
    for (const pathname of ["/docs", "/about", "/contact", "/privacy"]) assert.match(sitemapText, new RegExp(`<loc>https://buscotrabajo.co${pathname}</loc>`));

    const catalog = await json("/.well-known/api-catalog");
    assert.equal(catalog.response.status, 200);
    assert.equal(catalog.response.headers.get("content-type"), 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"');
    assert.ok(Array.isArray(catalog.body.linkset));
    const catalogHead = await fetch(`${base}/.well-known/api-catalog`, { method: "HEAD" });
    assert.equal(catalogHead.status, 200);
    assert.match(catalogHead.headers.get("link") || "", /rel="api-catalog"/);

    for (const pathname of ["/.well-known/ai-catalog.json", "/.well-known/agent-skills/index.json", "/.well-known/mcp/server-card.json", "/.well-known/agent-card.json"]) {
      const response = await fetch(`${base}${pathname}`);
      assert.equal(response.status, 200, pathname);
      assert.equal(response.headers.get("access-control-allow-origin"), "*", pathname);
      await response.json();
    }

    const skillIndex = (await json("/.well-known/agent-skills/index.json")).body;
    for (const skill of skillIndex.skills) {
      const skillResponse = await fetch(skill.url.replace("https://buscotrabajo.co", base));
      assert.equal(skillResponse.status, 200);
      const artifact = await skillResponse.text();
      assert.equal(skill.digest, `sha256:${createHash("sha256").update(artifact).digest("hex")}`);
    }

    const mcpHeaders = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    const initialized = await json("/mcp", { method: "POST", headers: mcpHeaders, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } } }) });
    assert.equal(initialized.response.status, 200);
    assert.equal(initialized.body.result.protocolVersion, "2025-06-18");
    const tools = await json("/mcp", { method: "POST", headers: mcpHeaders, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) });
    assert.deepEqual(tools.body.result.tools.map((tool: any) => tool.name), ["search_jobs", "get_job", "list_supported_countries"]);
    const toolCall = await json("/mcp", { method: "POST", headers: mcpHeaders, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_jobs", arguments: { country: "CO", limit: 1 } } }) });
    assert.equal(toolCall.response.status, 200);
    assert.equal(toolCall.body.result.isError, false);
    assert.equal(toolCall.body.result.structuredContent.jobs.length, 1);
    assert.equal((await fetch(`${base}/mcp`, { headers: { Accept: "text/event-stream" } })).status, 405);

    const a2a = await json("/a2a", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "a2a-1", method: "message/send", params: { message: { kind: "message", messageId: randomUUID(), role: "user", parts: [{ kind: "data", data: { action: "search_jobs", country: "CO", limit: 1 } }] } } }) });
    assert.equal(a2a.response.status, 200);
    assert.equal(a2a.body.result.kind, "message");
    assert.equal(a2a.body.result.parts[0].data.jobs.length, 1);

    // RFC 9728: el resource identifier debe ser idéntico a aquel en el que se
    // insertó el sufijo well-known. Servido en la raíz => origen sin ruta.
    const protectedResource = await json("/.well-known/oauth-protected-resource");
    assert.equal(protectedResource.response.status, 200);
    assert.match(protectedResource.response.headers.get("content-type") || "", /^application\/json/);
    assert.equal(protectedResource.response.headers.get("access-control-allow-origin"), "*");
    assert.equal(protectedResource.body.resource, "https://buscotrabajo.co");
    assert.deepEqual(protectedResource.body.authorization_servers, [
      "https://wneeisleyngulowfcicp.supabase.co/auth/v1"
    ]);
    assert.deepEqual(protectedResource.body.bearer_methods_supported, ["header"]);
    assert.ok(Array.isArray(protectedResource.body.scopes_supported));

    const authMd = await fetch(`${base}/auth.md`);
    assert.equal(authMd.status, 200);
    assert.match(authMd.headers.get("content-type") || "", /^text\/markdown; charset=utf-8/);
    const authMdBody = await authMd.text();
    // El detector del escáner exige un H1 que contenga "auth.md".
    assert.match(authMdBody, /^# .*auth\.md/m);
    assert.ok(authMdBody.includes("/.well-known/oauth-protected-resource"));
    // Honestidad: no hay registro de agentes, y el documento debe decirlo.
    assert.ok(authMdBody.includes("No existe registro de agentes"));
    assert.ok(!/client registration \(RFC 7591\) disponible/i.test(authMdBody));

    // No publicamos metadatos de authorization server: el issuer no es nuestro
    // (RFC 8414 §3.3 / OIDC Discovery §4.3). Deben seguir devolviendo 404.
    for (const pathname of ["/.well-known/openid-configuration", "/.well-known/oauth-authorization-server", "/.well-known/http-message-signatures-directory"]) {
      assert.equal((await fetch(`${base}${pathname}`)).status, 404, pathname);
    }

    console.log("Agent readiness: HTTP, API, discovery, MCP and A2A checks passed.");
  } finally {
    stop();
    process.off("exit", stop);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
