import { pool } from './client.js';

/**
 * Idempotent upsert of the known role list into `search_roles` — safe to
 * call on every boot. Roles already present (or later deactivated by an
 * admin) are left untouched.
 */
export async function seedSearchRoles(roleNames: string[]): Promise<void> {
  for (const name of roleNames) {
    await pool.query(
      `INSERT INTO search_roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [name]
    );
  }
}

export async function getActiveRoleNames(): Promise<string[]> {
  const result = await pool.query(`SELECT name FROM search_roles WHERE is_active = TRUE ORDER BY name`);
  return result.rows.map(r => r.name);
}

/**
 * For every active role, returns which sources are due for a re-scrape
 * (never run, or last run longer ago than that source's configured
 * cadence). Grouped by role so the cron can enqueue one work item per role.
 */
export async function getDueRoleSources(cadenceMs: Record<string, number>): Promise<Map<string, string[]>> {
  const roles = await getActiveRoleNames();
  const due = new Map<string, string[]>();
  if (roles.length === 0) return due;

  const result = await pool.query(
    `SELECT role_name, source_name, last_run_at FROM role_source_runs WHERE role_name = ANY($1)`,
    [roles]
  );

  const lastRun = new Map<string, number>();
  for (const row of result.rows) {
    lastRun.set(`${row.role_name}::${row.source_name}`, new Date(row.last_run_at).getTime());
  }

  const now = Date.now();
  for (const role of roles) {
    const dueSources: string[] = [];
    for (const [source, cadence] of Object.entries(cadenceMs)) {
      const lastRunAt = lastRun.get(`${role}::${source}`);
      if (lastRunAt === undefined || now - lastRunAt >= cadence) {
        dueSources.push(source);
      }
    }
    if (dueSources.length > 0) {
      due.set(role, dueSources);
    }
  }

  return due;
}

/**
 * Forces a role to be picked up by the next scheduled tick, regardless of its
 * sources' normal cadence — used by the authenticated manual "rescan" trigger.
 * Scraping itself always runs out-of-process (GitHub Actions), never inline
 * on the web request, so this just clears the role's cadence bookkeeping
 * instead of running anything synchronously.
 */
export async function markRoleForImmediateRescan(roleName: string): Promise<void> {
  await pool.query(`DELETE FROM role_source_runs WHERE role_name = $1`, [roleName]);
}

export async function markRoleSourceRun(roleName: string, sourceName: string): Promise<void> {
  await pool.query(
    `INSERT INTO role_source_runs (role_name, source_name, last_run_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (role_name, source_name) DO UPDATE SET last_run_at = NOW()`,
    [roleName, sourceName]
  );
}

/** Cron C — keeps the corpus bounded to the last 30 days. */
export async function purgeOldJobs(): Promise<number> {
  const result = await pool.query(`DELETE FROM jobs WHERE created_at < NOW() - INTERVAL '30 days'`);
  return result.rowCount ?? 0;
}
