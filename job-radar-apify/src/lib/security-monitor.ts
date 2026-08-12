// In-memory rate limiting + suspicious-activity tracking + alerting +
// temporary auto-block (Fase L1-L3 del plan de seguridad, 2026-08-02).
//
// Deliberately in-memory, not Redis-backed: this app runs as a single Node
// process today (see server.ts). If it's ever scaled to multiple instances,
// each instance tracks its own counters independently — a limit of "120/min"
// becomes "120/min per instance" behind a load balancer. Fine for one
// instance, a known limitation worth revisiting before horizontal scaling.
//
// IP extraction trusts `x-forwarded-for`'s first entry as the real client —
// only correct if the deployment platform (Render or similar) sits as a
// trusted single-hop proxy that sets/appends this header itself. A raw
// client can normally set arbitrary headers; a platform-terminated TLS edge
// is what makes this trustworthy here. If ever deployed behind something
// that blindly forwards a client-supplied X-Forwarded-For, this becomes
// spoofable (an attacker could fake a rotating IP to bypass every limit
// below, or fake a real user's IP to get them blocked) — worth re-checking
// against whatever's actually in front of this process before relying on it
// further.

import type { IncomingMessage } from "http";

export function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return first?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
}

interface IpState {
  // Per-SCOPE sliding windows of request timestamps, used by
  // checkRateLimit — pruned lazily on each check rather than via a
  // background timer. Real bug found live 2026-08-08: this used to be a
  // single shared `number[]` for every caller regardless of `scope`, so
  // the lenient general limit (120/min, checked on every /api/* request)
  // and the strict sensitive limit (10/min, checked only on
  // checkout/CV-generate/etc.) were secretly the SAME counter — a normal
  // dashboard session (a handful of ordinary GETs) exhausted the
  // "sensitive" budget before the user ever attempted a sensitive action,
  // so the very first checkout/CV-generate click of a session reliably
  // 429'd. Keyed by scope now so two limiters never collide.
  requestTimestamps: Map<string, number[]>;
  // Timestamps of "suspicious" events (401/403/429/rate-limit hits) for
  // this IP — separate window from the rate limiter's, feeds the alert and
  // auto-block thresholds. Deliberately still IP-wide, not per-scope: L2/L3
  // care about how sketchy this IP looks overall, not which specific limit
  // it tripped.
  suspiciousTimestamps: number[];
  // Set once this IP crosses BLOCK_THRESHOLD; requests are rejected
  // immediately (before touching any route) until this time passes. Never
  // permanent — an in-memory temporary cooldown, not an IP ban list. A
  // threshold picked without having seen real production traffic yet is a
  // guess; a guess that's wrong should be recoverable in minutes, not
  // require someone to manually unblock a real customer.
  blockedUntil: number | null;
}

const ipStates = new Map<string, IpState>();

function getState(ip: string): IpState {
  let state = ipStates.get(ip);
  if (!state) {
    state = { requestTimestamps: new Map(), suspiciousTimestamps: [], blockedUntil: null };
    ipStates.set(ip, state);
  }
  return state;
}

// Unbounded growth guard: a Map entry per distinct IP ever seen would leak
// memory forever on a public server. Sweeps out IPs with no recent activity
// and no active block on a timer instead of per-request (cheaper — this
// doesn't need to be exact, just bounded).
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const STALE_AFTER_MS = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [ip, state] of ipStates) {
    let lastRequest = 0;
    for (const timestamps of state.requestTimestamps.values()) {
      lastRequest = Math.max(lastRequest, timestamps[timestamps.length - 1] || 0);
    }
    const lastActivity = Math.max(
      lastRequest,
      state.suspiciousTimestamps[state.suspiciousTimestamps.length - 1] || 0
    );
    if (now - lastActivity > STALE_AFTER_MS && (!state.blockedUntil || state.blockedUntil < now)) {
      ipStates.delete(ip);
    }
  }
}, SWEEP_INTERVAL_MS).unref();

