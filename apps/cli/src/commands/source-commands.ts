import {
  buildAdapter,
  loadSourcesConfig,
  type SourceConfig,
  type ExtractedJob
} from "@job-radar/sources";

export interface DiscoverOptions {
  sourcesPath: string;
  /** Adapter name ("greenhouse") or full source id ("greenhouse:gitlab"). */
  source: string;
  limit: number;
  profileId: string;
}

export interface DiscoverSummaryJob {
  title: string;
  company: string;
  url: string;
  location: string | null;
  source: string;
  externalId: string | null;
  publishedAt: string | null;
  descriptionPreview: string;
  evidenceCount: number;
}

export interface DiscoverReport {
  ok: boolean;
  dryRun: true;
  profileId: string;
  source: string;
  requested: number;
  found: number;
  jobs: DiscoverSummaryJob[];
}

export function selectSources(configs: SourceConfig[], selector: string): SourceConfig[] {
  return configs.filter(
    (config) => config.enabled && (config.adapter === selector || config.id === selector)
  );
}

/**
 * Runs discover → fetch → extract for the selected sources without writing
 * anywhere (persistence arrives in Phase 3, so every run is a dry run).
 */
export async function runDiscover(options: DiscoverOptions): Promise<DiscoverReport> {
  const file = loadSourcesConfig(options.sourcesPath);
  const selected = selectSources(file.sources, options.source);
  const jobs: ExtractedJob[] = [];
  let remaining = options.limit;

  for (const config of selected) {
    if (remaining <= 0) {
      break;
    }
    const adapter = buildAdapter(config);
    for await (const reference of adapter.discover({ limit: remaining })) {
      const document = await adapter.fetch(reference);
      jobs.push(...(await adapter.extract(document)));
      remaining -= 1;
      if (remaining <= 0) {
        break;
      }
    }
  }

  return {
    ok: true,
    dryRun: true,
    profileId: options.profileId,
    source: options.source,
    requested: options.limit,
    found: jobs.length,
    jobs: jobs.map(({ job }) => ({
      title: job.titleRaw,
      company: job.companyNameRaw,
      url: job.canonicalUrl,
      location: job.locations[0]?.raw ?? null,
      source: job.sourceId,
      externalId: job.sourceJobId,
      publishedAt: job.publishedAt,
      descriptionPreview: job.descriptionText.slice(0, 160),
      evidenceCount: job.evidence.length
    }))
  };
}
