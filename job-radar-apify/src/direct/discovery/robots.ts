/**
 * robots.txt per RFC 9309 (docs/source-catalog/site-probe-ats-links.md §1.1):
 * groups matched by product token (case-insensitive) or "*", matching groups
 * merged, a specific group never merged with "*", longest match wins, a tie
 * goes to Allow, "*" and "$" supported. Crawl-delay is not in the RFC but is
 * honored when the applicable group declares it.
 */

export const BOT_TOKEN = "buscotrabajobot";

interface Rule {
  allow: boolean;
  pattern: string;
}

export interface RobotsPolicy {
  /** "all" = 4xx / no file; "none" = unreachable (5xx, network error). */
  kind: "rules" | "all" | "none";
  rules: Rule[];
  crawlDelaySeconds: number | null;
}

export const ALLOW_ALL: RobotsPolicy = { kind: "all", rules: [], crawlDelaySeconds: null };
export const DISALLOW_ALL: RobotsPolicy = { kind: "none", rules: [], crawlDelaySeconds: null };

export function parseRobots(body: string, token = BOT_TOKEN): RobotsPolicy {
  type Group = { agents: string[]; rules: Rule[]; crawlDelay: number | null };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" || field === "disallow") {
      // An empty Disallow forbids nothing.
      if (value) current.rules.push({ allow: field === "allow", pattern: value });
    } else if (field === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = seconds;
    }
  }
  const specific = groups.filter((group) => group.agents.some((agent) => agent !== "*" && agent.length > 0 && token.startsWith(agent)));
  const chosen = specific.length > 0 ? specific : groups.filter((group) => group.agents.includes("*"));
  const delays = chosen.map((group) => group.crawlDelay).filter((value): value is number => value !== null);
  return {
    kind: "rules",
    rules: chosen.flatMap((group) => group.rules),
    crawlDelaySeconds: delays.length ? Math.max(...delays) : null
  };
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = new RegExp(
    "^" + body.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : "")
  );
  return regex.test(path);
}

function normalizePath(path: string): string {
  // Compare percent-encoding case-insensitively and unreserved bytes decoded.
  return path.replace(/%([0-9a-f]{2})/gi, (match, hex: string) => {
    const char = String.fromCharCode(parseInt(hex, 16));
    return /[A-Za-z0-9\-._~]/.test(char) ? char : `%${hex.toUpperCase()}`;
  });
}

/** May the bot fetch this path + query? */
export function isAllowed(policy: RobotsPolicy, pathAndQuery: string): boolean {
  if (policy.kind === "all") return true;
  if (policy.kind === "none") return false;
  if (pathAndQuery === "/robots.txt") return true;
  const path = normalizePath(pathAndQuery || "/");
  let best: Rule | null = null;
  for (const rule of policy.rules) {
    if (!patternMatches(normalizePath(rule.pattern), path)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}
