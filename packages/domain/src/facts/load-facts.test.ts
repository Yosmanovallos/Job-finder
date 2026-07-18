import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DomainFileError, DomainValidationError } from "../errors.js";
import { loadFacts } from "./load-facts.js";

const dir = mkdtempSync(join(tmpdir(), "load-facts-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("loadFacts", () => {
  it("suggests the template when the facts file is missing", () => {
    const attempt = () => loadFacts(join(dir, "nope.yaml"));
    expect(attempt).toThrow(DomainFileError);
    expect(attempt).toThrow(/cv-facts\.example\.yaml/);
  });

  it("never echoes PII values from the file in validation errors", () => {
    const path = join(dir, "facts.yaml");
    writeFileSync(
      path,
      [
        "experience:",
        "  - id: experience_001",
        '    company: "Ultra Secret Corp"',
        '    title: "Cargo real"',
        '    start_date: "2023-13"'
      ].join("\n"),
      "utf8"
    );
    let message = "";
    try {
      loadFacts(path);
    } catch (error) {
      expect(error).toBeInstanceOf(DomainValidationError);
      message = (error as Error).message;
    }
    expect(message).toContain("experience.0.start_date");
    expect(message).not.toContain("Ultra Secret Corp");
    expect(message).not.toContain("2023-13");
  });

  it("loads a valid facts file", () => {
    const path = join(dir, "valid.yaml");
    writeFileSync(
      path,
      [
        "experience:",
        "  - id: experience_001",
        '    company: "Empresa"',
        '    title: "Cargo"',
        '    start_date: "2023-01"',
        "skills:",
        "  - id: skill_sql",
        "    name: SQL",
        "    evidence: [experience_001]"
      ].join("\n"),
      "utf8"
    );
    const facts = loadFacts(path);
    expect(facts.skills[0]?.evidence).toEqual(["experience_001"]);
  });
});
