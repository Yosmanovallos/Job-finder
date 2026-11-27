import { decodeEntities, htmlToText } from "../../lib/ats-text.js";
import { isoOrNull, type SnapshotDraft } from "./job-snapshot.js";

// AI Resume Studio R4d — schema.org JobPosting written as MICRODATA
// (itemscope / itemtype / itemprop in the HTML) instead of JSON-LD. SAP
// SuccessFactors career sites (e.g. jobs.scotiabank.com) and many older
// CMSs publish vacancies this way, so a JSON-LD-only reader said «no
// encontramos los datos» on pages that DO declare them. Same rules as the
// JSON-LD reader: only what the page states as JobPosting properties; a
// property the page doesn't state stays null. No DOM library: bounded,
// regex-and-depth scanning of the posting's own element.

const MAX_HTML = 2 * 1024 * 1024;
const VOID = new Set(["meta", "link", "img", "br", "hr", "input", "source", "area", "base", "col", "embed", "param", "track", "wbr"]);

interface Tag {
  name: string;
  attrs: Record<string, string>;
  start: number;
  end: number;
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

function* tags(html: string, from = 0, to = html.length): Generator<Tag> {
  const re = /<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && m.index < to) yield { name: m[1].toLowerCase(), attrs: parseAttrs(m[2] ?? ""), start: m.index, end: re.lastIndex };
}

/** Index just after the element's matching close tag (same-name nesting counted). */
function closeOf(html: string, tag: Tag, limit: number): number {
  if (VOID.has(tag.name) || html[tag.end - 2] === "/") return tag.end;
  const re = new RegExp(`<(/?)${tag.name}\\b[^>]*>`, "gi");
  re.lastIndex = tag.end;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && m.index < limit) {
    depth += m[1] ? -1 : m[0].endsWith("/>") ? 0 : 1;
    if (depth === 0) return re.lastIndex;
  }
  return limit;
}

const isJobPosting = (t: Tag) => "itemscope" in t.attrs && /schema\.org\/JobPosting\b/i.test(t.attrs.itemtype ?? "");

/** Each property of the posting: «content»/«datetime» attribute, else the element's own text. */
function properties(html: string, start: number, end: number): Map<string, { text: string; html: string }[]> {
  const props = new Map<string, { text: string; html: string }[]>();
  for (const t of tags(html, start, end)) {
    const names = (t.attrs.itemprop ?? "").split(/\s+/).filter(Boolean);
    if (!names.length) continue;
    const close = closeOf(html, t, end);
    const inner = close > t.end ? html.slice(t.end, Math.max(t.end, html.lastIndexOf("<", close - 1))) : "";
    const attrValue = t.attrs.content ?? t.attrs.datetime ?? (t.name === "meta" ? "" : null);
    const value = attrValue !== null ? { text: attrValue.trim(), html: attrValue } : { text: htmlToText(inner), html: inner };
    for (const name of names) props.set(name, [...(props.get(name) ?? []), value]);
  }
  return props;
}

function first(props: Map<string, { text: string; html: string }[]>, name: string): string | null {
  return props.get(name)?.find((v) => v.text)?.text ?? null;
}

/** The first usable microdata JobPosting on the page as a snapshot draft, or null. */
export function jobPostingFromMicrodata(html: string): Partial<SnapshotDraft> | null {
  if (!html || html.length > MAX_HTML) return null;
  for (const t of tags(html)) {
    if (!isJobPosting(t)) continue;
    const end = closeOf(html, t, html.length);
    const props = properties(html, t.end, end);
    const title = first(props, "title") ?? first(props, "name");
    const description =
      ["description", "responsibilities", "qualifications", "skills", "experienceRequirements", "educationRequirements"]
        .map((name) => props.get(name)?.map((v) => (v.html.includes("<") ? htmlToText(v.html) : v.text)).filter(Boolean).join("\n") ?? "")
        .filter(Boolean)
        .join("\n\n") || null;
    if (!title || !description) continue;
    const place = [first(props, "addressLocality"), first(props, "addressRegion"), first(props, "addressCountry")].filter((p): p is string => Boolean(p));
    const remote = /TELECOMMUTE/i.test(first(props, "jobLocationType") ?? "") ? "remote" : null;
    return {
      title: title.replace(/\s+/g, " ").trim(),
      description,
      company: first(props, "hiringOrganization") ?? null,
      location: place.length ? [...new Set(place)].join(", ") : null,
      remote,
      employmentType: first(props, "employmentType"),
      datePosted: isoOrNull(first(props, "datePosted")),
      validThrough: isoOrNull(first(props, "validThrough")),
      salary: null,
      applyUrl: null
    };
  }
  return null;
}
