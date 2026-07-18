import { desc, eq } from "drizzle-orm";
import type { Database } from "@job-radar/db";
import { schema } from "@job-radar/db";
import { buildAdapter, type SourceAdapter, type SourceConfig } from "@job-radar/sources";
import { DEDUPE_VERSION } from "@job-radar/dedupe";
import { persistExtractedJob, type PersistOutcome } from "./persist-job.js";

const ADAPTER_VERSION = "0.1.0";
/** Failures before the circuit opens; opens for OPEN_HOURS. */
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_OPEN_HOURS = 6;

export interface IngestOptions {
  configs: SourceConfig[];
  /** Adapter name or full source id; undefined = all enabled sources. */
  selector?: string;
  limit?: number;
  dryRun?: boolean;
  /** Injectable for tests. */
  adapterFactory?: (config: SourceConfig) => SourceAdapter;
}

export interface SourceRunReport {
  sourceId: string;
  runId: string | null;
  status: "success" | "failed" | "skipped_circuit_open";
  stats: Record<string, number>;
  error?: string;
}

export interface IngestReport {
  dryRun: boolean;
  runs: SourceRunReport[];
  totals: Record<string, number>;
}

export function selectConfigs(configs: SourceConfig[], selector?: string): SourceConfig[] {
  return configs.filter(
    (config) =>
      config.enabled &&
      (selector === undefined || config.adapter === selector || config.id === selector)
  );
}

/** Syncs YAML identity into source_registry; never deletes rows. */
export async function syncSourceRegistry(db: Database, configs: SourceConfig[]): Promise<void> {
  for (const config of configs) {
    const adapter = buildAdapter(config);
    const { metadata } = adapter;
    await db
      .insert(schema.sourceRegistry)
      .values({
        id: config.id,
        adapterName: metadata.adapterName,
        kind: metadata.kind,
        tier: metadata.tier,
        baseUrl: metadata.baseUrl,
        companySlug: metadata.companySlug,
        enabled: config.enabled,
        rateLimitPerMinute: config.rate_limit_per_minute,
        concurrency: config.concurrency,
        notes: config.notes ?? null
      })
      .onConflictDoUpdate({
        target: schema.sourceRegistry.id,
        set: {
          adapterName: metadata.adapterName,
          kind: metadata.kind,
          tier: metadata.tier,
          baseUrl: metadata.baseUrl,
          companySlug: metadata.companySlug,
          enabled: config.enabled,
          rateLimitPerMinute: config.rate_limit_per_minute,
          concurrency: config.concurrency,
          notes: config.notes ?? null
        }
      });
  }
}

async function markRunOutcome(
  db: Database,
  sourceId: string,
  success: boolean,
  now: Date
): Promise<void> {
  const row = await db.query.sourceRegistry.findFirst({
    where: eq(schema.sourceRegistry.id, sourceId)
  });
  if (!row) {
    return;
  }
  if (success) {
    await db
      .update(schema.sourceRegistry)
      .set({
        lastSuccessAt: now,
        failureStreak: 0,
        healthStatus: "healthy",
        circuitOpenUntil: null
      })
      .where(eq(schema.sourceRegistry.id, sourceId));
    return;
  }
  const streak = row.failureStreak + 1;
  await db
    .update(schema.sourceRegistry)
    .set({
      lastFailureAt: now,
      failureStreak: streak,
      healthStatus: streak >= CIRCUIT_THRESHOLD ? "failing" : "degraded",
      circuitOpenUntil:
        streak >= CIRCUIT_THRESHOLD
          ? new Date(now.getTime() + CIRCUIT_OPEN_HOURS * 3_600_000)
          : row.circuitOpenUntil
    })
    .where(eq(schema.sourceRegistry.id, sourceId));
}

