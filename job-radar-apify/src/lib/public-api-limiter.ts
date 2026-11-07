import { PUBLIC_API_POLICY } from "./public-api-policy.js";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

type Admission = { allowed: true; release: () => void } | { allowed: false; retryAfter: number };

/** Single-process sliding quotas. Rejections never extend a client's window. */
export class PublicApiLimiter {
  // Expiry plus the global 500/day admission cap bounds this map to 500 clients.
  private readonly clients = new Map<string, number[]>();
  private global: number[] = [];
  private active = 0;

  constructor(private readonly now: () => number = Date.now) {}

  acquire(client: string): Admission {
    const now = this.now();
    this.global = this.global.filter((time) => time > now - DAY_MS);
    for (const [key, times] of this.clients) {
      if (times[times.length - 1]! <= now - DAY_MS) this.clients.delete(key);
    }
    const times = (this.clients.get(client) ?? []).filter((time) => time > now - DAY_MS);
    const globalMinute = this.global.filter((time) => time > now - MINUTE_MS);
    const clientMinute = times.filter((time) => time > now - MINUTE_MS);
    const waits = [
      this.waitFor(times, PUBLIC_API_POLICY.perDay, DAY_MS, now),
      this.waitFor(clientMinute, PUBLIC_API_POLICY.perMinute, MINUTE_MS, now),
      this.waitFor(this.global, PUBLIC_API_POLICY.globalPerDay, DAY_MS, now),
      this.waitFor(globalMinute, PUBLIC_API_POLICY.globalPerMinute, MINUTE_MS, now)
    ];
    const wait = Math.max(...waits);
    if (wait > 0) return { allowed: false, retryAfter: wait };
    if (this.active >= PUBLIC_API_POLICY.concurrent) {
      return { allowed: false, retryAfter: 60 };
    }
    times.push(now);
    this.clients.set(client, times);
    this.global.push(now);
    this.active++;
    let released = false;
    return {
      allowed: true,
      release: () => {
        if (released) return;
        released = true;
        this.active--;
      }
    };
  }

  private waitFor(times: number[], limit: number, windowMs: number, now: number): number {
    if (times.length < limit) return 0;
    return Math.max(1, Math.ceil((times[times.length - limit]! + windowMs - now) / 1000));
  }
}
