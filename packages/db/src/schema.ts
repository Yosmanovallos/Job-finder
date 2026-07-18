import {
  pgTable,
  uuid,
  timestamp,
  text,
  boolean,
  integer,
  real,
  bigint,
  jsonb,
  uniqueIndex,
  index
} from "drizzle-orm/pg-core";

/**
 * Phase 0 sanity table, kept so old migrations remain valid.
 */
export const bootstrapCheck = pgTable("bootstrap_check", {
  id: uuid("id").primaryKey().defaultRandom(),
  note: text("note").notNull().default("job-radar-local bootstrap"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

/**
 * Runtime state per configured source (plan §7.3). Identity fields are synced
 * from config/sources.local.yaml on every run — the YAML is authoritative for
 * identity, the DB only owns runtime health. Rows are never deleted: a source
 * missing from config is flipped to enabled=false.
 */
export const sourceRegistry = pgTable("source_registry", {
  /** Source instance id, e.g. "greenhouse:gitlab". */
  id: text("id").primaryKey(),
  adapterName: text("adapter_name").notNull(),
  kind: text("kind").notNull(),
  tier: text("tier").notNull(),
  baseUrl: text("base_url").notNull(),
  companySlug: text("company_slug"),
  enabled: boolean("enabled").notNull().default(true),
  rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(30),
  concurrency: integer("concurrency").notNull().default(1),
  termsReviewedAt: timestamp("terms_reviewed_at", { withTimezone: true }),
  robotsReviewedAt: timestamp("robots_reviewed_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  healthStatus: text("health_status").notNull().default("healthy"),
  failureStreak: integer("failure_streak").notNull().default(0),
  circuitOpenUntil: timestamp("circuit_open_until", { withTimezone: true }),
  notes: text("notes")
});

export const sourceRuns = pgTable(
  "source_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sourceRegistry.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull().default("running"),
    /** Whether discovery was capped (--limit); partial runs never close jobs. */
    partial: boolean("partial").notNull().default(false),
    /** Version of the normalization/dedupe algorithm used for this run. */
    dedupeVersion: text("dedupe_version").notNull(),
    stats: jsonb("stats").notNull().$type<Record<string, number>>().default({}),
    error: text("error")
  },
  (table) => [index("source_runs_source_idx").on(table.sourceId, table.startedAt)]
);

/** Raw fetched payloads (plan §10.1). Metadata kept forever; body purgeable. */
export const rawDocuments = pgTable(
  "raw_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => sourceRuns.id),
    sourceId: text("source_id").notNull(),
    externalId: text("external_id"),
    requestedUrl: text("requested_url").notNull(),
    finalUrl: text("final_url"),
    httpStatus: integer("http_status").notNull(),
    contentType: text("content_type"),
    etag: text("etag"),
    lastModified: text("last_modified"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    contentHash: text("content_hash").notNull(),
    body: text("body"),
    parser: text("parser").notNull(),
    adapterVersion: text("adapter_version").notNull()
  },
  (table) => [index("raw_documents_run_idx").on(table.runId)]
);

/**
 * Companies are a normalization aid, not an identity authority: dedupe always
 * compares normalized strings, never company ids.
 */
export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nameNormalized: text("name_normalized").notNull(),
    nameRaw: text("name_raw").notNull(),
    domain: text("domain"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("companies_name_normalized_idx").on(table.nameNormalized)]
);

/**
 * Canonical jobs: current state. Arrays/objects live in jsonb; full snapshots
 * go to job_versions. Rows are never deleted — closing is a status change.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id").references(() => companies.id),

    titleRaw: text("title_raw").notNull(),
    titleNormalized: text("title_normalized").notNull(),
    titleFamily: text("title_family"),
    seniority: text("seniority").notNull(),

    companyNameRaw: text("company_name_raw").notNull(),
    companyNameNormalized: text("company_name_normalized").notNull(),
    companyDomain: text("company_domain"),

    canonicalUrl: text("canonical_url").notNull(),
    canonicalUrlNormalized: text("canonical_url_normalized").notNull(),
    applyUrl: text("apply_url"),
    applyUrlNormalized: text("apply_url_normalized"),

    descriptionText: text("description_text").notNull(),
    responsibilities: jsonb("responsibilities").notNull().$type<string[]>().default([]),
    requiredSkills: jsonb("required_skills").notNull().$type<string[]>().default([]),
    preferredSkills: jsonb("preferred_skills").notNull().$type<string[]>().default([]),
    requiredExperienceYears: real("required_experience_years"),
    educationRequirements: jsonb("education_requirements").notNull().$type<string[]>().default([]),
    languageRequirements: jsonb("language_requirements").notNull().$type<string[]>().default([]),
    locations: jsonb("locations")
      .notNull()
      .$type<
        { raw: string; city: string | null; region: string | null; countryCode: string | null }[]
      >()
      .default([]),
    workMode: text("work_mode").notNull(),
    remoteRegion: text("remote_region"),
    employmentTypes: jsonb("employment_types").notNull().$type<string[]>().default([]),
    compensation: jsonb("compensation").notNull().$type<{
      min: number | null;
      max: number | null;
      currency: string | null;
      period: string | null;
      source: string;
    }>(),
    visaSponsorship: text("visa_sponsorship").notNull(),
    evidence: jsonb("evidence")
      .notNull()
      .$type<{ field: string; quote: string; sourceUrl: string }[]>()
      .default([]),

    publishedAt: timestamp("published_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    status: text("status").notNull().default("active"),

    /** Dedupe keys, recomputed whenever a new version is applied. */
    dedupeKey: text("dedupe_key").notNull(),
    /** 64-bit simhash of the description, stored reinterpreted as signed. */
    simhash: bigint("simhash", { mode: "bigint" }).notNull(),
    /** Hash of the canonical payload minus volatile fields. */
    canonicalContentHash: text("canonical_content_hash").notNull(),
    /** Which source's content currently backs this job's fields. */
    contentSourceId: text("content_source_id").notNull(),
    currentVersion: integer("current_version").notNull().default(1),
    extractionMethod: text("extraction_method").notNull(),
    extractionConfidence: real("extraction_confidence").notNull()
  },
  (table) => [
    index("jobs_dedupe_key_idx").on(table.dedupeKey),
    index("jobs_canonical_url_idx").on(table.canonicalUrlNormalized),
    index("jobs_company_title_idx").on(table.companyNameNormalized, table.titleNormalized),
    index("jobs_status_idx").on(table.status)
  ]
);

