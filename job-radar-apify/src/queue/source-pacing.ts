/**
 * F-fuentes — rate-sensitive sources keep today's tick rhythm
 * (docs/adr/0010-external-dispatch-cadence.md).
 *
 * LinkedIn and Computrabajo already answer 429 on detail pages at today's
 * ~5 ticks/day. Their LISTING pressure is bounded per role by
 * role_source_runs cadence, but the detail DRAIN is not: every tick claims up
 * to the source's detail cap again. More ticks per day (an external
 * workflow_dispatch cron) would therefore mean proportionally more detail
 * requests to exactly the hosts that are already asking us to slow down.
 *
 * Rule: these sources take part in a tick only when
 *   - GitHub's own `schedule` fired it (what happens today, unchanged), or
 *   - their last participation is at least PACED_FALLBACK_MS old, so a
 *     schedule tick replaced in the concurrency queue by a dispatch tick can
 *     never starve them beyond today's worst observed gap.
 * Every other source uses every tick. While all ticks come from `schedule`
 * (today) this module changes nothing.
 *
 * Pure: the caller reads/writes the last-participation timestamp.
 */

export const PACED_SOURCES: Readonly<Record<string, readonly string[]>> = {
  CO: ["LinkedIn", "Computrabajo"],
  VE: ["LinkedIn-VE", "Computrabajo-VE"]
};

/**
 * 7 h = the longest gap between schedule ticks measured 2026-10-25 →
 * 2026-11-01 (7.17 h CO, 7.23 h VE; p50 4.85 h). A fallback participation
 * can only happen after a gap at least this long, so it never runs these
 * sources more often than the worst case already did.
 */
export const PACED_FALLBACK_MS = 7 * 60 * 60 * 1000;

/** role_source_runs sentinel row: (role_name, source_name) = (__paced__, country). */
export const PACED_ROLE_SENTINEL = "__paced__";

export interface PacingDecision {
  allowed: boolean;
  reason: "schedule" | "fallback_gap" | "never_ran" | "held_for_schedule" | "history_unavailable";
  sources: readonly string[];
}

export function pacedSourcesFor(country: string): readonly string[] {
  return PACED_SOURCES[country] ?? [];
}

/**
 * @param lastParticipationMs  epoch ms of the last tick that ran these
 *   sources; `null` = no row yet; `undefined` = could not read it.
 */
export function decidePacing(input: {
  country: string;
  trigger: string;
  lastParticipationMs: number | null | undefined;
  nowMs: number;
}): PacingDecision {
  const sources = pacedSourcesFor(input.country);
  if (input.trigger === "schedule") return { allowed: true, reason: "schedule", sources };
  // Fail closed for non-schedule ticks: an unreadable history must not turn
  // into extra requests against a host that is already rate-limiting us.
  if (input.lastParticipationMs === undefined) return { allowed: false, reason: "history_unavailable", sources };
  if (input.lastParticipationMs === null) return { allowed: true, reason: "never_ran", sources };
  if (input.nowMs - input.lastParticipationMs >= PACED_FALLBACK_MS) return { allowed: true, reason: "fallback_gap", sources };
  return { allowed: false, reason: "held_for_schedule", sources };
}

/** Env handed to the separate drain step through $GITHUB_ENV. */
export const PACED_ENV_VAR = "PACED_SOURCES_ALLOWED";

/**
 * The drain step's filter. The tick's decision wins when it wrote one; if it
 * did not (it crashed first), fall back on the trigger with the same
 * fail-closed rule: only `schedule` ticks and local manual runs drain them.
 */
export function pacedOutForDrain(country: string, envValue: string | undefined, trigger: string): readonly string[] {
  if (envValue === "1") return [];
  if (envValue === "0") return pacedSourcesFor(country);
  return trigger === "schedule" || trigger === "manual" ? [] : pacedSourcesFor(country);
}
