import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, schema, type Database, type DbHandle } from "@job-radar/db";
import type { CanonicalJob } from "@job-radar/domain";
import type {
  DiscoveryInput,
  ExtractedJob,
  RawSourceDocument,
  SourceAdapter,
  SourceConfig,
  SourceHealth,
  SourceMetadata,
  SourceReference,
  VerificationResult
} from "@job-radar/sources";
import { replayDedupe, runIngest, runVerify } from "./index.js";

const ADMIN_URL =
  process.env.DATABASE_URL ?? "postgres://job_radar:job_radar@localhost:5432/job_radar";
const TEST_DB = "job_radar_test";
const TEST_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);

async function isDbUp(): Promise<boolean> {
  const client = postgres(ADMIN_URL, { max: 1, connect_timeout: 3 });
  try {
    await client`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.end({ timeout: 1 });
  }
}

const dbUp = await isDbUp();

function jobPayload(overrides: Partial<CanonicalJob> = {}): CanonicalJob {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    sourceId: "stub:a",
    sourceJobId: "1001",
    sourceUrl: "https://a.example.test/jobs/1001",
    canonicalUrl: "https://a.example.test/careers/1001",
    applyUrl: null,
    titleRaw: "Data Analyst",
    titleNormalized: "data analyst",
    titleFamily: null,
    seniority: "unknown",
    companyNameRaw: "Acme Example Inc.",
    companyId: null,
    companyNameNormalized: "acme example",
    companyDomain: null,
    descriptionText:
      "We are looking for a data analyst to build SQL models, own our reporting " +
      "pipelines, partner with stakeholders across finance and operations, and ship " +
      "dashboards that people actually use every single week. You will work with " +
      "modern tooling, document analyses carefully, and help the team decide " +
      "with trustworthy numbers and clear communication throughout the company.",
    responsibilities: [],
    requiredSkills: [],
    preferredSkills: [],
    requiredExperienceYears: null,
    educationRequirements: [],
    languageRequirements: [],
    locations: [{ raw: "Bogota, Colombia", city: null, region: null, countryCode: null }],
    workMode: "unknown",
    remoteRegion: null,
    employmentTypes: [],
    compensation: { min: null, max: null, currency: null, period: null, source: "unknown" },
    visaSponsorship: "unknown",
    publishedAt: null,
    expiresAt: null,
    firstSeenAt: now,
    lastSeenAt: now,
    lastVerifiedAt: null,
    status: "active",
    extractionMethod: "api",
    extractionConfidence: 0.95,
    contentHash: "raw",
    evidence: [
      { field: "titleRaw", quote: "Data Analyst", sourceUrl: "https://a.example.test/careers/1001" }
    ],
    ...overrides
  };
}

/** In-memory adapter whose raw documents round-trip through extract(). */
class StubAdapter implements SourceAdapter {
  readonly metadata: SourceMetadata;
  jobs: CanonicalJob[];
  verifyResult: VerificationResult["status"] | "throw" = "active";

  constructor(sourceId: string, jobs: CanonicalJob[]) {
    this.jobs = jobs;
    this.metadata = {
      id: sourceId,
      adapterName: "greenhouse",
      kind: "ats",
      tier: "A",
      baseUrl: "https://stub.example.test",
      companySlug: sourceId,
      rateLimitPerMinute: 1000,
      concurrency: 1
    };
  }

  async *discover(input: DiscoveryInput = {}): AsyncIterable<SourceReference> {
    const limit = input.limit ?? Number.POSITIVE_INFINITY;
    for (const job of this.jobs.slice(0, limit)) {
      yield {
        sourceId: this.metadata.id,
        externalId: job.sourceJobId ?? job.id,
        url: job.sourceUrl,
        discoveredAt: new Date().toISOString()
      };
    }
  }

  async fetch(reference: SourceReference): Promise<RawSourceDocument> {
    const job = this.jobs.find((entry) => entry.sourceJobId === reference.externalId);
    return {
      sourceId: this.metadata.id,
      externalId: reference.externalId,
      url: reference.url,
      fetchedAt: new Date().toISOString(),
      contentType: "application/json",
      httpStatus: job ? 200 : 404,
      body: job ? JSON.stringify(job) : "",
      contentHash: reference.externalId
    };
  }

  async extract(document: RawSourceDocument): Promise<ExtractedJob[]> {
    if (document.httpStatus !== 200) {
      return [];
    }
    const job = JSON.parse(document.body) as CanonicalJob;
    return [
      {
        job,
        provenance: {
          sourceId: this.metadata.id,
          externalId: document.externalId,
          url: document.url,
          fetchedAt: document.fetchedAt,
          contentHash: document.contentHash,
          extractionMethod: "api"
        }
      }
    ];
  }

  async verify(): Promise<VerificationResult> {
    if (this.verifyResult === "throw") {
      throw new Error("simulated timeout");
    }
    return {
      status: this.verifyResult,
      checkedAt: new Date().toISOString(),
      httpStatus: this.verifyResult === "closed" ? 404 : 200,
      detail: null
    };
  }

  async healthcheck(): Promise<SourceHealth> {
    return {
      sourceId: this.metadata.id,
      healthy: true,
      checkedAt: new Date().toISOString(),
      latencyMs: 1,
      detail: null
    };
  }
}

function configFor(id: string): SourceConfig {
  return {
    id,
    adapter: "greenhouse",
    enabled: true,
    board_token: id,
    rate_limit_per_minute: 1000,
    concurrency: 1
  };
}

describe.skipIf(!dbUp)("ingestion pipeline (Postgres integration)", () => {
  let handle: DbHandle;
  let db: Database;

  beforeAll(async () => {
    const admin = postgres(ADMIN_URL, { max: 1 });
    try {
      await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
    } catch {
      // already exists
    } finally {
      await admin.end({ timeout: 1 });
    }
    const migrationsFolder = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../db/migrations"
    );
    const migrationClient = postgres(TEST_URL, { max: 1 });
    await migrate(drizzle(migrationClient), { migrationsFolder });
    await migrationClient.end({ timeout: 1 });
    handle = createDb(TEST_URL, 3);
    db = handle.db;
  });

  beforeEach(async () => {
    await db.delete(schema.jobVerifications);
    await db.delete(schema.sourceOccurrences);
    await db.delete(schema.jobVersions);
    await db.delete(schema.rawDocuments);
    await db.delete(schema.sourceRuns);
    await db.delete(schema.jobs);
    await db.delete(schema.companies);
    await db.delete(schema.sourceRegistry);
  });

  afterAll(async () => {
    await handle?.close();
  });

  it("is idempotent: re-running the same ingest creates nothing new", async () => {
    const jobs = [jobPayload(), jobPayload({ id: randomUUID(), sourceJobId: "1002", titleRaw: "BI Engineer", titleNormalized: "bi engineer", canonicalUrl: "https://a.example.test/careers/1002", sourceUrl: "https://a.example.test/jobs/1002", descriptionText: jobPayload().descriptionText + " Also owns BI tooling and vendor relationships for the analytics organization." })];
    const adapter = new StubAdapter("stub:a", jobs);
    const options = {
      configs: [configFor("stub:a")],
      adapterFactory: () => adapter
    };

    const first = await runIngest(db, options);
    expect(first.totals.new).toBe(2);

    const second = await runIngest(db, options);
    expect(second.totals.new ?? 0).toBe(0);
    expect(second.totals.unchanged).toBe(2);

    const allJobs = await db.query.jobs.findMany();
    const versions = await db.query.jobVersions.findMany();
    expect(allJobs).toHaveLength(2);
    expect(versions).toHaveLength(2);
    expect(allJobs[0]!.evidence.length).toBe(1);
  });

  it("maps the same vacancy from two sources to one job, filling gaps only", async () => {
    const base = jobPayload();
    const fromB = jobPayload({
      id: randomUUID(),
      sourceId: "stub:b",
      sourceJobId: "b-77",
      sourceUrl: "https://b.example.test/jobs/b-77",
      canonicalUrl: "https://b.example.test/careers/b-77",
      workMode: "remote",
      titleRaw: "Data  Analyst",
      evidence: [
        { field: "workMode", quote: "remote", sourceUrl: "https://b.example.test/careers/b-77" }
      ]
    });

    await runIngest(db, {
      configs: [configFor("stub:a")],
      adapterFactory: () => new StubAdapter("stub:a", [base])
    });
    await runIngest(db, {
      configs: [configFor("stub:b")],
      adapterFactory: () => new StubAdapter("stub:b", [fromB])
    });

    const allJobs = await db.query.jobs.findMany();
    expect(allJobs).toHaveLength(1);
    const job = allJobs[0]!;
    expect(job.titleRaw).toBe("Data Analyst");
    expect(job.workMode).toBe("remote");
    expect(job.contentSourceId).toBe("stub:a");
    expect(job.evidence).toHaveLength(2);

    const occurrences = await db.query.sourceOccurrences.findMany();
    expect(occurrences).toHaveLength(2);
  });

  it("creates a new version when the content source changes the description", async () => {
    const original = jobPayload();
    const adapter = new StubAdapter("stub:a", [original]);
    const options = { configs: [configFor("stub:a")], adapterFactory: () => adapter };
    await runIngest(db, options);

    adapter.jobs = [
      {
        ...original,
        id: randomUUID(),
        descriptionText: original.descriptionText + " Update: now requires Snowflake and dbt."
      }
    ];
    const report = await runIngest(db, options);
    expect(report.totals.updated).toBe(1);

    const job = (await db.query.jobs.findMany())[0]!;
    expect(job.currentVersion).toBe(2);
    expect(job.descriptionText).toContain("Snowflake");
    const versions = await db.query.jobVersions.findMany({
      where: eq(schema.jobVersions.jobId, job.id),
      orderBy: [desc(schema.jobVersions.version)]
    });
    expect(versions).toHaveLength(2);
    expect((versions[1]!.payload as CanonicalJob).descriptionText).not.toContain("Snowflake");
  });

  it("keeps similar jobs from different companies separate", async () => {
    const acme = jobPayload();
    const globex = jobPayload({
      id: randomUUID(),
      sourceJobId: "2001",
      sourceUrl: "https://a.example.test/jobs/2001",
      canonicalUrl: "https://a.example.test/careers/2001",
      companyNameRaw: "Globex Corp",
      companyNameNormalized: "globex"
    });
    await runIngest(db, {
      configs: [configFor("stub:a")],
      adapterFactory: () => new StubAdapter("stub:a", [acme, globex])
    });
    expect(await db.query.jobs.findMany()).toHaveLength(2);
  });

  it("closes a job only after two consecutive negative verifications", async () => {
    const adapter = new StubAdapter("stub:a", [jobPayload()]);
    const options = { configs: [configFor("stub:a")], adapterFactory: () => adapter };
    await runIngest(db, options);

    adapter.verifyResult = "closed";
    const verifyOptions = {
      configs: [configFor("stub:a")],
      dueHours: 0,
      adapterFactory: () => adapter
    };

    const first = await runVerify(db, verifyOptions);
    expect(first.possiblyActive).toBe(1);
    let job = (await db.query.jobs.findMany())[0]!;
    expect(job.status).toBe("possibly_active");

    const second = await runVerify(db, verifyOptions);
    expect(second.closed).toBe(1);
    job = (await db.query.jobs.findMany())[0]!;
    expect(job.status).toBe("closed");
    expect(job.titleRaw).toBe("Data Analyst");
  });

  it("never closes on technical errors (simulated timeout)", async () => {
    const adapter = new StubAdapter("stub:a", [jobPayload()]);
    const options = { configs: [configFor("stub:a")], adapterFactory: () => adapter };
    await runIngest(db, options);

    adapter.verifyResult = "throw";
    const report = await runVerify(db, {
      configs: [configFor("stub:a")],
      dueHours: 0,
      adapterFactory: () => adapter
    });
    expect(report.unknown).toBe(1);
    const job = (await db.query.jobs.findMany())[0]!;
    expect(job.status).toBe("possibly_active");
  });

  it("replayDedupe over the latest run creates zero new jobs", async () => {
    const adapter = new StubAdapter("stub:a", [jobPayload()]);
    const configs = [configFor("stub:a")];
    await runIngest(db, { configs, adapterFactory: () => adapter });

    const replay = await replayDedupe(db, { configs, adapterFactory: () => adapter });
    expect(replay).not.toBeNull();
    expect(replay!.stats.new ?? 0).toBe(0);
    expect(await db.query.jobs.findMany()).toHaveLength(1);
  });

  it("opens the circuit after three consecutive failures", async () => {
    const failing = new StubAdapter("stub:a", [jobPayload()]);
    failing.discover = async function* () {
      yield await Promise.reject(new Error("boom"));
    };
    const options = { configs: [configFor("stub:a")], adapterFactory: () => failing };
    await runIngest(db, options);
    await runIngest(db, options);
    await runIngest(db, options);

    const registry = (await db.query.sourceRegistry.findMany())[0]!;
    expect(registry.failureStreak).toBe(3);
    expect(registry.healthStatus).toBe("failing");
    expect(registry.circuitOpenUntil).not.toBeNull();

    const fourth = await runIngest(db, options);
    expect(fourth.runs[0]!.status).toBe("skipped_circuit_open");
  });
});
