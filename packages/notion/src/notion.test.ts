import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { CanonicalJob } from "@job-radar/domain";
import type { MatchResult } from "@job-radar/matching";
import type { NotionApi, NotionPage } from "./api.js";
import { checkSchema, HUMAN_PROPERTIES, REQUIRED_PROPERTIES } from "./schema-spec.js";
import { buildNotionRow } from "./mapping.js";
import { executeSync, planSync } from "./sync.js";
import { extractHumanFields } from "./pull.js";
import { reconcile } from "./reconcile.js";
import { createInMemoryStateStore } from "./state-store.js";
import type { DlqEntry } from "./dlq.js";

function job(overrides: Partial<CanonicalJob> = {}): CanonicalJob {
  const now = new Date("2026-07-18T00:00:00.000Z").toISOString();
  const id = overrides.id ?? randomUUID();
  return {
    id,
    sourceId: "greenhouse:acme",
    sourceJobId: "1",
    sourceUrl: `https://boards.example.test/${id}`,
    canonicalUrl: `https://boards.example.test/${id}`,
    applyUrl: null,
    titleRaw: "Data Analyst",
    titleNormalized: "data analyst",
    titleFamily: null,
    seniority: "unknown",
    companyNameRaw: "Acme",
    companyId: null,
    companyNameNormalized: "acme",
    companyDomain: null,
    descriptionText: "SQL dashboards y métricas.",
    responsibilities: [],
    requiredSkills: ["SQL"],
    preferredSkills: [],
    requiredExperienceYears: null,
    educationRequirements: [],
    languageRequirements: ["es", "en"],
    locations: [{ raw: "Bogotá, Colombia", city: "Bogotá", region: null, countryCode: "CO" }],
    workMode: "remote",
    remoteRegion: null,
    employmentTypes: ["full_time"],
    compensation: { min: 40000, max: 60000, currency: "USD", period: "year", source: "explicit" },
    visaSponsorship: "unknown",
    publishedAt: now,
    expiresAt: null,
    firstSeenAt: now,
    lastSeenAt: now,
    lastVerifiedAt: null,
    status: "active",
    extractionMethod: "api",
    extractionConfidence: 0.9,
    contentHash: "h",
    evidence: [],
    ...overrides
  };
}

function match(jobId: string, overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    jobId,
    score: 82,
    confidence: 0.8,
    decision: "priority",
    matched_requirements: ["SQL"],
    missing_requirements: ["Tableau, avanzado"],
    uncertain_requirements: [],
    hard_blockers: [],
    evidence: [{ field: "requiredSkills", quote: "SQL", sourceUrl: "https://boards.example.test/x" }],
    why_apply: ["SQL match directo"],
    why_not_apply: [],
    recommended_action: "aplicar",
    score_breakdown: {},
    ...overrides
  };
}

function pageFor(jobId: string, pageId: string): NotionPage {
  return {
    id: pageId,
    archived: false,
    properties: {
      "Job ID": { type: "rich_text", rich_text: [{ plain_text: jobId }] }
    }
  };
}

interface FakeApi extends NotionApi {
  pages: Map<string, NotionPage>;
  calls: string[];
  failuresFor: (call: string) => unknown | null;
}

function fakeApi(options: { failures?: Map<string, unknown[]> } = {}): FakeApi {
  const pages = new Map<string, NotionPage>();
  const calls: string[] = [];
  const failures = options.failures ?? new Map<string, unknown[]>();
  const failuresFor = (call: string): unknown | null => {
    const queue = failures.get(call);
    return queue && queue.length > 0 ? queue.shift()! : null;
  };
  return {
    pages,
    calls,
    failuresFor,
    async retrieveDataSource(id) {
      return { id, properties: {} };
    },
    async queryAllPages() {
      calls.push("queryAllPages");
      return [...pages.values()].filter((page) => !page.archived);
    },
    async findPagesByJobId(_dataSourceId, jobId) {
      calls.push("findPagesByJobId");
      const failure = failuresFor("findPagesByJobId");
      if (failure) throw failure;
      return [...pages.values()].filter(
        (page) =>
          !page.archived &&
          extractJobId(page) === jobId
      );
    },
    async createPage(_dataSourceId, properties) {
      calls.push("createPage");
      const failure = failuresFor("createPage");
      if (failure) throw failure;
      const id = `page-${pages.size + 1}`;
      const jobId =
        ((properties["Job ID"] as { rich_text?: { text?: { content?: string } }[] })?.rich_text ?? [])
          .map((item) => item.text?.content ?? "")
          .join("") || "unknown";
      pages.set(id, pageFor(jobId, id));
      return { id };
    },
    async updatePage(pageId) {
      calls.push("updatePage");
      const failure = failuresFor("updatePage");
      if (failure) throw failure;
      if (!pages.has(pageId)) throw new Error(`page not found: ${pageId}`);
    },
    async retrievePage(pageId) {
      calls.push("retrievePage");
      const page = pages.get(pageId);
      if (!page) throw new Error(`page not found: ${pageId}`);
      return page;
    }
  };
}

