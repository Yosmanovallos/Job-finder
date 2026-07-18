import { and, eq } from "drizzle-orm";
import type { Database } from "@job-radar/db";
import { schema } from "@job-radar/db";
import type { CanonicalJob } from "@job-radar/domain";
import type { ExtractedJob } from "@job-radar/sources";
import {
  canonicalContentHash,
  dedupeKey,
  evidenceUnion,
  fillGaps,
  fromSignedBigint,
  hammingDistance64,
  normalizeCompanyName,
  normalizedLocations,
  normalizeUrl,
  simhash64,
  SIMHASH_HAMMING_THRESHOLD,
  toSignedBigint
} from "@job-radar/dedupe";

export type PersistOutcome = "new" | "updated" | "unchanged";

type JobRow = typeof schema.jobs.$inferSelect;

interface Keys {
  canonicalUrlNormalized: string;
  applyUrlNormalized: string | null;
  key: string;
  contentHash: string;
  simhashSigned: bigint | null;
}

function computeKeys(job: CanonicalJob): Keys {
  const hash = simhash64(job.descriptionText);
  return {
    canonicalUrlNormalized: normalizeUrl(job.canonicalUrl),
    applyUrlNormalized: job.applyUrl === null ? null : normalizeUrl(job.applyUrl),
    key: dedupeKey(job),
    contentHash: canonicalContentHash(job),
    simhashSigned: hash === null ? null : toSignedBigint(hash)
  };
}

/**
 * Layered deterministic resolution (plan §11.1, layers 1-5). Returns the
 * existing job row this extraction belongs to, or null for a new job.
 */
async function resolveExistingJob(
  db: Database,
  extracted: ExtractedJob,
  keys: Keys
): Promise<JobRow | null> {
  const { job, provenance } = extracted;

  if (provenance.externalId !== null) {
    const occurrence = await db.query.sourceOccurrences.findFirst({
      where: and(
        eq(schema.sourceOccurrences.sourceId, provenance.sourceId),
        eq(schema.sourceOccurrences.sourceJobId, provenance.externalId)
      )
    });
    if (occurrence) {
      const row = await db.query.jobs.findFirst({ where: eq(schema.jobs.id, occurrence.jobId) });
      if (row) {
        return row;
      }
    }
  }

  const byCanonicalUrl = await db.query.jobs.findFirst({
    where: eq(schema.jobs.canonicalUrlNormalized, keys.canonicalUrlNormalized)
  });
  if (byCanonicalUrl) {
    return byCanonicalUrl;
  }

  if (keys.applyUrlNormalized !== null) {
    const byApplyUrl = await db.query.jobs.findFirst({
      where: eq(schema.jobs.applyUrlNormalized, keys.applyUrlNormalized)
    });
    if (byApplyUrl) {
      return byApplyUrl;
    }
  }

  const byKey = await db.query.jobs.findFirst({ where: eq(schema.jobs.dedupeKey, keys.key) });
  if (byKey) {
    return byKey;
  }

  // Layer 5: simhash near-dup, guarded by company + title + location equality
  // so multi-location postings of the same company never merge.
  if (keys.simhashSigned !== null) {
    const candidates = await db.query.jobs.findMany({
      where: and(
        eq(schema.jobs.companyNameNormalized, normalizeCompanyName(job.companyNameRaw)),
        eq(schema.jobs.titleNormalized, job.titleNormalized)
      )
    });
    const incomingLocations = normalizedLocations(job).join(";");
    for (const candidate of candidates) {
      const candidateLocations = candidate.locations
        .map((location) => location.raw.toLowerCase().replace(/\s+/g, " ").trim())
        .sort()
        .join(";");
      const locationsCompatible =
        incomingLocations === candidateLocations ||
        incomingLocations === "" ||
        candidateLocations === "";
      if (!locationsCompatible) {
        continue;
      }
      const distance = hammingDistance64(
        fromSignedBigint(candidate.simhash),
        fromSignedBigint(keys.simhashSigned)
      );
      if (distance <= SIMHASH_HAMMING_THRESHOLD) {
        return candidate;
      }
    }
  }

  return null;
}

