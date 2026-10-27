/** Read-only, bounded live check of Frisby's corporate jobs page. */
import { listBoard } from "../src/direct/connectors.js";
import { boundedGet } from "../src/direct/http.js";
import { selectColombianPostings } from "../src/direct/ingest.js";

if (!process.argv.includes("--allow-live-sources")) {
  throw new Error("Canario externo desactivado: requiere --allow-live-sources.");
}

const listing = await listBoard({ atsType: "frisby", atsRef: "colombia" }, boundedGet);
if (listing.kind !== "complete") throw new Error(`Frisby: ${listing.detail}`);
const colombian = selectColombianPostings(listing.postings, new Date());
if (colombian.postings.length !== listing.boardTotal) throw new Error("Frisby: no todas las ofertas son colombianas");
const samples = [listing.postings[0], listing.postings[Math.floor(listing.postings.length / 2)], listing.postings.at(-1)];
for (const sample of samples) {
  if (!sample) throw new Error("Frisby: faltan muestras de aplicación");
  const response = await boundedGet(sample.applyUrl, { accept: "text/html" });
  if (response.status !== 200 || !response.body.includes("Diligencia el formulario")) {
    throw new Error(`Frisby: formulario de aplicación no disponible (HTTP ${response.status})`);
  }
}
console.log(JSON.stringify({ boardTotal: listing.boardTotal, colombian: colombian.postings.length, withDeclaredDate: listing.postings.filter((row) => row.publishedAt).length, checkedApplyForms: samples.length, links: [...new Set(listing.postings.map((row) => new URL(row.applyUrl).host))] }));
