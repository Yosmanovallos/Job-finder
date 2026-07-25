import { allAdapters, SourceAdapter } from '../sources/index.js';
import { SOURCE_CADENCE_MS } from './source-cadence.js';
import { seedSearchRoles, getDueRoleSources, purgeOldJobs } from '../db/scheduler-repository.js';
import { globalScheduler, DEFAULT_ROLES_200 } from './scheduler.js';

const TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_ROLES_PER_TICK = 12; // caps backlog bursts after downtime — the next tick picks up the rest

const adapterByName = new Map<string, SourceAdapter>(allAdapters.map(a => [a.name, a]));

let lastSeenCycleCompletedAt = 0;
let consecutiveEmptyCycles = 0;

/**
 * Cron A: enqueues roles whose sources are due per SOURCE_CADENCE_MS. No
 * user action ever triggers this — the corpus builds itself in the background.
 */
async function tick(): Promise<void> {
  try {
    const due = await getDueRoleSources(SOURCE_CADENCE_MS);
    if (due.size === 0) {
      console.log('🕒 [Cron] Ningún rol/fuente vencido en este ciclo.');
    } else {
      const roleEntries = Array.from(due.entries()).slice(0, MAX_ROLES_PER_TICK);
      console.log(`🕒 [Cron] ${due.size} roles con fuentes vencidas — encolando ${roleEntries.length} (tope ${MAX_ROLES_PER_TICK}/ciclo, el resto se recoge en el próximo).`);

      for (const [roleName, sourceNames] of roleEntries) {
        const adapters = sourceNames
          .map(name => adapterByName.get(name))
          .filter((a): a is SourceAdapter => !!a);
        if (adapters.length > 0) {
          globalScheduler.enqueueRoleWithAdapters(roleName, adapters);
        }
      }
    }

    // Watchdog: if the last completed drain cycle is new and saved 0 jobs,
    // count it. Two in a row → warn (possible mass block on multiple sources).
    const lastCycle = globalScheduler.getLastCycle();
    if (lastCycle && lastCycle.completedAt > lastSeenCycleCompletedAt) {
      lastSeenCycleCompletedAt = lastCycle.completedAt;
      consecutiveEmptyCycles = lastCycle.savedCount === 0 ? consecutiveEmptyCycles + 1 : 0;
      if (consecutiveEmptyCycles >= 2) {
        console.warn('🚨 [Cron][Watchdog] 2 ciclos seguidos sin guardar ninguna vacante nueva — posible bloqueo masivo o cambio de estructura en varias fuentes.');
      }
    }
  } catch (err: any) {
    console.error('❌ [Cron] Error en el ciclo de scraping programado:', err?.message || err);
  }
}

async function cleanupTick(): Promise<void> {
  try {
    const deleted = await purgeOldJobs();
    console.log(`🧹 [Cron] Limpieza diaria: ${deleted} vacantes con más de 30 días purgadas.`);
  } catch (err: any) {
    console.error('❌ [Cron] Error en la limpieza diaria:', err?.message || err);
  }
}

/**
 * Starts the background schedulers. Call once, after the HTTP server is
 * already listening — this must never block server startup.
 */
export async function startCronScheduler(): Promise<void> {
  await seedSearchRoles(DEFAULT_ROLES_200);
  console.log(`🌱 [Cron] ${DEFAULT_ROLES_200.length} roles sembrados en search_roles (idempotente).`);

  tick();
  setInterval(tick, TICK_INTERVAL_MS);
  setInterval(cleanupTick, CLEANUP_INTERVAL_MS);

  console.log(`🕒 [Cron] Scheduler activo — chequeo de roles vencidos cada ${TICK_INTERVAL_MS / 60000} min, limpieza cada ${CLEANUP_INTERVAL_MS / 3600000}h.`);
}
