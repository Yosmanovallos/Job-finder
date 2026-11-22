// Resume Studio R2: blocks pdfjs-dist's optional native binary (@napi-rs/canvas).
// pdf.js wraps this require in try/catch and only warns, so throwing here
// behaves exactly like the package being absent. Text extraction never
// draws, so nothing else needs it.
throw new Error("@napi-rs/canvas is intentionally not installed (native binary blocked).");
