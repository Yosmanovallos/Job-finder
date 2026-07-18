import type { ZodError, ZodIssue } from "zod";

export interface ValidationIssue {
  /** Dotted path to the offending field, or "(root)". */
  path: string;
  /** Machine-readable issue code (Zod code or "file" / "yaml"). */
  code: string;
  /** Human-readable message. Never contains values read from the file. */
  message: string;
  hint?: string;
}

/**
 * Validation failed for a user-provided file. Messages describe the problem
 * by path and expected shape only — values from the file are never echoed,
 * because validated files (private/cv/facts.yaml) may contain PII.
 */
export class DomainValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(summary: string, issues: ValidationIssue[]) {
    const details = issues
      .map((issue) => {
        const hint = issue.hint ? ` (hint: ${issue.hint})` : "";
        return `  - ${issue.path}: ${issue.message}${hint}`;
      })
      .join("\n");
    super(`${summary}\n${details}`);
    this.name = "DomainValidationError";
    this.issues = issues;
  }
}

/** A required file is missing or unreadable. Carries a copy/create hint. */
export class DomainFileError extends Error {
  readonly path: string;
  readonly hint: string;

  constructor(path: string, problem: string, hint: string) {
    super(`${problem}: ${path}\nHint: ${hint}`);
    this.name = "DomainFileError";
    this.path = path;
    this.hint = hint;
  }
}

/**
 * Builds a message for a Zod issue without ever echoing the received value.
 * Zod's own messages are reused only for codes whose text is derived from
 * the schema, not from the input.
 */
function issueMessage(issue: ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return `Expected ${issue.expected}, received ${issue.received}`;
    case "invalid_enum_value":
      return `Must be one of: ${issue.options.map(String).join(" | ")}`;
    case "invalid_literal":
      return `Must be exactly ${JSON.stringify(issue.expected)}`;
    case "unrecognized_keys":
      return `Unknown key(s): ${issue.keys.join(", ")}. Remove them or fix the spelling`;
    case "invalid_union":
      return "Value does not match any of the allowed shapes";
    case "too_small":
    case "too_big":
    case "invalid_string":
    case "custom":
      return issue.message;
    default:
      return "Invalid value";
  }
}

export function fromZodError(error: ZodError, summary: string, hint?: string): DomainValidationError {
  const issues: ValidationIssue[] = error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    code: issue.code,
    message: issueMessage(issue),
    ...(hint === undefined ? {} : { hint })
  }));
  return new DomainValidationError(summary, issues);
}
