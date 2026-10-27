/** Read-only, bounded check of the public Altipal vacancies linked by its corporate site. */
import { listBoard } from "../src/direct/connectors.js";
import { boundedGet } from "../src/direct/http.js";
import { selectColombianPostings } from "../src/direct/ingest.js";

if (!process.argv.includes("--allow-live-sources")) {
  throw new Error("Canario externo desactivado: requiere --allow-live-sources.");
}

const listing = await listBoard({ atsType: "altipal", atsRef: "creeser" }, boundedGet, { detailBudget: 3 });
if (listing.kind !== "complete") throw new Error(`Altipal: ${listing.detail}`);
if (listing.boardTotal < 3 || listing.postings.length !== 3 || listing.deferred !== listing.boardTotal - 3) {
  throw new Error("Altipal: listado incompleto o presupuesto de detalle inesperado");
}
if (listing.postings.some((posting) => !posting.descriptionText || posting.partial)) {
  throw new Error("Altipal: una ficha pública no entregó descripción");
}
const selected = selectColombianPostings(listing.postings);
if (selected.stats.notColombia !== 0) throw new Error("Altipal: ubicación inesperada");
console.log(JSON.stringify({
  boardTotal: listing.boardTotal,
  checkedDetails: listing.postings.length,
  deferred: listing.deferred,
  colombian: selected.stats.colombia,
  current: selected.stats.kept,
  stale: selected.stats.stale,
  uniqueIds: new Set(listing.postings.map((posting) => posting.externalId)).size
}));