/** Immutable history — never updated, never deleted (plan §22.1). */
export const jobVersions = pgTable(
  "job_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    version: integer("version").notNull(),
    canonicalContentHash: text("canonical_content_hash").notNull(),
    contentSourceId: text("content_source_id").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("job_versions_job_version_idx").on(table.jobId, table.version)]
);

/** One row per (source, external id); each occurrence points to ONE job. */
export const sourceOccurrences = pgTable(
  "source_occurrences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    sourceId: text("source_id").notNull(),
    sourceJobId: text("source_job_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    /** Canonical content hash last seen from this source. */
    lastContentHash: text("last_content_hash").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex("source_occurrences_source_job_idx").on(table.sourceId, table.sourceJobId),
    index("source_occurrences_job_idx").on(table.jobId)
  ]
);

export const jobVerifications = pgTable(
  "job_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    method: text("method").notNull(),
    httpStatus: integer("http_status"),
    result: text("result").notNull(),
    detail: text("detail")
  },
  (table) => [index("job_verifications_job_idx").on(table.jobId, table.checkedAt)]
);

/**
 * Notion projection state (plan §14.5, §22). One row per job pushed to Notion.
 * PostgreSQL stays the source of truth: this table only tracks the projection
 * (page id + last synced hash) and the human-owned fields pulled back.
 */
export const notionSyncState = pgTable(
  "notion_sync_state",
  {
    jobId: uuid("job_id")
      .primaryKey()
      .references(() => jobs.id),
    notionPageId: text("notion_page_id").notNull(),
    dataSourceId: text("data_source_id").notNull(),
    /** Hash of the last system-owned payload pushed; equal hash => no-op. */
    lastSyncedHash: text("last_synced_hash").notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("synced"),
    lastError: text("last_error"),
    /** Human-owned fields last pulled from Notion (Decisión, Notas, ...). */
    humanFields: jsonb("human_fields"),
    humanPulledAt: timestamp("human_pulled_at", { withTimezone: true })
  },
  (table) => [uniqueIndex("notion_sync_state_page_idx").on(table.notionPageId)]
);

/**
 * Assisted-application records (plan Fase 8, §19.7). There is NO auto-apply:
 * `approvedByHumanAt` can only be set by an explicit CLI action, and the final
 * submission is always performed by the human outside the system.
 */
export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    /** draft | blocked | awaiting_human_approval | approved | exported | submitted_by_human | withdrawn */
    status: text("status").notNull().default("draft"),
    factualityOk: boolean("factuality_ok").notNull().default(false),
    approvedByHumanAt: timestamp("approved_by_human_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes")
  },
  (table) => [index("applications_job_idx").on(table.jobId)]
);

/** Immutable generated artifacts (cv_patch, cover_letter, answers, export). */
export const applicationArtifacts = pgTable(
  "application_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id),
    kind: text("kind").notNull(),
    content: jsonb("content").notNull(),
    factualityReport: jsonb("factuality_report"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("application_artifacts_app_idx").on(table.applicationId)]
);
