import { ScrapeWorker } from './scrape-worker.js';

export const DEFAULT_ROLES_200: string[] = [
  "Project Manager", "Data Analyst", "Data Engineer", "RPA Developer", "QA Engineer", "AI Engineer",
  "Cuidadora de Adultos Mayores", "Auxiliar de Enfermería", "UX Designer", "UI Designer",
  "Desarrollador React", "Desarrollador Node.js", "Desarrollador Python", "Desarrollador Java",
  "Desarrollador Full Stack", "Desarrollador Frontend", "Desarrollador Backend", "Desarrollador Mobile",
  "Ingeniero DevOps", "Arquitecto de Software", "Scrum Master", "Product Owner", "Business Analyst",
  "Diseñador Gráfico", "Community Manager", "Especialista en Marketing Digital", "Contador Público",
  "Auxiliar Administrativo", "Ejecutivo de Ventas", "Asesor Comercial"
];

export class RoleScheduler {
  private worker: ScrapeWorker;
  private queue: string[] = [];
  private isProcessing: boolean = false;

  constructor(maxConcurrency: number = 3) {
    this.worker = new ScrapeWorker(maxConcurrency);
  }

  /**
   * Adds roles to the scheduled queue.
   */
  enqueueRoles(roles: string[]) {
    for (const role of roles) {
      if (!this.queue.includes(role)) {
        this.queue.push(role);
      }
    }
    console.log(`📋 [Scheduler] ${roles.length} roles encolados. Total en cola: ${this.queue.length}.`);
    this.processQueueStaggered();
  }

  /**
   * Process enqueued roles in staggered batches (3 at a time) to avoid memory or network surges.
   */
  private async processQueueStaggered() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    console.log(`🚀 [Scheduler] Iniciando escaneo escalonado de la cola de roles...`);

    while (this.queue.length > 0) {
      // Process next 3 roles in parallel
      const batch = this.queue.splice(0, 3);
      console.log(`📦 [Scheduler] Procesando lote escalonado: [${batch.join(', ')}]`);

      await Promise.allSettled(
        batch.map(role => this.worker.processRoleJob({ roleName: role, dateRange: '48h' }))
      );

      // Stagger delay of 1.5 seconds between batches
      if (this.queue.length > 0) {
        await new Promise(res => setTimeout(res, 1500));
      }
    }

    this.isProcessing = false;
    console.log(`🏁 [Scheduler] Todos los roles de la cola han sido procesados con éxito.`);
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
