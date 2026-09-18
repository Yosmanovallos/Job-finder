/**
 * Source-level eligibility is deliberately decided before generic JobPosting
 * checks.  A source can be user-visible while its listing model is still not
 * proven to represent an opportunity Google Jobs may publish.
 */
export type GoogleJobSourcePolicy = {
  googleJobsEligibility: "allowed" | "blocked_pending_review";
  reason?: "SOURCE_REQUIRES_JOB_CLASSIFICATION";
};

const DEFAULT_POLICY: GoogleJobSourcePolicy = { googleJobsEligibility: "allowed" };

const POLICIES: Readonly<Record<string, GoogleJobSourcePolicy>> = {
  // Workana projects can be useful to users, but client geography and project
  // budget do not establish a Google Jobs-compatible employment opportunity.
  Workana: {
    googleJobsEligibility: "blocked_pending_review",
    reason: "SOURCE_REQUIRES_JOB_CLASSIFICATION"
  }
};

export function getGoogleJobSourcePolicy(source: string | null | undefined): GoogleJobSourcePolicy {
  return source ? POLICIES[source] ?? DEFAULT_POLICY : DEFAULT_POLICY;
}
