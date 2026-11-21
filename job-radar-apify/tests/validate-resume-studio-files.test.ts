import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type http from "node:http";
import test from "node:test";
import {
  CV_UPLOAD_BODY_MAX_BYTES,
  extractFilePart,
  multipartBoundary,
  parseCvFile,
  readBodyCapped
} from "../src/resume-studio/cv-file-import.js";
import { CvFileError, CV_FILE_MAX_BYTES, sniffCvFile, type CvFileRejection } from "../src/resume-studio/cv-file-types.js";
import { documentXml, makeDocx, makePdf, multipartBody, SAMPLE_CV_LINES } from "./fixtures/resume-files.js";

// AI Resume Studio R2 — T-FILE-1..8 (doc 09 §2 F1–F8, §5): every hostile
// file is rejected with a clear code, the process stays alive and its memory
// stays bounded. All files are synthetic and built in memory.

async function rejection(bytes: Buffer, options?: Parameters<typeof parseCvFile>[1]): Promise<CvFileRejection> {
  try {
    await parseCvFile(bytes, options);
  } catch (error) {
    assert.ok(error instanceof CvFileError, `expected CvFileError, got ${String(error)}`);
    return error.code;
  }
  assert.fail("the file was accepted");
}

const rssBefore = process.memoryUsage().rss;

test("RS2-FILE-OK a text PDF and a DOCX give back their text, nothing else", async () => {
  const pdf = await parseCvFile(makePdf());
  assert.equal(pdf.kind, "pdf");
  assert.equal(pdf.pages, 1);
  assert.equal(pdf.text, SAMPLE_CV_LINES.join("\n"));
  const docx = await parseCvFile(makeDocx({ pages: 2 }));
  assert.equal(docx.kind, "docx");
  assert.equal(docx.pages, 2);
  assert.equal(docx.text, SAMPLE_CV_LINES.join("\n"));
  assert.deepEqual(Object.keys(docx).sort(), ["kind", "pages", "text", "truncated"]);
});

test("T-FILE-1 an .exe renamed .pdf is rejected by its bytes, not its name", async () => {
  const exe = Buffer.concat([Buffer.from("MZ\x90\x00\x03\x00\x00\x00", "latin1"), Buffer.alloc(2048, 0x41)]);
  assert.equal(sniffCvFile(exe), null);
  assert.equal(await rejection(exe), "unsupported_type");
  // A ZIP that isn't a DOCX is not accepted either.
  assert.equal(await rejection(makeDocx({ documentXml: "x" }).subarray(0, 4)), "malformed");
});

test("T-FILE-2 an encrypted PDF is rejected", async () => {
  const encrypted = makePdf({
    extraObjects: ["20 0 obj\n<< /Filter /Standard /V 1 /R 2 /O (x) /U (y) /P -4 >>\nendobj"],
    trailerExtra: "/Encrypt 20 0 R /ID [<00> <00>]"
  });
  assert.equal(await rejection(encrypted), "encrypted");
});

test("T-FILE-3 a PDF with JavaScript is rejected, also behind #xx-escaped names", async () => {
  const js = makePdf({
    catalogExtra: "/OpenAction 20 0 R",
    extraObjects: ["20 0 obj\n<< /S /JavaScript /JS (app.alert\\(1\\)) >>\nendobj"]
  });
  assert.equal(await rejection(js), "active_content");
  const escaped = makePdf({
    catalogExtra: "/OpenAction 20 0 R",
    extraObjects: ["20 0 obj\n<< /S /J#61vaScript /J#53 (app.alert\\(1\\)) >>\nendobj"]
  });
  assert.equal(await rejection(escaped), "active_content");
  const launch = makePdf({
    catalogExtra: "/OpenAction 20 0 R",
    extraObjects: ["20 0 obj\n<< /S /Launch /F (calc.exe) >>\nendobj"]
  });
  assert.equal(await rejection(launch), "active_content");
  // A plain open *destination* (how Word sets the first view) is fine.
  const view = makePdf({ catalogExtra: "/OpenAction [4 0 R /Fit]" });
  assert.equal((await parseCvFile(view)).kind, "pdf");
});

test("T-FILE-4 a DOCX with macros, embedded objects or external relations is rejected", async () => {
  assert.equal(await rejection(makeDocx({ extra: [{ name: "word/vbaProject.bin", data: Buffer.from("macro") }] })), "macros");
  assert.equal(
    await rejection(makeDocx({ contentTypes: '<?xml version="1.0"?><Types><Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>' })),
    "macros"
  );
  assert.equal(await rejection(makeDocx({ extra: [{ name: "word/embeddings/oleObject1.bin", data: Buffer.from("ole") }] })), "embedded_objects");
  assert.equal(
    await rejection(makeDocx({ documentXml: documentXml(["a"]).replace("</w:body>", '<w:p><w:r><w:object w:dxaOrig="1"/></w:r></w:p></w:body>') })),
    "embedded_objects"
  );
  const externalTemplate =
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="http://169.254.169.254/x.dotm" TargetMode="External"/>' +
    "</Relationships>";
  assert.equal(await rejection(makeDocx({ documentRels: externalTemplate })), "external_relations");
});

