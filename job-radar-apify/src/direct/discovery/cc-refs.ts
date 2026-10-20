import { WORKDAY_REF } from "../ats/workday.js";

/**
 * Board references from URLs seen by Common Crawl (scripts/direct-cc-tenants.ts).
 * Only the reference is taken; the board is then checked live, and enabled
 * only after human review.
 */

const LOCALE = /^[a-z]{2}(-[A-Z]{2})?$/;
const NOT_A_SITE = new Set(["wday", "job", "jobs", "login", "refreshFacet", "robots.txt", "siteMap.xml"]);

export function workdayRefFromUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = /^([a-z0-9][a-z0-9_-]*)\.(wd\d{1,3})\.myworkdayjobs\.com$/.exec(url.hostname.toLowerCase());
  if (!host) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const site = segments[0] && LOCALE.test(segments[0]) ? segments[1] : segments[0];
  if (!site || NOT_A_SITE.has(site)) return null;
  const ref = `${host[1]}/${host[2]}/${site}`;
  return WORKDAY_REF.test(ref) ? ref : null;
}

export function smartRecruitersIdFromUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.hostname !== "jobs.smartrecruiters.com") return null;
  const id = url.pathname.split("/").filter(Boolean)[0];
  return id && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id) && !["sr-jobs", "oneclick-ui", "ni"].includes(id) ? id : null;
}

