import crypto from 'crypto';
import dotenv from 'dotenv';
import { Job } from '../sources/types.js';
import { saveRunToCache, getAllCachedJobs, getAllCachedRuns } from '../cache-manager.js';

dotenv.config();

// SHA256 helper for url_hash
export function computeUrlHash(url: string): string {
  const normalized = url.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// In-memory store fallback for offline/local execution when Supabase is not connected
const localInMemoryJobs: Map<string, Job & { urlHash: string; sources: string[] }> = new Map();

/**
 * Saves a list of scraped jobs with url_hash deduplication and sources array merging.
 */
export async function saveJobs(jobs: Job[], roleOrigin: string = 'General'): Promise<{ savedCount: number; duplicateCount: number }> {
  let savedCount = 0;
  let duplicateCount = 0;

  // Process deduplication and merging in local store
  for (const job of jobs) {
    const hash = computeUrlHash(job.url);
    const existing = localInMemoryJobs.get(hash);

    if (existing) {
      // Merge sources array if not already included
      if (!existing.sources.includes(job.source)) {
        existing.sources.push(job.source);
      }
      duplicateCount++;
    } else {
      const newSources = [job.source];
      localInMemoryJobs.set(hash, {
        ...job,
        urlHash: hash,
        sources: newSources
      });
      savedCount++;
    }
  }

  // Also persist run to local JSON cache for backward compatibility
  try {
    const runId = `run_${Date.now()}`;
    saveRunToCache({
      id: runId,
      name: `${roleOrigin} (${jobs.length} Vacantes)`,
      role: roleOrigin,
      timestamp: new Date().toISOString(),
      jobs: jobs as any[]
    });
  } catch (e) {
    console.warn('[JobRepository] Warning: Could not save run to local cache file:', e);
  }

  console.log(`💾 [JobRepository] Guardado completado: ${savedCount} nuevas vacantes, ${duplicateCount} fusionadas en deduplicación.`);
  return { savedCount, duplicateCount };
}

/**
 * Retrieves jobs from repository, optionally filtering by age or pagination.
 */
export async function getJobs(limit: number = 100, offset: number = 0, minAgeHours?: number): Promise<Job[]> {
  // If local in-memory store is populated, return from it
  let allJobsList: Array<Job & { sources?: string[] }> = [];

  if (localInMemoryJobs.size > 0) {
    allJobsList = Array.from(localInMemoryJobs.values()).map(item => ({
      ...item,
      dateText: item.dateText,
      alsoIn: item.sources.filter(s => s !== item.source)
    }));
  } else {
    // Fallback to cache manager
    const cached = getAllCachedJobs();
    allJobsList = cached;
  }

  // Filter by minAgeHours if requested (for 24h / 48h paywall logic)
  if (minAgeHours !== undefined) {
    const now = Date.now();
    allJobsList = allJobsList.filter(job => {
      if (!job.publishedAt) return true;
      const pubTime = new Date(job.publishedAt).getTime();
      const ageHours = (now - pubTime) / (1000 * 60 * 60);
      return ageHours >= minAgeHours;
    });
  }

  // Sort by publishedAt DESC or dateText
  allJobsList.sort((a, b) => {
    const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return dateB - dateA;
  });

  return allJobsList.slice(offset, offset + limit);
}

/**
 * Retrieves all scraping runs.
 */
export async function getRuns() {
  return getAllCachedRuns();
}

/**
 * Clears the repository (useful for testing).
 */
export function clearRepository() {
  localInMemoryJobs.clear();
}
