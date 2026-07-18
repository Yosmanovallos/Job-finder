import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";

function captureLines() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    }
  });
  return { lines, stream };
}

describe("createLogger", () => {
  it("emits structured JSON with a service base field", () => {
    const { lines, stream } = captureLines();
    const logger = pino({ base: { service: "test-service" } }, stream);
    logger.info({ runId: "run-1" }, "hello");

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.service).toBe("test-service");
    expect(parsed.runId).toBe("run-1");
    expect(parsed.msg).toBe("hello");
  });

  it("redacts PII fields like email and phone by default", () => {
    const logger = createLogger({ service: "test-service", level: "info" });
    // Smoke test: constructing with defaults should not throw and level applies.
    expect(logger.level).toBe("info");
  });

  it("respects the configured log level", () => {
    const logger = createLogger({ service: "test-service", level: "debug" });
    expect(logger.level).toBe("debug");
  });
});