async function ingestOneSource(
  db: Database,
  config: SourceConfig,
  adapter: SourceAdapter,
  options: IngestOptions,
  now: Date
): Promise<SourceRunReport> {
  const registry = await db.query.sourceRegistry.findFirst({
    where: eq(schema.sourceRegistry.id, config.id)
  });
  if (registry?.circuitOpenUntil && registry.circuitOpenUntil > now) {
    return {
      sourceId: config.id,
      runId: null,
      status: "skipped_circuit_open",
      stats: {},
      error: `Circuit open until ${registry.circuitOpenUntil.toISOString()}`
    };
  }

  const stats: Record<string, number> = {
    discovered: 0,
    fetched: 0,
    new: 0,
    updated: 0,
    unchanged: 0,
    errors: 0
  };

  const [run] = await db
    .insert(schema.sourceRuns)
    .values({
      sourceId: config.id,
      partial: options.limit !== undefined,
      dedupeVersion: DEDUPE_VERSION,
      status: "running"
    })
    .returning({ id: schema.sourceRuns.id });
  const runId = run!.id;

  try {
    for await (const reference of adapter.discover(
      options.limit === undefined ? {} : { limit: options.limit }
    )) {
      stats.discovered! += 1;
      const document = await adapter.fetch(reference);
      stats.fetched! += 1;
      await db.insert(schema.rawDocuments).values({
        runId,
        sourceId: config.id,
        externalId: document.externalId,
        requestedUrl: reference.url,
        finalUrl: document.url,
        httpStatus: document.httpStatus,
        contentType: document.contentType,
        fetchedAt: new Date(document.fetchedAt),
        contentHash: document.contentHash,
        body: document.body,
        parser: adapter.metadata.adapterName,
        adapterVersion: ADAPTER_VERSION
      });
      const extractions = await adapter.extract(document);
      for (const extracted of extractions) {
        const outcome: PersistOutcome = await persistExtractedJob(db, extracted, now);
        stats[outcome] = (stats[outcome] ?? 0) + 1;
      }
    }
    await db
      .update(schema.sourceRuns)
      .set({ finishedAt: new Date(), status: "success", stats })
      .where(eq(schema.sourceRuns.id, runId));
    await markRunOutcome(db, config.id, true, now);
    return { sourceId: config.id, runId, status: "success", stats };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stats.errors! += 1;
    await db
      .update(schema.sourceRuns)
      .set({ finishedAt: new Date(), status: "failed", stats, error: message })
      .where(eq(schema.sourceRuns.id, runId));
    await markRunOutcome(db, config.id, false, now);
    return { sourceId: config.id, runId, status: "failed", stats, error: message };
  }
}

export async function runIngest(
  db: Database | null,
  options: IngestOptions
): Promise<IngestReport> {
  const now = new Date();
  const selected = selectConfigs(options.configs, options.selector);
  const factory = options.adapterFactory ?? buildAdapter;
  const runs: SourceRunReport[] = [];

  if (options.dryRun) {
    // Dry run: no writes at all — walk the pipeline and count.
    for (const config of selected) {
      const adapter = factory(config);
      const stats: Record<string, number> = { discovered: 0, extracted: 0 };
      try {
        for await (const reference of adapter.discover(
          options.limit === undefined ? {} : { limit: options.limit }
        )) {
          stats.discovered! += 1;
          const document = await adapter.fetch(reference);
          stats.extracted! += (await adapter.extract(document)).length;
        }
        runs.push({ sourceId: config.id, runId: null, status: "success", stats });
      } catch (error) {
        runs.push({
          sourceId: config.id,
          runId: null,
          status: "failed",
          stats,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  } else {
    if (db === null) {
      throw new Error("A database handle is required unless dryRun is set");
    }
    await syncSourceRegistry(db, options.configs);
    for (const config of selected) {
      runs.push(await ingestOneSource(db, config, factory(config), options, now));
    }
  }

  const totals: Record<string, number> = {};
  for (const run of runs) {
    for (const [key, value] of Object.entries(run.stats)) {
      totals[key] = (totals[key] ?? 0) + value;
    }
  }
  return { dryRun: options.dryRun ?? false, runs, totals };
}

/**
 * Re-applies extraction + dedupe over the raw documents of a stored run.
 * Deterministic and idempotent: a replay right after ingest yields 0 new jobs.
 */
export async function replayDedupe(
  db: Database,
  options: {
    configs: SourceConfig[];
    runId?: string;
    adapterFactory?: (config: SourceConfig) => SourceAdapter;
  }
): Promise<{ runId: string; stats: Record<string, number> } | null> {
  const factory = options.adapterFactory ?? buildAdapter;
  const run = options.runId
    ? await db.query.sourceRuns.findFirst({ where: eq(schema.sourceRuns.id, options.runId) })
    : await db.query.sourceRuns.findFirst({ orderBy: [desc(schema.sourceRuns.startedAt)] });
  if (!run) {
    return null;
  }
  const documents = await db.query.rawDocuments.findMany({
    where: eq(schema.rawDocuments.runId, run.id)
  });
  const stats: Record<string, number> = { documents: documents.length, new: 0, updated: 0, unchanged: 0, skipped: 0 };
  const adapters = new Map<string, SourceAdapter>();
  for (const config of options.configs) {
    adapters.set(config.id, factory(config));
  }
  for (const document of documents) {
    const adapter = adapters.get(document.sourceId);
    if (!adapter || document.httpStatus !== 200 || document.body === null) {
      stats.skipped! += 1;
      continue;
    }
    const extractions = await adapter.extract({
      sourceId: document.sourceId,
      externalId: document.externalId ?? "",
      url: document.finalUrl ?? document.requestedUrl,
      fetchedAt: document.fetchedAt.toISOString(),
      contentType: document.contentType ?? "application/json",
      httpStatus: document.httpStatus,
      body: document.body,
      contentHash: document.contentHash
    });
    for (const extracted of extractions) {
      const outcome = await persistExtractedJob(db, extracted);
      stats[outcome] = (stats[outcome] ?? 0) + 1;
    }
  }
  return { runId: run.id, stats };
}
