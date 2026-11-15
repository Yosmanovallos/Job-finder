import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GUIDES_ENABLED } from "../config.js";
import { parseGuide, publishedGuides, type Guide } from "../lib/guides.js";

// Reads content/guias/*.md once per process: the guides ship with the
// deploy, so there is nothing to refresh at runtime. A file that fails to
// parse is skipped here (and fails `test:unit`), never served.
export const GUIDES_CONTENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "content", "guias");

export function loadGuidesFrom(dir: string): Guide[] {
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((name) => name.endsWith(".md") && name !== "README.md").sort();
  } catch {
    return [];
  }
  const guides: Guide[] = [];
  for (const name of files) {
    try {
      guides.push(parseGuide(name, fs.readFileSync(path.join(dir, name), "utf-8")));
    } catch (error) {
      console.warn("[guias] guía omitida:", (error as Error).message);
    }
  }
  return guides;
}

let cache: Guide[] | null = null;

/** Published guides, or none when the switch is off. */
export function getPublishedGuides(enabled: boolean = GUIDES_ENABLED): Guide[] {
  if (!enabled) return [];
  cache ??= publishedGuides(loadGuidesFrom(GUIDES_CONTENT_DIR));
  return cache;
}