export function isBlocked(ip: string): boolean {
  const state = ipStates.get(ip);
  if (!state?.blockedUntil) return false;
  if (state.blockedUntil < Date.now()) {
    state.blockedUntil = null;
    return false;
  }
  return true;
}

/**
 * Sliding-window rate limit. Returns true if the request is allowed, false
 * if `limit` was already reached within `windowMs`. Callers are responsible
 * for calling recordSuspiciousEvent() on a false result — this function
 * only tracks the rate, not what should happen when it's exceeded.
 *
 * `scope` isolates this call's counter from any other caller using a
 * different `scope` for the same IP (e.g. "general" vs "sensitive") — two
 * limiters checking the same IP must never share one counter, or the
 * stricter one gets exhausted by traffic the looser one was meant to allow
 * (see the note on `IpState.requestTimestamps` for the real incident this
 * fixed).
 */
export function checkRateLimit(
  ip: string,
  limit: number,
  windowMs: number,
  scope: string
): boolean {
  const state = getState(ip);
  const now = Date.now();
  const cutoff = now - windowMs;
  const timestamps = (state.requestTimestamps.get(scope) ?? []).filter((t) => t > cutoff);
  if (timestamps.length >= limit) {
    state.requestTimestamps.set(scope, timestamps);
    return false;
  }
  timestamps.push(now);
  state.requestTimestamps.set(scope, timestamps);
  return true;
}

const SUSPICIOUS_WINDOW_MS = 5 * 60 * 1000;
const ALERT_THRESHOLD = 20;
const BLOCK_THRESHOLD = 40;
const BLOCK_DURATION_MS = 15 * 60 * 1000;

// Discord's incoming-webhook format ({content: string}) — free, a channel
// owner sets one up in ~2 minutes (channel settings → Integrations →
// Webhooks → New Webhook → copy URL), no account/paid service needed. Slack
// incoming webhooks use {text: string} instead — swap the field name below
// if that's what's configured. Absent entirely, alerts just log to stderr
// instead of failing the request that triggered them.
async function sendSecurityAlert(message: string): Promise<void> {
  const webhookUrl = process.env.SECURITY_ALERT_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error(
      "[SecurityMonitor] ALERTA (sin SECURITY_ALERT_WEBHOOK_URL configurado):",
      message
    );
    return;
  }
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message })
    });
  } catch (e) {
    console.error("[SecurityMonitor] No se pudo enviar la alerta al webhook:", e);
  }
}

/**
 * Records one suspicious event (401, 403, or a rate-limit rejection) for an
 * IP. Fires an alert once the count crosses ALERT_THRESHOLD within
 * SUSPICIOUS_WINDOW_MS, and sets a temporary block once it crosses
 * BLOCK_THRESHOLD — both edge-triggered (each fires once per window, not
 * once per event past the threshold, so a sustained attack doesn't spam
 * the alert channel every single request).
 */
export function recordSuspiciousEvent(ip: string, reason: string): void {
  const state = getState(ip);
  const now = Date.now();
  const cutoff = now - SUSPICIOUS_WINDOW_MS;
  state.suspiciousTimestamps = state.suspiciousTimestamps.filter((t) => t > cutoff);
  state.suspiciousTimestamps.push(now);
  const count = state.suspiciousTimestamps.length;

  if (count === BLOCK_THRESHOLD) {
    state.blockedUntil = now + BLOCK_DURATION_MS;
    void sendSecurityAlert(
      `🚫 IP ${ip} bloqueada temporalmente (${BLOCK_DURATION_MS / 60000} min) — ${count} eventos sospechosos en ${SUSPICIOUS_WINDOW_MS / 60000} min. Último motivo: ${reason}.`
    );
  } else if (count === ALERT_THRESHOLD) {
    void sendSecurityAlert(
      `⚠️ IP ${ip} generó ${count} eventos sospechosos (401/403/429) en ${SUSPICIOUS_WINDOW_MS / 60000} min. Motivo: ${reason}.`
    );
  }
}