test("T-FILE-5 a ZIP bomb is stopped by the declared size and by the inflate ceiling", async () => {
  const zeros = Buffer.alloc(30 * 1024 * 1024); // deflates to ~30 KB
  // Honest header: the declared size alone is over the budget.
  const honest = makeDocx({ extra: [{ name: "word/media/big.xml", data: zeros }] });
  assert.ok(honest.length < CV_FILE_MAX_BYTES, "the bomb itself is small");
  assert.equal(await rejection(honest), "zip_bomb");
  // Lying header: claims 1 KB, inflates to 30 MB — the inflater's own cap stops it.
  const liar = makeDocx({ extra: [{ name: "word/media/big.xml", data: zeros, declaredSize: 1024 }] });
  assert.equal(await rejection(liar), "zip_bomb");
  // Too many entries.
  const many = makeDocx({ extra: Array.from({ length: 250 }, (_, i) => ({ name: `word/media/x${i}.txt`, data: "x" })) });
  assert.equal(await rejection(many), "zip_bomb");
});

test("T-FILE-6 XXE in a DOCX: any DOCTYPE/ENTITY rejects the file, nothing is resolved", async () => {
  const xxe = documentXml(["&xxe;"], '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>').replace("&amp;xxe;", "&xxe;");
  assert.equal(await rejection(makeDocx({ documentXml: xxe })), "xml_entities");
  const billionLaughs = '<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><w:document/>';
  assert.equal(await rejection(makeDocx({ documentXml: billionLaughs })), "xml_entities");
});

test("T-FILE-7 a 10 MB file is refused before parsing and cut while streaming", async () => {
  const big = Buffer.concat([makePdf(), Buffer.alloc(10 * 1024 * 1024, 0x20)]);
  assert.equal(await rejection(big), "too_large");

  // The HTTP reader stops at the cap even when Content-Length lies.
  let delivered = 0;
  const chunk = Buffer.alloc(64 * 1024, 0x41);
  const stream = new Readable({
    read() {
      if (delivered >= 10 * 1024 * 1024) return this.push(null);
      delivered += chunk.length;
      this.push(chunk);
    }
  }) as unknown as http.IncomingMessage;
  (stream as { headers: Record<string, string> }).headers = { "content-length": "100" };
  const result = await readBodyCapped(stream, CV_UPLOAD_BODY_MAX_BYTES);
  assert.deepEqual(result, { ok: false, code: "too_large" });
  assert.ok(delivered < 3 * 1024 * 1024, `read ${delivered} bytes before stopping`);

  // An honest, too-large Content-Length is refused without reading.
  const declared = Readable.from([]) as unknown as http.IncomingMessage;
  (declared as { headers: Record<string, string> }).headers = { "content-length": String(10 * 1024 * 1024) };
  assert.deepEqual(await readBodyCapped(declared, CV_UPLOAD_BODY_MAX_BYTES), { ok: false, code: "too_large" });
});

test("T-FILE-8 a scanned PDF (no text layer) asks for the text instead", async () => {
  assert.equal(await rejection(makePdf({ pages: [[], []] })), "no_text");
});

test("RS2-FILE-PAGES more than 4 pages is rejected (PDF counted, DOCX when declared)", async () => {
  assert.equal(await rejection(makePdf({ pages: Array.from({ length: 5 }, () => SAMPLE_CV_LINES) })), "too_many_pages");
  assert.equal((await parseCvFile(makePdf({ pages: Array.from({ length: 4 }, () => SAMPLE_CV_LINES) }))).pages, 4);
  assert.equal(await rejection(makeDocx({ pages: 7 })), "too_many_pages");
});

test("RS2-FILE-LIMITS the 5 s kill switch, the memory ceiling and one parse at a time", async () => {
  assert.equal(await rejection(makePdf(), { timeoutMs: 1 }), "timeout");
  // A heap too small for pdf.js: the worker dies, the server process doesn't.
  assert.equal(await rejection(makePdf(), { maxHeapMb: 4 }), "malformed");
  const first = parseCvFile(makePdf());
  assert.equal(await rejection(makeDocx()), "busy");
  assert.equal((await first).kind, "pdf");
  assert.equal((await parseCvFile(makeDocx())).kind, "docx", "the slot is free again");
});

test("RS2-FILE-MULTIPART one file part, boundary from the header, other parts ignored", () => {
  const boundary = "----rs-test-boundary";
  assert.equal(multipartBoundary(`multipart/form-data; boundary=${boundary}`), boundary);
  assert.equal(multipartBoundary('multipart/form-data; boundary="quoted b"'), "quoted b");
  assert.equal(multipartBoundary("application/json"), null);
  const pdf = makePdf();
  const part = extractFilePart(multipartBody(pdf, boundary), boundary);
  assert.ok(part && part.equals(pdf));
  const withField = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\nhola\r\n`),
    multipartBody(pdf, boundary)
  ]);
  assert.ok(extractFilePart(withField, boundary)?.equals(pdf));
  const filePart = (bytes: Buffer) =>
    Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\n\r\n`), bytes, Buffer.from("\r\n")]);
  const twoFiles = Buffer.concat([filePart(pdf), filePart(pdf), Buffer.from(`--${boundary}--\r\n`)]);
  assert.equal(extractFilePart(twoFiles, boundary), null, "two files are refused");
  assert.equal(extractFilePart(Buffer.from("garbage"), boundary), null);
});

test("T-FILE the process is alive and its memory stayed bounded", () => {
  const grownMb = (process.memoryUsage().rss - rssBefore) / (1024 * 1024);
  assert.ok(grownMb < 200, `RSS grew ${grownMb.toFixed(0)} MB`);
});
