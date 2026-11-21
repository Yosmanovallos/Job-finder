import { boundedGet } from "../../direct/http.js";
import {
  findJobIdByUrl,
  findSameJob,
  getCachedSnapshot,
  ourJobDraft,
  putCachedSnapshot
} from "../../db/resume-studio-job-repository.js";
import { readAtsPosting } from "./ats.js";
import type { ResolverDeps } from "./resolve.js";
import { safeFetchHtml } from "./safe-fetch.js";

/** Production wiring of the resolver: real database, real ATS APIs, SSRF-safe fetch. */
export function jobLinkDeps(): ResolverDeps {
  return {
    ourJobDraft,
    findJobIdByUrl,
    findSameJob,
    getCached: (key) => getCachedSnapshot(key),
    putCached: (key, snapshot) => putCachedSnapshot(key, snapshot),
    readAts: (ref) => readAtsPosting(ref, boundedGet),
    fetchHtml: (url) => safeFetchHtml(url)
  };
}
