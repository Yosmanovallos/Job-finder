import { parentPort, workerData } from "node:worker_threads";
import { CvFileError, type CvFileKind } from "./cv-file-types.ts";

// Worker entry for one CV parse (doc 06 §5). The parent terminates it at
// 5 s and caps its heap, so a hostile file can only kill this thread, never
// the server. It receives bytes, posts back text or a rejection code, and
// touches no disk, network or database.

interface Input {
  kind: CvFileKind;
  bytes: Uint8Array;
}

async function run(): Promise<void> {
  const { kind, bytes } = workerData as Input;
  try {
    const result =
      kind === "pdf"
        ? await (await import("./cv-pdf.ts")).extractPdfText(bytes)
        : (await import("./cv-docx.ts")).extractDocxText(bytes);
    parentPort?.postMessage({ ok: true, result });
  } catch (error) {
    parentPort?.postMessage({ ok: false, code: error instanceof CvFileError ? error.code : "malformed" });
  }
}

void run();