async function upsertCompany(db: Database, job: CanonicalJob): Promise<string> {
  const nameNormalized = normalizeCompanyName(job.companyNameRaw);
  const inserted = await db
    .insert(schema.companies)
    .values({ nameNormalized, nameRaw: job.companyNameRaw, domain: job.companyDomain })
    .onConflictDoNothing({ target: schema.companies.nameNormalized })
    .returning({ id: schema.companies.id });
  if (inserted[0]) {
    return inserted[0].id;
  }
  const existing = await db.query.companies.findFirst({
    where: eq(schema.companies.nameNormalized, nameNormalized)
  });
  return existing!.id;
}

function contentColumns(job: CanonicalJob, keys: Keys) {
  return {
    titleRaw: job.titleRaw,
    titleNormalized: job.titleNormalized,
    titleFamily: job.titleFamily,
    seniority: job.seniority,
    companyNameRaw: job.companyNameRaw,
    companyNameNormalized: normalizeCompanyName(job.companyNameRaw),
    companyDomain: job.companyDomain,
    canonicalUrl: job.canonicalUrl,
    canonicalUrlNormalized: keys.canonicalUrlNormalized,
    applyUrl: job.applyUrl,
    applyUrlNormalized: keys.applyUrlNormalized,
    descriptionText: job.descriptionText,
    responsibilities: job.responsibilities,
    requiredSkills: job.requiredSkills,
    preferredSkills: job.preferredSkills,
    requiredExperienceYears: job.requiredExperienceYears,
    educationRequirements: job.educationRequirements,
    languageRequirements: job.languageRequirements,
    locations: job.locations,
    workMode: job.workMode,
    remoteRegion: job.remoteRegion,
    employmentTypes: job.employmentTypes,
    compensation: job.compensation,
    visaSponsorship: job.visaSponsorship,
    publishedAt: job.publishedAt === null ? null : new Date(job.publishedAt),
    expiresAt: job.expiresAt === null ? null : new Date(job.expiresAt),
    dedupeKey: keys.key,
    simhash: keys.simhashSigned ?? 0n,
    canonicalContentHash: keys.contentHash,
    extractionMethod: job.extractionMethod,
    extractionConfidence: job.extractionConfidence
  };
}

/** Rebuilds the CanonicalJob snapshot from the persisted row (persisted id). */
export function rowToCanonical(row: JobRow): CanonicalJob {
  return {
    id: row.id,
    sourceId: row.contentSourceId,
    sourceJobId: null,
    sourceUrl: row.canonicalUrl,
    canonicalUrl: row.canonicalUrl,
    applyUrl: row.applyUrl,
    titleRaw: row.titleRaw,
    titleNormalized: row.titleNormalized,
    titleFamily: row.titleFamily,
    seniority: row.seniority as CanonicalJob["seniority"],
    companyNameRaw: row.companyNameRaw,
    companyId: row.companyId,
    companyNameNormalized: row.companyNameNormalized,
    companyDomain: row.companyDomain,
    descriptionText: row.descriptionText,
    responsibilities: row.responsibilities,
    requiredSkills: row.requiredSkills,
    preferredSkills: row.preferredSkills,
    requiredExperienceYears: row.requiredExperienceYears,
    educationRequirements: row.educationRequirements,
    languageRequirements: row.languageRequirements,
    locations: row.locations,
    workMode: row.workMode as CanonicalJob["workMode"],
    remoteRegion: row.remoteRegion,
    employmentTypes: row.employmentTypes,
    compensation: row.compensation as CanonicalJob["compensation"],
    visaSponsorship: row.visaSponsorship as CanonicalJob["visaSponsorship"],
    publishedAt: row.publishedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    status: row.status as CanonicalJob["status"],
    extractionMethod: row.extractionMethod as CanonicalJob["extractionMethod"],
    extractionConfidence: row.extractionConfidence,
    contentHash: row.canonicalContentHash,
    evidence: row.evidence
  };
}

