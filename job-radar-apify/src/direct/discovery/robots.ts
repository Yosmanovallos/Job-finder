// The parser moved to src/lib/robots-txt.ts so job-board adapters
// (src/sources/, which the web server may import) can share it without
// reaching into src/direct/ (ADR 0006 §9).
export * from "../../lib/robots-txt.js";
