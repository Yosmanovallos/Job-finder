import type http from "node:http";
import { Worker } from "node:worker_threads";
import {
  CV_FILE_MAX_BYTES,
  CV_PARSE_TIMEOUT_MS,
  CvFileError,
  sniffCvFile,
  type CvFileRejection,
  type CvFileText
} from "./cv-file-types.js";

// AI Resume Studio R2 — CV upload (doc 06 §5, doc 08, doc 09 T-FILE).
// The request body is read with a hard cap counted while streaming, the type
// is decided by magic bytes, and parsing happens in a worker thread with a
// heap ceiling and a 5 s kill switch. Only one parse runs at a time across
// the process; a second request is told to retry (no queue that could pile
// up memory). The file lives only in memory for the request and is never
// written anywhere.

/** Room for the multipart envelope (boundaries, part headers) on top of the file. */
const MULTIPART_OVERHEAD_BYTES = 16 * 1024;
export const CV_UPLOAD_BODY_MAX_BYTES = CV_FILE_MAX_BYTES + MULTIPART_OVERHEAD_BYTES;

export type BodyRead = { ok: true; body: Buffer } | { ok: false; code: "too_large" | "malformed" };

/**
 * Reads at most `max` bytes. The moment the stream goes over, reading stops
 * and the request is destroyed — Content-Length is never trusted.
 */
export function readBodyCapped(req: http.IncomingMessage, max: number, timeoutMs = 15_000): Promise<BodyRead> {
  return new Promise((resolve) => {
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > max) {
      req.resume();
      resolve({ ok: false, code: "too_large" });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (value: BodyRead) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.removeAllListeners("data");
      resolve(value);
    };
    const timer = setTimeout(() => {
      finish({ ok: false, code: "malformed" });
      req.destroy();
    }, timeoutMs);
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        finish({ ok: false, code: "too_large" });
        // Stop reading; the 413 is written by the caller before the socket goes.
        req.pause();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish({ ok: true, body: Buffer.concat(chunks, size) }));
    req.on("error", () => finish({ ok: false, code: "malformed" }));
    req.on("aborted", () => finish({ ok: false, code: "malformed" }));
  });
}

/** The boundary of a multipart/form-data Content-Type, or null. */
export function multipartBoundary(contentType: string | undefined): string | null {
  const value = String(contentType || "");
  if (!/^multipart\/form-data\s*;/i.test(value)) return null;
  const match = /boundary=(?:"([^"]{1,70})"|([^\s;]{1,70}))/i.exec(value);
  return match ? (match[1] ?? match[2]) : null;
}

/**
 * The single file part named `file` from a bounded multipart body. Any
 * other part is ignored; two file parts are an error. Exported for tests.
 */
export function extractFilePart(body: Buffer, boundary: string): Buffer | null {
  const delimiter = Buffer.from(`--${boundary}`);
  let found: Buffer | null = null;
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const afterDelim = start + delimiter.length;
    if (body.subarray(afterDelim, afterDelim + 2).toString("latin1") === "--") break; // closing delimiter
    const headerEnd = body.indexOf("\r\n\r\n", afterDelim);
    if (headerEnd === -1) return null;
    const headers = body.subarray(afterDelim, headerEnd).toString("latin1");
    const next = body.indexOf(Buffer.from(`\r\n--${boundary}`), headerEnd + 4);
    if (next === -1) return null;
    const disposition = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headers)?.[1] ?? "";
    if (/\bname="file"/i.test(disposition) && /\bfilename=/i.test(disposition)) {
      if (found) return null;
      found = body.subarray(headerEnd + 4, next);
    }
    start = next + 2;
  }
  return found;
}

/** Heap ceiling of the parse worker (MB). A normal CV parse uses ~16 MB. */
export const CV_WORKER_HEAP_MB = 64;

let parsing = false;

export interface ParseOptions {
  timeoutMs?: number;
  /** Heap ceiling for the worker, in MB. */
  maxHeapMb?: number;
}

/**
 * Detects the type and parses in a fresh worker. Rejects with CvFileError.
 * Never more than one at a time per process ("busy").
 */
export async function parseCvFile(bytes: Buffer, options: ParseOptions = {}): Promise<CvFileText> {
  if (bytes.length > CV_FILE_MAX_BYTES) throw new CvFileError("too_large");
  const kind = sniffCvFile(bytes);
  if (!kind) throw new CvFileError("unsupported_type");
  if (parsing) throw new CvFileError("busy");
  parsing = true;
  // A copy, so the worker owns its memory and the request buffer can go.
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  // execArgv: [] — the worker does NOT inherit tsx: Node 24 strips the
  // types itself (the worker chain uses .ts specifiers and erasable syntax
  // only). With tsx loaded the worker needed > 160 MB of heap just to
  // start; without it a parse uses ~16 MB, which matters on a 512 MB
  // Render Starter instance shared with the whole site.
  let worker: Worker;
  try {
    worker = new Worker(new URL("./cv-parse-worker.ts", import.meta.url), {
      execArgv: [],
      workerData: { kind, bytes: copy },
      transferList: [copy.buffer],
      resourceLimits: { maxOldGenerationSizeMb: options.maxHeapMb ?? CV_WORKER_HEAP_MB, maxYoungGenerationSizeMb: 16 },
      stdout: true,
      stderr: true
    });
  } catch {
    parsing = false;
    throw new CvFileError("malformed");
  }
  // The slot is freed only when the thread is really gone: a timed-out
  // worker still holds its memory until it exits.
  const exited = new Promise<void>((resolve) => worker.once("exit", () => resolve()));
  try {
    return await new Promise<CvFileText>((resolve, reject) => {
      let done = false;
      const settle = (fn: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        void worker.terminate();
        fn();
      };
      const timer = setTimeout(() => settle(() => reject(new CvFileError("timeout"))), options.timeoutMs ?? CV_PARSE_TIMEOUT_MS);
      // pdf.js warnings go to the worker's console: drop them, they can quote the file.
      worker.stdout?.resume();
      worker.stderr?.resume();
      worker.on("message", (message: { ok: boolean; result?: CvFileText; code?: CvFileRejection }) => {
        settle(() => (message.ok && message.result ? resolve(message.result) : reject(new CvFileError(message.code ?? "malformed"))));
      });
      // ERR_WORKER_OUT_OF_MEMORY lands here: the thread dies, the server doesn't.
      worker.on("error", () => settle(() => reject(new CvFileError("malformed"))));
      worker.on("exit", () => settle(() => reject(new CvFileError("malformed"))));
    });
  } finally {
    await exited;
    parsing = false;
  }
}
