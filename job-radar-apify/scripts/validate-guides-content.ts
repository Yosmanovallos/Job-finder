// Validates content/guias/*.md and prints each guide's useful word count.
// Usage: npx tsx scripts/validate-guides-content.ts
import fs from "node:fs";
import path from "node:path";
import { GUIDES_CONTENT_DIR, loadGuidesFrom } from "../src/server/guides-store.js";
import { parseGuide, usefulWordCount, validateGuides } from "../src/lib/guides.js";

const files = fs.readdirSync(GUIDES_CONTENT_DIR).filter((name) => name.endsWith(".md") && name !== "README.md");
let failed = false;
for (const name of files) {
  try {
    parseGuide(name, fs.readFileSync(path.join(GUIDES_CONTENT_DIR, name), "utf-8"));
  } catch (error) {
    failed = true;
    console.log(`✖ ${name}: ${(error as Error).message}`);
  }
}
const guides = loadGuidesFrom(GUIDES_CONTENT_DIR);
for (const [index, result] of validateGuides(guides).entries()) {
  const words = usefulWordCount(guides[index]!);
  const state = guides[index]!.meta.revision_propietario;
  if (result.errors.length) failed = true;
  console.log(`${result.errors.length ? "✖" : "✔"} ${result.file} · ${words} palabras útiles · ${state}`);
  for (const error of result.errors) console.log(`    - ${error}`);
}
process.exit(failed ? 1 : 0);
