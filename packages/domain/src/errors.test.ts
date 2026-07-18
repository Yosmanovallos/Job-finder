import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fromZodError } from "./errors.js";

describe("fromZodError", () => {
  it("formats path, message and hint per issue", () => {
    const schema = z.object({ a: z.object({ b: z.number() }) });
    const result = schema.safeParse({ a: { b: "nope" } });
    if (result.success) throw new Error("expected failure");
    const error = fromZodError(result.error, "Invalid file:", "Check the example.");
    expect(error.issues).toEqual([
      {
        path: "a.b",
        code: "invalid_type",
        message: "Expected number, received string",
        hint: "Check the example."
      }
    ]);
    expect(error.message).toContain("  - a.b: Expected number, received string");
  });

  it("never includes the received value for enum mismatches", () => {
    const schema = z.object({ level: z.enum(["A1", "A2"]) });
    const result = schema.safeParse({ level: "top-secret-value" });
    if (result.success) throw new Error("expected failure");
    const error = fromZodError(result.error, "Invalid:");
    expect(error.message).toContain("Must be one of: A1 | A2");
    expect(error.message).not.toContain("top-secret-value");
  });

  it("lists unknown keys from strict objects", () => {
    const schema = z.object({ known: z.string().optional() }).strict();
    const result = schema.safeParse({ knwon: "typo" });
    if (result.success) throw new Error("expected failure");
    const error = fromZodError(result.error, "Invalid:");
    expect(error.message).toContain("Unknown key(s): knwon");
  });
});
