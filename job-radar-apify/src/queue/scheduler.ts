import { ScrapeWorker } from "./scrape-worker.js";
import { SourceAdapter } from "../sources/index.js";

export const DEFAULT_ROLES_200: string[] = [
  "Project Manager",
  "Data Analyst",
  "Data Engineer",
  "RPA Developer",
  "QA Engineer",
  "AI Engineer",
  "Cuidadora de Adultos Mayores",
  "Auxiliar de Enfermería",
  "UX Designer",
  "UI Designer",
  "Desarrollador React",
  "Desarrollador Node.js",
  "Desarrollador Python",
  "Desarrollador Java",
  "Desarrollador Full Stack",
  "Desarrollador Frontend",
  "Desarrollador Backend",
  "Desarrollador Mobile",
  "Ingeniero DevOps",
  "Arquitecto de Software",
  "Scrum Master",
  "Product Owner",
  "Business Analyst",
  "Diseñador Gráfico",
  "Community Manager",
  "Especialista en Marketing Digital",
  "Contador Público",
  "Auxiliar Administrativo",
  "Ejecutivo de Ventas",
  "Asesor Comercial"
];

interface QueueItem {
  roleName: string;
  /** Undefined means "all sources" (manual/admin trigger default). */
  adapters?: SourceAdapter[];
  /** How many times this item has already timed out and been requeued. */
  timeoutRetries?: number;
}

const ROLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 min, per plan section on per-role budgets
const MAX_TIMEOUT_RETRIES = 2; // bounded — a role that keeps timing out is dropped, not looped forever

export class RoleScheduler {
  private worker: ScrapeWorker;
  private queue: QueueItem[] = [];
  private isProcessing: boolean = false;
  private lastCycle: { savedCount: number; completedAt: number } | null = null;
  private roleTimeoutMs: number;

  constructor(maxConcurrency: number = 3, roleTimeoutMs: number = ROLE_TIMEOUT_MS) {
    this.worker = new ScrapeWorker(maxConcurrency);
    this.roleTimeoutMs = roleTimeoutMs;
  }

  /**
   * Adds roles to the scheduled queue for a full scan (all sources) —
   * used by the manual/admin trigger.
   */
  enqueueRoles(roles: string[]) {
    for (const role of roles) {
      if (!this.queue.some((item) => item.roleName === role)) {
        this.queue.push({ roleName: role });
      }
    }
    console.log(
      `📋 [Scheduler] ${roles.length} roles encolados. Total en cola: ${this.queue.length}.`
    );
    this.processQueueStaggered();
  }

  /**
   * Enqueues a single role restricted to a specific subset of sources —
   * used by the cron scheduler to respect per-source cadence. If the role is
   * already queued, merges the adapter sets instead of duplicating the entry.
   */
  enqueueRoleWithAdapters(roleName: string, adapters: SourceAdapter[]) {
    const existing = this.queue.find((item) => item.roleName === roleName);
    if (existing) {
      if (existing.adapters) {
        const names = new Set(existing.adapters.map((a) => a.name));
        for (const adapter of adapters) {
          if (!names.has(adapter.name)) {
            existing.adapters.push(adapter);
            names.add(adapter.name);
          }
        }
      }
      // If existing has no adapters (means "all sources"), leave it as-is — it already covers this.
    } else {
      this.queue.push({ roleName, adapters });
    }
    this.processQueueStaggered();
  }

  /**
   * Process enqueued roles in staggered batches (3 at a time) to avoid memory or network surges.
   */
  private async processQueueStaggered() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    console.log(`🚀 [Scheduler] Iniciando escaneo escalonado de la cola de roles...`);
    let cycleSavedCount = 0;

    while (this.queue.length > 0) {
      // Process next 3 roles in parallel
      const batch = this.queue.splice(0, 3);
      console.log(
        `📦 [Scheduler] Procesando lote escalonado: [${batch.map((item) => item.roleName).join(", ")}]`
      );

      const results = await Promise.allSettled(batch.map((item) => this.runWithTimeout(item)));
      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          cycleSavedCount += result.value.savedCount;
        }
      }

      // Stagger delay of 1.5 seconds between batches
      if (this.queue.length > 0) {
        await new Promise((res) => setTimeout(res, 1500));
      }
    }

    this.lastCycle = { savedCount: cycleSavedCount, completedAt: Date.now() };
    this.isProcessing = false;
    console.log(
      `🏁 [Scheduler] Todos los roles de la cola han sido procesados con éxito (${cycleSavedCount} vacantes nuevas en total).`
    );
  }

  /**
   * Races a single role's processing against a 5-min budget. On timeout,
   * the underlying fetch keeps running in the background (adapters aren't
   * cancellable without touching their internals) but the scheduler stops
   * waiting and frees the concurrency slot — the role gets requeued at the
   * back (low priority), up to MAX_TIMEOUT_RETRIES, after which it's dropped
   * and logged rather than looped forever.
   */
  private async runWithTimeout(item: QueueItem): Promise<{ savedCount: number } | null> {
    let timedOut = false;
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve(null);
      }, this.roleTimeoutMs);
    });

    const workPromise = this.worker
      .processRoleJob({ roleName: item.roleName, dateRange: "48h", adapters: item.adapters })
      .catch((err) => {
        console.error(`❌ [Scheduler] Rol "${item.roleName}" falló:`, err?.message || err);
        return null;
      });

    const result = await Promise.race([workPromise, timeoutPromise]);

    if (timedOut) {
      const retries = (item.timeoutRetries || 0) + 1;
      if (retries > MAX_TIMEOUT_RETRIES) {
        console.error(
          `🛑 [Scheduler] Rol "${item.roleName}" superó los 5 min ${retries} veces — se descarta este ciclo (no se reintenta indefinidamente).`
        );
      } else {
        console.warn(
          `⏱️ [Scheduler] Rol "${item.roleName}" superó los 5 min (intento ${retries}/${MAX_TIMEOUT_RETRIES}) — se re-encola con prioridad baja al final de la cola.`
        );
        this.queue.push({
          roleName: item.roleName,
          adapters: item.adapters,
          timeoutRetries: retries
        });
      }
      return null;
    }

    return result;
  }

  /** Most recently completed full drain of the queue — used by the cron watchdog. */
  getLastCycle() {
    return this.lastCycle;
  }

  /**
   * Status overview
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing
    };
  }
}

export const globalScheduler = new RoleScheduler(3);
