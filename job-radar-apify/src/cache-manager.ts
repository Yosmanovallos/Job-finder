import fs from 'fs';
import path from 'path';

const CACHE_DIR = path.join(process.cwd(), 'data');
const CACHE_FILE = path.join(CACHE_DIR, 'jobs-cache.json');

export interface CachedRun {
  id: string;
  name: string;
  role: string;
  timestamp: string;
  jobs: any[];
}

export interface CacheSchema {
  runs: CachedRun[];
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

export function loadCache(): CacheSchema {
  ensureCacheDir();
  if (!fs.existsSync(CACHE_FILE)) {
    return { runs: [] };
  }
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return { runs: [] };
  }
}

export function saveRunToCache(run: CachedRun) {
  ensureCacheDir();
  const current = loadCache();
  
  // Remove existing run with same ID or name if present
  current.runs = current.runs.filter(r => r.id !== run.id && r.name !== run.name);
  
  // Add new run at the beginning
  current.runs.unshift(run);

  // Keep max 20 runs
  current.runs = current.runs.slice(0, 20);

  fs.writeFileSync(CACHE_FILE, JSON.stringify(current, null, 2), 'utf-8');
  console.log(`[Local Cache] Successfully saved run "${run.name}" with ${run.jobs.length} jobs.`);
}

export function getAllCachedJobs(runId?: string): any[] {
  const cache = loadCache();
  if (cache.runs.length === 0) return [];

  if (runId && runId !== 'all') {
    const target = cache.runs.find(r => r.id === runId);
    return target ? target.jobs : [];
  }

  // Return jobs from all runs combined, deduplicated by URL
  const all: any[] = [];
  const urlsSeen = new Set<string>();

  for (const r of cache.runs) {
    for (const j of r.jobs) {
      if (!urlsSeen.has(j.url)) {
        urlsSeen.add(j.url);
        all.push({
          ...j,
          runId: r.id,
          runName: r.name
        });
      }
    }
  }

  return all;
}

export function getAllCachedRuns(): { id: string; name: string; count: number }[] {
  const cache = loadCache();
  return cache.runs.map(r => ({
    id: r.id,
    name: r.name,
    count: r.jobs.length
  }));
}
