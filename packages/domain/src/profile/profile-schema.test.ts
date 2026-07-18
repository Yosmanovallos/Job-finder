import { describe, expect, it } from "vitest";
import { ProfileSchema } from "./profile-schema.js";

function minimalProfile(): Record<string, unknown> {
  return {
    roles: { target_titles: ["Data Analyst"] }
  };
}

describe("ProfileSchema", () => {
  it("accepts a minimal profile and fills documented defaults", () => {
    const result = ProfileSchema.parse(minimalProfile());
    expect(result.profile_id).toBe("default");
    expect(result.timezone).toBe("America/Bogota");
    expect(result.application_policy.auto_apply).toBe(false);
    expect(result.search.max_age_days).toBe(30);
    expect(result.cv.facts_path).toBe("private/cv/facts.yaml");
  });

  it("accepts the guide's minimal user profile shape", () => {
    const result = ProfileSchema.parse({
      roles: {
        target_titles: ["Tu cargo principal", "Otro cargo objetivo"],
        title_synonyms: ["Nombre alternativo del cargo"],
        adjacent_titles: ["Cargo relacionado"],
        excluded_titles: ["Cargos que no quieres"]
      },
      seniority: { preferred: ["junior", "mid"] },
      skills: {
        must_have: ["Skill obligatoria"],
        strong: ["Skill fuerte 1", "Skill fuerte 2"],
        nice_to_have: ["Skill que deseas desarrollar"]
      },
      locations: {
        countries: ["CO"],
        cities: ["Bogota"],
        remote_worldwide: true,
        remote_latam: true,
        hybrid: true,
        onsite: false
      },
      languages: { Spanish: "native", English: "B2" }
    });
    expect(result.languages).toEqual({ Spanish: "native", English: "B2" });
  });

  it("requires at least one target title", () => {
    const result = ProfileSchema.safeParse({ roles: { target_titles: [] } });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys with the offending key name", () => {
    const profile = minimalProfile();
    profile.identity = { display_name: "X", email: "someone@example.com" };
    const result = ProfileSchema.safeParse(profile);
    expect(result.success).toBe(false);
    if (!result.success) {
      const unrecognized = result.error.issues.find((i) => i.code === "unrecognized_keys");
      expect(unrecognized?.path).toEqual(["identity"]);
    }
  });

  it("rejects auto_apply: true with the policy explanation", () => {
    const profile = minimalProfile();
    profile.application_policy = { auto_apply: true };
    const result = ProfileSchema.safeParse(profile);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("prohibited"))).toBe(true);
    }
  });

  it("rejects lowercase or invalid country codes", () => {
    const profile = minimalProfile();
    profile.locations = { countries: ["co"] };
    expect(ProfileSchema.safeParse(profile).success).toBe(false);
  });

  it("rejects preferred_age_days greater than max_age_days", () => {
    const profile = minimalProfile();
    profile.search = { max_age_days: 7, preferred_age_days: 30 };
    const result = ProfileSchema.safeParse(profile);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["search", "preferred_age_days"]);
    }
  });

  it("rejects years_experience_min greater than max", () => {
    const profile = minimalProfile();
    profile.seniority = { years_experience_min: 6, years_experience_max: 2 };
    expect(ProfileSchema.safeParse(profile).success).toBe(false);
  });

  it("rejects invalid language levels", () => {
    const profile = minimalProfile();
    profile.languages = { English: "fluent-ish" };
    expect(ProfileSchema.safeParse(profile).success).toBe(false);
  });
});
