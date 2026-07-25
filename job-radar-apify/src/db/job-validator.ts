import { Job } from '../sources/types.js';

const KNOWN_SOURCES = new Set([
  'LinkedIn', 'Computrabajo', 'Elempleo', 'Torre', 'Magneto', 'Workana',
  'WeRemoto', 'GetOnBoard', 'RemoteOK', 'Remotive', 'Indeed', 'Glassdoor'
]);

export interface ValidationResult {
  valid: Job[];
  discarded: Array<{ job: Job; reason: string }>;
}

/**
 * Contract gate before persistence ("Reviewer" del plan maestro): a
 * malformed job gets discarded here, it never crashes the role and never
 * reaches Postgres.
 */
export function validateJobs(jobs: Job[]): ValidationResult {
  const valid: Job[] = [];
  const discarded: Array<{ job: Job; reason: string }> = [];

  for (const job of jobs) {
    if (!job.title || job.title.trim().length <= 3) {
      discarded.push({ job, reason: 'title vacío o <= 3 caracteres' });
      continue;
    }
    if (!job.url || !/^https?:\/\//i.test(job.url)) {
      discarded.push({ job, reason: 'url ausente o no empieza con http(s)' });
      continue;
    }
    if (!job.source || !KNOWN_SOURCES.has(job.source)) {
      discarded.push({ job, reason: `source desconocida: "${job.source}"` });
      continue;
    }
    if (job.publishedAt && isNaN(new Date(job.publishedAt).getTime())) {
      discarded.push({ job, reason: 'publishedAt no parseable' });
      continue;
    }

    valid.push({
      ...job,
      company: job.company && job.company.trim() ? job.company : 'Confidencial'
    });
  }

  return { valid, discarded };
}
