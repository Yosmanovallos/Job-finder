import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyFetchResult, NO_COUNTERS } from "../src/sources/fetch-result.js";
import { detailFaultFor, isLinkedInLoginWall, type DetailResponseLike } from "../src/sources/detail-http.js";
import { extractJobPostingDetail } from "../src/lib/job-posting-jsonld.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/detail/${name}`, import.meta.url), "utf8");

function response(status: number, url = "https://www.linkedin.com/jobs/view/1", headers: Record<string, string> = {}): DetailResponseLike {
  return { status, url, headers: { get: (name) => headers[name.toLowerCase()] ?? null } };
}

/** What the detail stage would see if the fetcher threw this fault. */
function outcomeOf(fault: Error | null) {
  assert.ok(fault, "expected a fault");
  return classifyFetchResult(fault, NO_COUNTERS);
}

test("401, 403 and LinkedIn's 999 are blocked, not NO_DETAIL", () => {
  for (const status of [401, 403, 999]) {
    const result = outcomeOf(detailFaultFor("LinkedIn-detail", response(status)));
    assert.equal(result.outcome, "blocked", `HTTP ${status}`);
    assert.equal(result.error?.class, "FetchBlockedError");
  }
});

test("429 is rate_limited and carries Retry-After only when the source sent one", () => {
  const withHeader = outcomeOf(detailFaultFor("Computrabajo-detail", response(429, "https://x.test/", { "retry-after": "120" })));
  assert.equal(withHeader.outcome, "rate_limited");
  assert.equal(withHeader.error?.retryAfterMs, 120_000);

  const withoutHeader = outcomeOf(detailFaultFor("Computrabajo-detail", response(429, "https://x.test/")));
  assert.equal(withoutHeader.outcome, "rate_limited");
  assert.equal(withoutHeader.error?.retryAfterMs, undefined, "no header must not read as 'retry now'");
});

test("a 200 that landed on a LinkedIn sign-in wall is blocked", () => {
  const wall = response(200, "https://www.linkedin.com/authwall?trk=x");
  assert.equal(outcomeOf(detailFaultFor("LinkedIn-detail", wall)).outcome, "blocked");
  // The wall page has no JobPosting: before this change it was read as NO_DETAIL.
  assert.equal(extractJobPostingDetail(fixture("linkedin-authwall-synthetic.html")), null);
});

test("a real page, a gone page and a server error stay with the existing paths", () => {
  assert.equal(detailFaultFor("LinkedIn-detail", response(200, "https://co.linkedin.com/jobs/view/analista-1")), null);
  assert.equal(detailFaultFor("LinkedIn-detail", response(404)), null);
  assert.equal(detailFaultFor("LinkedIn-detail", response(410)), null);
  assert.equal(detailFaultFor("Computrabajo-detail", response(503, "https://x.test/")), null);
});

test("login-wall detection is limited to LinkedIn hosts and exact paths", () => {
  assert.equal(isLinkedInLoginWall("https://www.linkedin.com/login?session_redirect=x"), true);
  assert.equal(isLinkedInLoginWall("https://co.linkedin.com/checkpoint/lg/login"), true);
  assert.equal(isLinkedInLoginWall("https://www.linkedin.com/jobs/view/login-analyst-1"), false);
  assert.equal(isLinkedInLoginWall("https://example.test/authwall"), false);
  assert.equal(isLinkedInLoginWall("https://notlinkedin.com/authwall"), false);
  assert.equal(isLinkedInLoginWall("not a url"), false);
});

test("the JSON-LD parser still reads a real JobPosting unchanged", () => {
  const detail = extractJobPostingDetail(fixture("jobposting-synthetic.html"));
  assert.ok(detail?.description?.includes("Analizarás indicadores semanales"));
  assert.deepEqual(detail?.requirements, ["Manejo de SQL y hojas de cálculo", "Experiencia de un año en análisis"]);
  assert.equal(detail?.employmentType, "Tiempo completo");
});
