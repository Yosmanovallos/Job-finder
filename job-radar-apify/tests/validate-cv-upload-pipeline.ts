// Direct, assertion-based verification of parse-upload.ts and
// extract-text.ts against REAL bytes (real busboy multipart parsing over a
// real raw http server, real pdf-parse/mammoth extraction) — no mocks, no
// Supabase auth or app DB involved. Exists because
// tests/validate-cv-profile-upload.ts's HTTP+auth suite can only reach
// these code paths through a real Supabase session, and this project's
// Supabase instance currently has "Confirm email" on (same blocker already
// documented in validate-paywall-auth.ts) — that suite's Test 1 (401
// without a token) still runs and passes, but everything past signup gets
// skipped there. This file exercises exactly what that gap leaves
// unverified, without touching production auth settings.
import http from "node:http";
import { AddressInfo } from "node:net";
import {
  parseSingleFileUpload,
  UploadTooLargeError,
  UploadInvalidError
} from "../src/cv/parse-upload.js";
import {
  extractTextFromUpload,
  UnsupportedFileTypeError,
  TextExtractionError,
  MAX_EXTRACTED_TEXT_CHARS,
  PDF_MIME,
  DOCX_MIME
} from "../src/cv/extract-text.js";
import { buildFictionalCvDocx, buildFictionalCvPdf, FICTIONAL_CV_LINES } from "./fixtures/build-cv-fixtures.js";

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) {
    console.log(`✅ [PASSED] ${label}`);
  } else {
    console.error(`❌ [FAILED] ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};

async function withUploadServer<T>(
  maxBytes: number,
  fn: (url: string) => Promise<T>
): Promise<T> {
  const server = http.createServer((req, res) => {
    parseSingleFileUpload(req, { maxBytes })
      .then((upload) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ mimeType: upload.mimeType, filename: upload.filename, size: upload.buffer.length }));
      })
      .catch((err) => {
        const status = err instanceof UploadTooLargeError ? 413 : err instanceof UploadInvalidError ? 400 : 500;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.constructor.name }));
      });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function main() {
  console.log(`\n==================================================`);
  console.log(`🧪 SUITE DE VALIDACIÓN — parse-upload.ts + extract-text.ts (bytes reales, sin mocks)`);
  console.log(`==================================================\n`);

  console.log(`🔍 [Grupo 1] parseSingleFileUpload sobre un servidor http real...`);

  await withUploadServer(2 * 1024 * 1024, async (url) => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("contenido de prueba")], { type: "application/pdf" }), "cv.pdf");
    const res = await fetch(url, { method: "POST", body: form });
    const body = await res.json();
    check("Upload normal responde 200", res.status === 200, `status=${res.status}`);
    check("mimeType se preserva", body.mimeType === "application/pdf", JSON.stringify(body));
    check("filename se preserva", body.filename === "cv.pdf", JSON.stringify(body));
    check("size coincide con los bytes enviados", body.size === Buffer.byteLength("contenido de prueba"), JSON.stringify(body));
  });

  await withUploadServer(1024, async (url) => {
    const oversized = Buffer.alloc(1024 * 5, 65);
    const form = new FormData();
    form.append("file", new Blob([oversized], { type: "application/pdf" }), "cv.pdf");
    const res = await fetch(url, { method: "POST", body: form });
    const body = await res.json();
    check("Archivo sobre el tope responde 413 (UploadTooLargeError)", res.status === 413 && body.error === "UploadTooLargeError", `status=${res.status} body=${JSON.stringify(body)}`);
  });

  await withUploadServer(2 * 1024 * 1024, async (url) => {
    const form = new FormData();
    form.append("not_a_file", "solo texto, sin archivo");
    const res = await fetch(url, { method: "POST", body: form });
    const body = await res.json();
    check("Sin archivo responde 400 (UploadInvalidError)", res.status === 400 && body.error === "UploadInvalidError", `status=${res.status} body=${JSON.stringify(body)}`);
  });

  console.log(`\n🔍 [Grupo 2] extractTextFromUpload sobre PDF/DOCX ficticios reales...`);

  {
    const result = await extractTextFromUpload(buildFictionalCvPdf(), PDF_MIME);
    check("PDF ficticio: truncated=false", result.truncated === false);
    check("PDF ficticio: el texto extraído contiene el contenido literal (nada inventado)", result.text.includes(FICTIONAL_CV_LINES[0]!) && result.text.includes(FICTIONAL_CV_LINES[3]!), result.text);
  }

  {
    const result = await extractTextFromUpload(buildFictionalCvDocx(), DOCX_MIME);
    check("DOCX ficticio: truncated=false", result.truncated === false);
    check("DOCX ficticio: el texto extraído contiene el contenido literal", result.text.includes(FICTIONAL_CV_LINES[0]!), result.text);
  }

  {
    const longLines = Array.from({ length: 250 }, (_, i) => `Línea de relleno número ${i} para exceder el cap de 6.000 caracteres.`);
    const result = await extractTextFromUpload(buildFictionalCvDocx(longLines), DOCX_MIME);
    check("DOCX largo: truncated=true", result.truncated === true);
    check(`DOCX largo: texto acotado a exactamente ${MAX_EXTRACTED_TEXT_CHARS} caracteres`, result.text.length === MAX_EXTRACTED_TEXT_CHARS, `len=${result.text.length}`);
  }

  {
    try {
      await extractTextFromUpload(Buffer.from("hola"), "text/plain");
      check("MIME no permitido lanza UnsupportedFileTypeError", false, "no lanzó nada");
    } catch (e) {
      check("MIME no permitido lanza UnsupportedFileTypeError", e instanceof UnsupportedFileTypeError, String(e));
    }
  }

  {
    try {
      await extractTextFromUpload(Buffer.from("esto no es un pdf real"), PDF_MIME);
      check("PDF con magic bytes inválidos lanza UnsupportedFileTypeError", false, "no lanzó nada");
    } catch (e) {
      check("PDF con magic bytes inválidos lanza UnsupportedFileTypeError", e instanceof UnsupportedFileTypeError, String(e));
    }
  }

  {
    try {
      await extractTextFromUpload(Buffer.from("esto tampoco es un docx real"), DOCX_MIME);
      check("DOCX con magic bytes inválidos lanza UnsupportedFileTypeError", false, "no lanzó nada");
    } catch (e) {
      check("DOCX con magic bytes inválidos lanza UnsupportedFileTypeError", e instanceof UnsupportedFileTypeError, String(e));
    }
  }

  {
    // PDF con magic bytes válidos pero contenido corrupto más allá de la
    // cabecera — debe fallar limpio (TextExtractionError), nunca tumbar el
    // proceso (docs/CV-GENERATION-PLAN.md §7 / BACKLOG.md, incidente OOM).
    const corrupted = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from([0, 1, 2, 3, 255, 254, 253])]);
    try {
      await extractTextFromUpload(corrupted, PDF_MIME);
      check("PDF corrupto (magic bytes ok, cuerpo inválido) lanza TextExtractionError", false, "no lanzó nada");
    } catch (e) {
      check(
        "PDF corrupto (magic bytes ok, cuerpo inválido) lanza TextExtractionError, no tumba el proceso",
        e instanceof TextExtractionError,
        String(e)
      );
    }
  }

  if (failed > 0) {
    console.error(`\n❌ [TEST SUITE FAILED] ${failed} caso(s) fallaron.`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`🎉 [TEST SUITE PASSED] Parsing de upload + extracción de texto verificados con bytes reales.`);
  console.log(`==================================================\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ [FAILED] Error inesperado en la suite:", err);
  process.exit(1);
});
