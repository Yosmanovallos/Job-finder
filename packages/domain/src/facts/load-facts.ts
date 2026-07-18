import { readYamlFile } from "../yaml/read-yaml.js";
import { fromZodError } from "../errors.js";
import { CvFactsSchema, type CvFacts } from "./facts-schema.js";

export const DEFAULT_FACTS_PATH = "private/cv/facts.yaml";

const MISSING_FACTS_HINT =
  "Create private/cv/facts.yaml using config/cv-facts.example.yaml as a template. Only include facts that are true and verifiable.";

/**
 * Loads and validates the authorized CV facts vault. Validation errors never
 * echo values from the file — it contains PII and must not leak into logs.
 */
export function loadFacts(path = DEFAULT_FACTS_PATH): CvFacts {
  const raw = readYamlFile(path, MISSING_FACTS_HINT);
  const result = CvFactsSchema.safeParse(raw);
  if (!result.success) {
    throw fromZodError(
      result.error,
      `Invalid CV facts in ${path}. Fix the following and retry:`,
      "See config/cv-facts.example.yaml for the expected structure."
    );
  }
  return result.data;
}
