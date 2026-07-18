import { readFileSync, statSync } from "node:fs";
import { parse, YAMLError } from "yaml";
import { DomainFileError, DomainValidationError } from "../errors.js";

/** Configuration files should never be this large; protects against abuse. */
const MAX_FILE_BYTES = 1 * 1024 * 1024;

/**
 * Reads and parses a YAML file defensively. The content is always treated as
 * data: no custom tags, YAML 1.2 core schema only (so `NO` or `ES` stay
 * strings instead of becoming booleans), a low alias budget against alias
 * bombs, and a file size cap. Parse errors are reported by position only —
 * the file's content is never echoed, since it may contain PII.
 */
export function readYamlFile(path: string, missingFileHint: string): Record<string, unknown> {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return missingFile(path, missingFileHint);
  }

  if (size > MAX_FILE_BYTES) {
    throw new DomainValidationError(`File too large: ${path}`, [
      {
        path: "(root)",
        code: "file",
        message: `File is ${size} bytes; the maximum allowed is ${MAX_FILE_BYTES} bytes`,
        hint: "Configuration files should be small. Check that the path points to the intended YAML file."
      }
    ]);
  }

  const text = readFileSync(path, "utf8");

  let parsed: unknown;
  try {
    parsed = parse(text, {
      version: "1.2",
      uniqueKeys: true,
      maxAliasCount: 50
    });
  } catch (error) {
    if (error instanceof YAMLError) {
      const pos = error.linePos?.[0];
      const where = pos ? ` at line ${pos.line}, column ${pos.col}` : "";
      throw new DomainValidationError(`Invalid YAML in ${path}`, [
        {
          path: "(root)",
          code: "yaml",
          message: `YAML ${error.code}${where}`,
          hint: "Fix the YAML syntax at the indicated position."
        }
      ]);
    }
    // The yaml library throws plain errors for resource-exhaustion guards
    // (e.g. excessive alias expansion). Report them without echoing content.
    throw new DomainValidationError(`Invalid YAML in ${path}`, [
      {
        path: "(root)",
        code: "yaml",
        message: "The file could not be parsed safely (possible excessive aliasing or malformed YAML)",
        hint: "Simplify the YAML: avoid anchors/aliases and check the syntax."
      }
    ]);
  }

  if (parsed === null || parsed === undefined) {
    throw new DomainValidationError(`Empty YAML file: ${path}`, [
      {
        path: "(root)",
        code: "yaml",
        message: "The file is empty or contains no data",
        hint: missingFileHint
      }
    ]);
  }

  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DomainValidationError(`Invalid YAML root in ${path}`, [
      {
        path: "(root)",
        code: "yaml",
        message: "The top level must be a mapping (key: value), not a list or scalar",
        hint: missingFileHint
      }
    ]);
  }

  return parsed as Record<string, unknown>;
}

function missingFile(path: string, hint: string): never {
  throw new DomainFileError(path, "File not found", hint);
}
