import type { CanonicalJob, Profile } from "@job-radar/domain";
import {
  normalizeTitle,
  seniorityDistance,
  seniorityFromTitle,
  skillInText,
  titleMatches
} from "./taxonomy.js";

/** Deterministic features shared by hard filters and scoring. */
export interface MatchFeatures {
  titleExcluded: boolean;
  titleTargeted: boolean;
  titleAdjacent: boolean;
  effectiveSeniority: string | null;
  seniorityDelta: number | null;
  matchedMustHave: string[];
  missingMustHave: string[];
  matchedPreferred: string[];
  missingPreferred: string[];
  matchedResponsibilities: string[];
  geo: "compatible" | "incompatible" | "unknown";
  geoReason: string;
  languagesUnmet: string[];
  employmentRejected: boolean;
  compensationBelowMinimum: boolean;
  freshnessDays: number | null;
  descriptionSufficient: boolean;
}

function jobText(job: CanonicalJob): string {
  return [
    job.titleRaw,
    job.descriptionText,
    job.requiredSkills.join(" "),
    job.preferredSkills.join(" "),
    job.responsibilities.join(" ")
  ].join("\n");
}

function geoCompatibility(profile: Profile, job: CanonicalJob): [MatchFeatures["geo"], string] {
  const countries = job.locations
    .map((location) => location.countryCode)
    .filter((code): code is string => code !== null);
  const countryOk = countries.some((code) => profile.locations.countries.includes(code));
  const cityOk = job.locations.some((location) =>
    profile.locations.cities.some((city) =>
      location.raw.toLowerCase().includes(city.toLowerCase())
    )
  );

  if (job.workMode === "remote") {
    if (profile.locations.remote_worldwide) {
      return ["compatible", "remote and profile accepts remote worldwide"];
    }
    if (countryOk || cityOk) {
      return ["compatible", "remote within an accepted country"];
    }
    if (profile.locations.remote_latam && countries.length === 0) {
      return ["unknown", "remote but region not stated; profile accepts remote LATAM"];
    }
    return ["unknown", "remote but region compatibility not stated"];
  }

  if (job.workMode === "hybrid" || job.workMode === "onsite") {
    const modeAccepted =
      job.workMode === "hybrid" ? profile.locations.hybrid : profile.locations.onsite;
    if (!modeAccepted) {
      return ["incompatible", `${job.workMode} not accepted by profile`];
    }
    if (countryOk || cityOk) {
      return ["compatible", `${job.workMode} in an accepted location`];
    }
    if (countries.length === 0 && job.locations.length === 0) {
      return ["unknown", "location not stated"];
    }
    return ["incompatible", `${job.workMode} outside accepted locations`];
  }

  return ["unknown", "work mode not stated by the source"];
}

export function computeFeatures(profile: Profile, job: CanonicalJob, now = new Date()): MatchFeatures {
  const text = jobText(job);

  const titleExcluded = profile.roles.excluded_titles.some((title) =>
    titleMatches(title, job.titleRaw)
  );
  const targeted = [...profile.roles.target_titles, ...profile.roles.title_synonyms].some(
    (title) => titleMatches(title, job.titleRaw) || titleMatches(job.titleRaw, title)
  );
  const adjacent = profile.roles.adjacent_titles.some(
    (title) => titleMatches(title, job.titleRaw) || titleMatches(job.titleRaw, title)
  );

  const effectiveSeniority =
    job.seniority !== "unknown" ? job.seniority : seniorityFromTitle(normalizeTitle(job.titleRaw));
  let seniorityDelta: number | null = null;
  if (effectiveSeniority !== null && profile.seniority.preferred.length > 0) {
    const deltas = profile.seniority.preferred
      .map((preferred) => seniorityDistance(preferred, effectiveSeniority))
      .filter((delta): delta is number => delta !== null);
    if (deltas.length > 0) {
      seniorityDelta = deltas.reduce((best, delta) =>
        Math.abs(delta) < Math.abs(best) ? delta : best
      );
    }
  }

  const matchedMustHave: string[] = [];
  const missingMustHave: string[] = [];
  for (const skill of profile.skills.must_have) {
    (skillInText(skill, text) ? matchedMustHave : missingMustHave).push(skill);
  }
  const matchedPreferred: string[] = [];
  const missingPreferred: string[] = [];
  for (const skill of [...profile.skills.strong, ...profile.skills.nice_to_have]) {
    (skillInText(skill, text) ? matchedPreferred : missingPreferred).push(skill);
  }

  const matchedResponsibilities = profile.responsibilities.preferred.filter((term) =>
    text.toLowerCase().includes(term.toLowerCase())
  );

  const [geo, geoReason] = geoCompatibility(profile, job);

  const profileLanguages = new Set(
    Object.keys(profile.languages).map((language) => language.toLowerCase())
  );
  const languagesUnmet =
    profileLanguages.size === 0
      ? []
      : job.languageRequirements.filter(
          (requirement) => !profileLanguages.has(requirement.toLowerCase())
        );

  const employmentRejected =
    job.employmentTypes.length > 0 &&
    job.employmentTypes.every((type) =>
      profile.employment.reject_types.some(
        (rejected) => type.toLowerCase().replace(/[\s_-]/g, "") === rejected.replace(/[\s_-]/g, "")
      )
    );

  const compensationBelowMinimum =
    profile.compensation.reject_if_below_minimum &&
    job.compensation.source === "explicit" &&
    job.compensation.max !== null &&
    profile.compensation.minimum_monthly !== null &&
    job.compensation.currency === profile.compensation.currency &&
    job.compensation.period === "month" &&
    job.compensation.max < profile.compensation.minimum_monthly;

  const freshnessDays =
    job.publishedAt === null
      ? null
      : Math.max(0, (now.getTime() - new Date(job.publishedAt).getTime()) / 86_400_000);

  return {
    titleExcluded,
    titleTargeted: targeted,
    titleAdjacent: adjacent,
    effectiveSeniority,
    seniorityDelta,
    matchedMustHave,
    missingMustHave,
    matchedPreferred,
    missingPreferred,
    matchedResponsibilities,
    geo,
    geoReason,
    languagesUnmet,
    employmentRejected,
    compensationBelowMinimum,
    freshnessDays,
    descriptionSufficient: job.descriptionText.length >= 300
  };
}