async function upsertOccurrence(
  db: Database,
  jobId: string,
  extracted: ExtractedJob,
  contentHash: string,
  now: Date
): Promise<void> {
  const { provenance, job } = extracted;
  await db
    .insert(schema.sourceOccurrences)
    .values({
      jobId,
      sourceId: provenance.sourceId,
      sourceJobId: provenance.externalId ?? job.canonicalUrl,
      sourceUrl: provenance.url,
      lastContentHash: contentHash,
      firstSeenAt: now,
      lastSeenAt: now
    })
    .onConflictDoUpdate({
      target: [schema.sourceOccurrences.sourceId, schema.sourceOccurrences.sourceJobId],
      set: { lastSeenAt: now, lastContentHash: contentHash, sourceUrl: provenance.url }
    });
}

async function insertVersion(
  db: Database,
  jobId: string,
  version: number,
  contentHash: string,
  contentSourceId: string,
  payload: CanonicalJob
): Promise<void> {
  await db.insert(schema.jobVersions).values({
    jobId,
    version,
    canonicalContentHash: contentHash,
    contentSourceId,
    payload
  });
}

/**
 * Persists one extraction with layered dedupe, gap-filling merge and
 * immutable versioning. Idempotent: re-running with identical content only
 * touches last_seen_at.
 */
export async function persistExtractedJob(
  db: Database,
  extracted: ExtractedJob,
  now = new Date()
): Promise<PersistOutcome> {
  const keys = computeKeys(extracted.job);
  const existing = await resolveExistingJob(db, extracted, keys);

  if (!existing) {
    const companyId = await upsertCompany(db, extracted.job);
    const snapshot: CanonicalJob = { ...extracted.job, companyId };
    await db.insert(schema.jobs).values({
      id: snapshot.id,
      companyId,
      ...contentColumns(snapshot, keys),
      evidence: snapshot.evidence,
      firstSeenAt: now,
      lastSeenAt: now,
      status: "active",
      contentSourceId: extracted.provenance.sourceId,
      currentVersion: 1
    });
    await insertVersion(
      db,
      snapshot.id,
      1,
      keys.contentHash,
      extracted.provenance.sourceId,
      snapshot
    );
    await upsertOccurrence(db, snapshot.id, extracted, keys.contentHash, now);
    return "new";
  }

  await upsertOccurrence(db, existing.id, extracted, keys.contentHash, now);

  const isContentSource = extracted.provenance.sourceId === existing.contentSourceId;

  if (isContentSource && keys.contentHash !== existing.canonicalContentHash) {
    // The vigente source changed its content: full overwrite + new version.
    const evidence = evidenceUnion(existing.evidence, extracted.job.evidence);
    const nextVersion = existing.currentVersion + 1;
    const snapshot: CanonicalJob = {
      ...extracted.job,
      id: existing.id,
      companyId: existing.companyId,
      firstSeenAt: existing.firstSeenAt.toISOString(),
      evidence
    };
    await db
      .update(schema.jobs)
      .set({
        ...contentColumns(extracted.job, keys),
        evidence,
        lastSeenAt: now,
        currentVersion: nextVersion,
        contentSourceId: extracted.provenance.sourceId
      })
      .where(eq(schema.jobs.id, existing.id));
    await insertVersion(
      db,
      existing.id,
      nextVersion,
      keys.contentHash,
      extracted.provenance.sourceId,
      snapshot
    );
    return "updated";
  }

  if (!isContentSource) {
    // Secondary source: fill gaps only, never overwrite (§11.3).
    const master = rowToCanonical(existing);
    const { merged, filledFields } = fillGaps(master, extracted.job);
    if (filledFields.length > 0) {
      const mergedKeys = computeKeys(merged);
      const nextVersion = existing.currentVersion + 1;
      await db
        .update(schema.jobs)
        .set({
          ...contentColumns(merged, mergedKeys),
          evidence: merged.evidence,
          lastSeenAt: now,
          currentVersion: nextVersion
        })
        .where(eq(schema.jobs.id, existing.id));
      await insertVersion(
        db,
        existing.id,
        nextVersion,
        mergedKeys.contentHash,
        existing.contentSourceId,
        merged
      );
      return "updated";
    }
    const evidence = evidenceUnion(existing.evidence, extracted.job.evidence);
    await db
      .update(schema.jobs)
      .set({ evidence, lastSeenAt: now })
      .where(eq(schema.jobs.id, existing.id));
    return "unchanged";
  }

  await db.update(schema.jobs).set({ lastSeenAt: now }).where(eq(schema.jobs.id, existing.id));
  return "unchanged";
}
