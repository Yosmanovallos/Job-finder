import {
  DomainFileError,
  DomainValidationError,
  type ValidationIssue
} from "@job-radar/domain";

export interface ValidationReport {
  ok: boolean;
  path: string;
  issues: ValidationIssue[];
}

/**
 * Runs a domain loader and turns its outcome into a printable report.
 * Issues never contain values from the validated file (it may hold PII).
 */
export function runValidation(path: string, loader: (path: string) => unknown): ValidationReport {
  try {
    loader(path);
    return { ok: true, path, issues: [] };
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return { ok: false, path, issues: error.issues };
    }
    if (error instanceof DomainFileError) {
      return {
        ok: false,
        path,
        issues: [{ path: "(file)", code: "file", message: "File not found", hint: error.hint }]
      };
    }
    throw error;
  }
}
