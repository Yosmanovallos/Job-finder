import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  A2A_AGENT_CARD,
  AGENT_SKILL_ARTIFACTS,
  AGENT_SKILLS_INDEX,
  AI_CATALOG,
  API_CATALOG,
  DISCOVERY_LINKS,
  MCP_SERVER_CARD,
  OPENAPI_DOCUMENT,
  PUBLIC_PAGES,
  getHomeContent,
  renderContentHtml,
  renderContentMarkdown,
  wantsMarkdown
} from "../src/lib/agent-readiness.js";
import { parsePublicJobsQuery, toPublicJob } from "../src/lib/public-jobs-api.js";
import { registerBuscoTrabajoWebMcp } from "../src/lib/webmcp.js";

function visibleText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

test("home content is substantial and headings are sequential", () => {
  for (const country of ["CO", "VE"] as const) {
    const html = renderContentHtml(getHomeContent(country));
    assert.ok(visibleText(html).length >= 500);
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));
    assert.equal(levels[0], 1);
    assert.equal(levels.filter((level) => level === 1).length, 1);
    for (let index = 1; index < levels.length; index++) assert.ok(levels[index]! <= levels[index - 1]! + 1);
    assert.match(html, /href="\/docs"/);
  }
});

test("trust and docs pages contain factual substantial HTML and Markdown", () => {
  for (const pathname of ["/docs", "/about", "/contact", "/privacy"]) {
    const page = PUBLIC_PAGES[pathname];
    assert.ok(page, pathname);
    assert.ok(visibleText(renderContentHtml(page)).length >= 500, pathname);
    assert.ok(renderContentMarkdown(page).length >= 500, pathname);
  }
});

test("Accept negotiation only selects Markdown with positive preference", () => {
  assert.equal(wantsMarkdown("text/markdown"), true);
  assert.equal(wantsMarkdown("text/html, text/markdown;q=0.9"), false);
  assert.equal(wantsMarkdown("text/markdown;q=0, text/html"), false);
  assert.equal(wantsMarkdown("text/markdown;q=1, text/html;q=0.5"), true);
  assert.equal(wantsMarkdown(undefined), false);
});

test("OpenAPI operations are typed, unique and read-only", () => {
  assert.equal(OPENAPI_DOCUMENT.openapi, "3.1.2");
  assert.deepEqual(OPENAPI_DOCUMENT.servers, [{ url: "https://buscotrabajo.co" }]);
  const ids: string[] = [];
  for (const [pathname, pathItem] of Object.entries(OPENAPI_DOCUMENT.paths as Record<string, { get: any }>)) {
    assert.deepEqual(Object.keys(pathItem), ["get"], pathname);
    const operation = pathItem.get;
    ids.push(operation.operationId);
    assert.ok(operation.description.length >= 20, pathname);
    assert.ok(operation.responses["200"], pathname);
    assert.ok(operation.responses["400"] || operation.responses["404"] || pathname === "/api/health", pathname);
    for (const parameter of operation.parameters || []) {
      assert.ok(parameter.schema?.type || parameter.schema?.$ref, `${pathname}:${parameter.name}`);
    }
  }
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(OPENAPI_DOCUMENT.components.schemas.ApiError.required.includes("error"));
});

test("public job projection bounds external text and rejects unsafe source URLs", () => {
  const job = toPublicJob({
    jobId: "ebbbb452-8186-4afc-ab25-3e90ef645295",
    title: "T".repeat(400),
    company: "Empresa",
    location: "Remoto",
    source: "Fuente",
    sources: ["S".repeat(200)],
    publishedAt: "2026-09-18T00:00:00.000Z",
    country: "CO",
    description: "D".repeat(9_000),
    requirements: ["R".repeat(600)],
    technologies: ["X".repeat(200)],
    salaryCurrency: "C".repeat(20),
    salaryRaw: "P".repeat(200),
    url: "javascript:alert(1)"
  });
  assert.ok(job);
  assert.equal(job.title.length, 300);
  assert.equal(job.sources[0]?.length, 100);
  assert.equal(job.description?.length, 8_000);
  assert.equal(job.requirements[0]?.length, 500);
  assert.equal(job.technologies[0]?.length, 100);
  assert.equal(job.salaryCurrency?.length, 12);
  assert.equal(job.salaryRaw?.length, 160);
  assert.equal(job.applicationUrl, null);
});

test("API catalog and discovery links use real registered relations", () => {
  assert.ok(Array.isArray(API_CATALOG.linkset));
  assert.equal(API_CATALOG.linkset[0]?.anchor, "https://buscotrabajo.co/api/v1");
  assert.equal(API_CATALOG.linkset[0]?.["service-desc"]?.[0]?.href, "https://buscotrabajo.co/openapi.json");
  for (const relation of ["api-catalog", "service-desc", "service-doc", "describedby"]) assert.match(DISCOVERY_LINKS, new RegExp(`rel="${relation}"`));
});

test("skill index digests exactly match served artifacts", () => {
  assert.equal(AGENT_SKILLS_INDEX.$schema, "https://schemas.agentskills.io/discovery/0.2.0/schema.json");
  for (const skill of AGENT_SKILLS_INDEX.skills) {
    const artifact = AGENT_SKILL_ARTIFACTS[new URL(skill.url).pathname];
    assert.ok(artifact, skill.name);
    assert.equal(skill.digest, `sha256:${createHash("sha256").update(artifact).digest("hex")}`);
    assert.match(artifact, /^---\nname: [a-z0-9-]+\ndescription:/);
    assert.match(artifact, /Never apply|Nunca apliques/i);
  }
});

test("experimental discovery documents reference only real read-only resources", () => {
  assert.equal(MCP_SERVER_CARD.transport.endpoint, "https://buscotrabajo.co/mcp");
  assert.equal(MCP_SERVER_CARD.capabilities.tools, true);
  assert.equal(A2A_AGENT_CARD.supportedInterfaces[0]?.url, "https://buscotrabajo.co/a2a");
  assert.equal(A2A_AGENT_CARD.capabilities.streaming, false);
  assert.equal(AI_CATALOG.specVersion, "1.0");
  assert.ok(AI_CATALOG.entries.length >= 3);
  for (const entry of AI_CATALOG.entries) {
    assert.match(entry.identifier, /^urn:air:buscotrabajo\.co:/);
    assert.ok(("url" in entry) !== ("data" in entry));
    assert.ok(entry.representativeQueries.length >= 2 && entry.representativeQueries.length <= 5);
  }
});

test("public job query validation is bounded", () => {
  assert.equal(parsePublicJobsQuery(new URLSearchParams("limit=50&offset=5000&country=CO")).ok, true);
  for (const query of ["limit=51", "offset=5001", "country=US", "search=x".replace("x", "x".repeat(121)), "unknown=1"]) {
    const result = parsePublicJobsQuery(new URLSearchParams(query));
    assert.equal(result.ok, false, query);
  }
});

test("WebMCP feature detection registers only bounded read-only tools", () => {
  const tools: Array<Record<string, unknown>> = [];
  const modelContext = { registerTool(tool: any) { tools.push(tool); } };
  const controller = registerBuscoTrabajoWebMcp(modelContext);
  assert.ok(controller instanceof AbortController);
  assert.deepEqual(tools.map((tool) => tool.name), ["search_jobs", "get_job", "list_supported_countries"]);
  for (const tool of tools) {
    assert.equal((tool.annotations as { readOnlyHint: boolean }).readOnlyHint, true);
    assert.equal(typeof tool.execute, "function");
  }
  assert.equal(registerBuscoTrabajoWebMcp(undefined), null);
  controller.abort();
});