function extractJobId(page: NotionPage): string {
  const raw = page.properties["Job ID"] as { rich_text?: { plain_text?: string }[] } | undefined;
  return (raw?.rich_text ?? []).map((item) => item.plain_text ?? "").join("");
}

function collectingDlq(): { entries: DlqEntry[]; append: (entry: DlqEntry) => void } {
  const entries: DlqEntry[] = [];
  return { entries, append: (entry) => entries.push(entry) };
}

const noSleep = async (): Promise<void> => {};

describe("checkSchema", () => {
  it("passes with a complete schema and warns about human fields separately", () => {
    const properties: Record<string, { type: string }> = {};
    for (const [name, type] of Object.entries(REQUIRED_PROPERTIES)) {
      properties[name] = { type };
    }
    const result = checkSchema({ id: "ds", properties });
    expect(result.ok).toBe(true);
    expect(result.missingHuman).toEqual(Object.keys(HUMAN_PROPERTIES));
  });

  it("reports missing properties and type mismatches", () => {
    const properties: Record<string, { type: string }> = {};
    for (const [name, type] of Object.entries(REQUIRED_PROPERTIES)) {
      properties[name] = { type };
    }
    delete properties["Match"];
    properties["URL"] = { type: "rich_text" };
    const result = checkSchema({ id: "ds", properties });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["Match"]);
    expect(result.typeMismatches).toEqual([
      { property: "URL", expected: "url", actual: "rich_text" }
    ]);
  });
});

describe("buildNotionRow", () => {
  it("never emits human-owned properties", () => {
    const j = job();
    const row = buildNotionRow(j, match(j.id));
    for (const name of Object.keys(HUMAN_PROPERTIES)) {
      expect(row.properties).not.toHaveProperty(name);
    }
  });

  it("sanitizes multi-select options (no commas) and truncates long text", () => {
    const j = job({ descriptionText: "x".repeat(5000) });
    const row = buildNotionRow(j, match(j.id));
    const missing = row.properties["Skills faltantes"] as { multi_select: { name: string }[] };
    expect(missing.multi_select[0]!.name).toBe("Tableau; avanzado");
    const description = row.children.find(
      (block) =>
        (block as { paragraph?: { rich_text: { text: { content: string } }[] } }).paragraph
          ?.rich_text[0]?.text.content.startsWith("x")
    ) as { paragraph: { rich_text: { text: { content: string } }[] } };
    expect(description.paragraph.rich_text[0]!.text.content.length).toBeLessThanOrEqual(1900);
  });

  it("produces a stable hash that ignores the volatile system timestamp", () => {
    const j = job();
    const a = buildNotionRow(j, match(j.id));
    const b = buildNotionRow(j, match(j.id));
    expect(a.syncHash).toBe(b.syncHash);
    const c = buildNotionRow(j, match(j.id, { score: 50 }));
    expect(c.syncHash).not.toBe(a.syncHash);
  });

  it("renders unknown salary as empty instead of inventing values", () => {
    const j = job({ compensation: { min: null, max: null, currency: null, period: null, source: "unknown" } });
    const row = buildNotionRow(j, match(j.id));
    expect((row.properties["Salario"] as { rich_text: unknown[] }).rich_text).toEqual([]);
  });
});

describe("planSync", () => {
  it("classifies create/update/noop by local state hash", async () => {
    const j1 = job();
    const j2 = job();
    const j3 = job();
    const row2 = buildNotionRow(j2, match(j2.id));
    const store = createInMemoryStateStore([
      {
        jobId: j2.id,
        notionPageId: "page-2",
        dataSourceId: "ds",
        lastSyncedHash: row2.syncHash,
        lastSyncedAt: new Date(),
        status: "synced",
        lastError: null,
        humanFields: null,
        humanPulledAt: null
      },
      {
        jobId: j3.id,
        notionPageId: "page-3",
        dataSourceId: "ds",
        lastSyncedHash: "stale-hash",
        lastSyncedAt: new Date(),
        status: "synced",
        lastError: null,
        humanFields: null,
        humanPulledAt: null
      }
    ]);
    const plan = await planSync(
      [
        { job: j1, match: match(j1.id) },
        { job: j2, match: match(j2.id) },
        { job: j3, match: match(j3.id) }
      ],
      store
    );
    expect(plan.counts).toEqual({ create: 1, update: 1, noop: 1 });
  });
});

