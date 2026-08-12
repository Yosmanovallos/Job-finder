import type http from "http";
import busboy from "busboy";

/**
 * Single-file multipart parsing for the CV upload endpoint
 * (docs/CV-GENERATION-PLAN.md §7). The size cap is enforced by busboy
 * DURING the stream (`limits.fileSize`), not by checking `Content-Length`
 * afterwards — a spoofed/missing header must never let an oversized body
 * be buffered in memory before rejection.
 *
 * On a size-limit hit we do NOT destroy `req` — an earlier version did,
 * and it killed the socket before the 413 response could ever reach the
 * client (verified with a real oversized upload: the client saw a raw
 * connection reset, "other side closed", instead of a clean error).
 * Instead we just stop collecting chunks and let busboy finish consuming
 * (and discarding) the rest of the truncated stream on its own — the
 * promise only settles once busboy reaches `finish`, so the caller always
 * gets a normal HTTP response to send.
 */

export class UploadTooLargeError extends Error {}
export class UploadInvalidError extends Error {}

export interface ParsedUpload {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

export function parseSingleFileUpload(
  req: http.IncomingMessage,
  opts: { maxBytes: number }
): Promise<ParsedUpload> {
  return new Promise((resolve, reject) => {
    let bb: ReturnType<typeof busboy>;
    try {
      bb = busboy({
        headers: req.headers,
        limits: { fileSize: opts.maxBytes, files: 1, fields: 0 }
      });
    } catch {
      reject(new UploadInvalidError("Solicitud multipart inválida."));
      return;
    }

    let settled = false;
    let gotFile = false;
    let sizeExceeded = false;
    let result: ParsedUpload | undefined;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    bb.on("file", (_name, stream, info) => {
      gotFile = true;
      const chunks: Buffer[] = [];

      stream.on("limit", () => {
        sizeExceeded = true;
      });

      stream.on("data", (chunk: Buffer) => {
        if (!sizeExceeded) chunks.push(chunk);
      });

      stream.on("end", () => {
        if (sizeExceeded) return;
        result = { buffer: Buffer.concat(chunks), mimeType: info.mimeType, filename: info.filename };
      });
    });

    bb.on("error", (err) => {
      settle(() => reject(err instanceof Error ? err : new UploadInvalidError(String(err))));
    });

    bb.on("finish", () => {
      settle(() => {
        if (sizeExceeded) {
          reject(new UploadTooLargeError(`El archivo supera el máximo de ${opts.maxBytes} bytes.`));
        } else if (!gotFile || !result) {
          reject(new UploadInvalidError("No se recibió ningún archivo."));
        } else {
          resolve(result);
        }
      });
    });

    // A client that disconnects mid-upload must not leave this promise
    // pending forever — 'close' fires whether the stream ended cleanly or
    // not, so this only actually rejects if nothing else has settled yet.
    req.on("close", () => {
      settle(() => reject(new UploadInvalidError("Conexión cerrada antes de completar la subida.")));
    });

    req.pipe(bb);
  });
}
