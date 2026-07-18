import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DomainFileError, DomainValidationError } from "../errors.js";
import { readYamlFile } from "./read-yaml.js";

const dir = mkdtempSync(join(tmpdir(), "read-yaml-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function writeTemp(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, "utf8");
  return path;
}

const HINT = "Copy the example file.";

describe("readYamlFile", () => {
  it("parses a plain mapping", () => {
    const path = writeTemp("ok.yaml", "roles:\n  target_titles:\n    - Data Analyst\n");
    expect(readYamlFile(path, HINT)).toEqual({
      roles: { target_titles: ["Data Analyst"] }
    });
  });

  it("throws DomainFileError with the hint when the file is missing", () => {
    const attempt = () => readYamlFile(join(dir, "missing.yaml"), HINT);
    expect(attempt).toThrow(DomainFileError);
    expect(attempt).toThrow(HINT);
  });

  it("keeps YAML 1.1 boolean-like country codes as strings (NO, ES)", () => {
    const path = writeTemp("countries.yaml", "countries: [NO, ES, CO]\n");
    expect(readYamlFile(path, HINT)).toEqual({ countries: ["NO", "ES", "CO"] });
  });

  it("rejects an alias bomb without hanging", () => {
    const bomb = [
      "a: &a [x, x, x, x, x, x, x, x, x, x]",
      "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]",
      "c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]",
      "d: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]",
      "e: [*d, *d, *d, *d, *d, *d, *d, *d, *d, *d]"
    ].join("\n");
    const path = writeTemp("bomb.yaml", bomb);
    expect(() => readYamlFile(path, HINT)).toThrow(DomainValidationError);
  });

  it("rejects files over the size cap", () => {
    const path = writeTemp("big.yaml", `key: "${"x".repeat(1024 * 1024 + 32)}"\n`);
    expect(() => readYamlFile(path, HINT)).toThrow(/maximum allowed/);
  });

  it("rejects duplicate keys", () => {
    const path = writeTemp("dup.yaml", "a: 1\na: 2\n");
    expect(() => readYamlFile(path, HINT)).toThrow(DomainValidationError);
  });

  it("rejects a non-mapping root", () => {
    const path = writeTemp("list.yaml", "- just\n- a list\n");
    expect(() => readYamlFile(path, HINT)).toThrow(/must be a mapping/);
  });

  it("rejects an empty file with the hint", () => {
    const path = writeTemp("empty.yaml", "");
    expect(() => readYamlFile(path, HINT)).toThrow(DomainValidationError);
  });

  it("does not echo file content in syntax error messages", () => {
    const path = writeTemp("broken.yaml", 'secret_token_abc123: "unterminated\nnext: 1\n');
    let message = "";
    try {
      readYamlFile(path, HINT);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("secret_token_abc123");
    expect(message).not.toContain("unterminated");
  });

  it("does not pollute Object.prototype via __proto__ keys", () => {
    const path = writeTemp("proto.yaml", "__proto__:\n  polluted: yes-it-is\n");
    const parsed = readYamlFile(path, HINT);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(parsed)).not.toHaveProperty("polluted");
  });
});