describe("executeSync", () => {
  it("creates, updates and skips; saves page ids and hashes", async () => {
    const api = fakeApi();
    const store = createInMemoryStateStore();
    const dlq = collectingDlq();
    const j = job();
    const plan = await planSync([{ job: j, match: match(j.id) }], store);
    const result = await executeSync(plan, {
      api,
      store,
      dlq,
      dataSourceId: "ds",
      sleep: noSleep
    });
    expect(result).toEqual({ created: 1, updated: 0, noop: 0, adopted: 0, failed: 0 });
    const state = await store.get(j.id);
    expect(state?.notionPageId).toBe("page-1");
    expect(state?.status).toBe("synced");

    // Second run: identical content is a pure no-op, no writes hit the API.
    const before = api.calls.length;
    const plan2 = await planSync([{ job: j, match: match(j.id) }], store);
    const result2 = await executeSync(plan2, { api, store, dlq, dataSourceId: "ds", sleep: noSleep });
    expect(result2.noop).toBe(1);
    expect(api.calls.length).toBe(before);
  });

  it("adopts an existing Notion page instead of creating a duplicate", async () => {
    const api = fakeApi();
    const j = job();
    api.pages.set("page-9", pageFor(j.id, "page-9"));
    const store = createInMemoryStateStore();
    const dlq = collectingDlq();
    const plan = await planSync([{ job: j, match: match(j.id) }], store);
    const result = await executeSync(plan, { api, store, dlq, dataSourceId: "ds", sleep: noSleep });
    expect(result.adopted).toBe(1);
    expect(result.created).toBe(0);
    expect((await store.get(j.id))?.notionPageId).toBe("page-9");
  });

  it("honors Retry-After on 429 and then succeeds", async () => {
    const rateLimit = { status: 429, headers: { "retry-after": "2" } };
    const api = fakeApi({ failures: new Map([["createPage", [rateLimit]]]) });
    const store = createInMemoryStateStore();
    const dlq = collectingDlq();
    const sleeps: number[] = [];
    const j = job();
    const plan = await planSync([{ job: j, match: match(j.id) }], store);
    const result = await executeSync(plan, {
      api,
      store,
      dlq,
      dataSourceId: "ds",
      sleep: async (ms) => {
        sleeps.push(ms);
      }
    });
    expect(result.created).toBe(1);
    expect(sleeps).toContain(2000);
    expect(dlq.entries).toHaveLength(0);
  });

  it("sends exhausted operations to the DLQ and keeps going", async () => {
    const boom = new Error("permanent failure");
    const api = fakeApi({
      failures: new Map([["createPage", [boom, boom, boom, boom, boom]]])
    });
    const store = createInMemoryStateStore();
    const dlq = collectingDlq();
    const j1 = job();
    const j2 = job();
    const plan = await planSync(
      [
        { job: j1, match: match(j1.id) },
        { job: j2, match: match(j2.id) }
      ],
      store
    );
    const result = await executeSync(plan, {
      api,
      store,
      dlq,
      dataSourceId: "ds",
      maxRetries: 2,
      sleep: noSleep
    });
    expect(result.failed).toBe(1);
    expect(result.created).toBe(1);
    expect(dlq.entries).toHaveLength(1);
    expect(dlq.entries[0]!.jobId).toBe(j1.id);
    expect((await store.get(j1.id))).toBeNull();
  });
});

describe("extractHumanFields", () => {
  it("reads only human-owned fields, never calculated ones", () => {
    const page: NotionPage = {
      id: "p",
      archived: false,
      properties: {
        Decisión: { type: "select", select: { name: "Aplicar" } },
        Notas: { type: "rich_text", rich_text: [{ plain_text: "hablar con recruiter" }] },
        "Fecha aplicación": { type: "date", date: { start: "2026-07-19" } },
        Match: { type: "number", number: 95 }
      }
    };
    const fields = extractHumanFields(page);
    expect(fields).toEqual({
      Decisión: "Aplicar",
      Notas: "hablar con recruiter",
      "Fecha aplicación": "2026-07-19"
    });
    expect(fields).not.toHaveProperty("Match");
  });
});

describe("reconcile", () => {
  it("reports duplicates without deleting, adopts orphans, flags missing pages", async () => {
    const api = fakeApi();
    api.pages.set("dup-1", pageFor("job-a", "dup-1"));
    api.pages.set("dup-2", pageFor("job-a", "dup-2"));
    api.pages.set("orphan", pageFor("job-b", "orphan"));
    const store = createInMemoryStateStore([
      {
        jobId: "job-c",
        notionPageId: "gone",
        dataSourceId: "ds",
        lastSyncedHash: "h",
        lastSyncedAt: new Date(),
        status: "synced",
        lastError: null,
        humanFields: null,
        humanPulledAt: null
      }
    ]);
    const report = await reconcile(api, store, "ds", { dryRun: false });
    expect(report.duplicates).toEqual([{ jobId: "job-a", pageIds: ["dup-1", "dup-2"] }]);
    expect(report.adopted.map((entry) => entry.jobId).sort()).toEqual(["job-a", "job-b"]);
    expect(report.missingPages).toEqual(["job-c"]);
    // Non-destructive: every page still exists.
    expect(api.pages.size).toBe(3);
    expect((await store.get("job-b"))?.status).toBe("adopted");
    expect((await store.get("job-c"))?.status).toBe("error");
  });

  it("dry-run reports without touching state", async () => {
    const api = fakeApi();
    api.pages.set("orphan", pageFor("job-b", "orphan"));
    const store = createInMemoryStateStore();
    const report = await reconcile(api, store, "ds", { dryRun: true });
    expect(report.adopted).toHaveLength(1);
    expect(await store.get("job-b")).toBeNull();
  });
});
