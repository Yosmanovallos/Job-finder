import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { checkDbStatus } from "./db-status.js";

function silentLogger() {
  const sink = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    }
  });
  return pino(sink);
}

describe("checkDbStatus", () => {
  it("reports ok:false with a detail message for an unreachable database", async () => {
    const result = await checkDbStatus(
      "postgres://user:pass@127.0.0.1:59999/does-not-exist",
      silentLogger()
    );

    expect(result.ok).toBe(false);
    expect(result.detail).toBeTruthy();
  }, 10_000);
});
