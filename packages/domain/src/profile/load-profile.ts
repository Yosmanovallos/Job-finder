import { readYamlFile } from "../yaml/read-yaml.js";
import { fromZodError } from "../errors.js";
import { ProfileSchema, type Profile } from "./profile-schema.js";

export const DEFAULT_PROFILE_PATH = "config/profile.local.yaml";

const MISSING_PROFILE_HINT =
  "Copy config/profile.example.yaml to config/profile.local.yaml and edit it with your search preferences.";

/**
 * Loads and validates a search profile from a YAML file. The cv.* paths in
 * the result are opaque strings — this function never touches private/**.
 */
export function loadProfile(path = DEFAULT_PROFILE_PATH): Profile {
  const raw = readYamlFile(path, MISSING_PROFILE_HINT);
  const result = ProfileSchema.safeParse(raw);
  if (!result.success) {
    throw fromZodError(
      result.error,
      `Invalid profile in ${path}. Fix the following and retry:`,
      "See config/profile.example.yaml for the expected structure."
    );
  }
  return result.data;
}
