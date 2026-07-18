import { describe, expect, it } from "vitest";
import { CvFactsSchema } from "./facts-schema.js";

function validFacts(): Record<string, unknown> {
  return {
    experience: [
      {
        id: "experience_001",
        company: "Empresa real",
        title: "Cargo real",
        start_date: "2023-01",
        end_date: "2025-06",
        responsibilities: ["Responsabilidad real"],
        achievements: [
          { id: "achievement_001", statement: "Logro real y verificable", metric: "20%" }
        ]
      }
    ],
    skills: [{ id: "skill_sql", name: "SQL", evidence: ["experience_001"] }],
    education: [
      { id: "education_001", institution: "Institución real", program: "Programa real" }
    ],
    languages: [
      { language: "Spanish", level: "native" },
      { language: "English", level: "B2" }
    ]
  };
}

describe("CvFactsSchema", () => {
  it("accepts the guide's facts example", () => {
    const facts = CvFactsSchema.parse(validFacts());
    expect(facts.experience[0]?.id).toBe("experience_001");
    expect(facts.certifications).toEqual([]);
    expect(facts.constraints).toEqual([]);
  });

  it("accepts an empty vault — absence of facts is valid, never invented", () => {
    const facts = CvFactsSchema.parse({});
    expect(facts.experience).toEqual([]);
    expect(facts.skills).toEqual([]);
  });

  it("treats null end_date as a current position", () => {
    const raw = validFacts();
    (raw.experience as { end_date: string | null }[])[0]!.end_date = null;
    expect(CvFactsSchema.parse(raw).experience[0]?.end_date).toBeNull();
  });

  it("rejects skill evidence pointing to a nonexistent entry", () => {
    const raw = validFacts();
    raw.skills = [{ id: "skill_x", name: "X", evidence: ["experience_999"] }];
    const result = CvFactsSchema.safeParse(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["skills", 0, "evidence", 0]);
      expect(result.error.issues[0]?.message).toContain("experience_999");
    }
  });

  it("rejects a skill using itself as evidence", () => {
    const raw = validFacts();
    raw.skills = [{ id: "skill_x", name: "X", evidence: ["skill_x"] }];
    expect(CvFactsSchema.safeParse(raw).success).toBe(false);
  });

  it("rejects duplicate ids across sections", () => {
    const raw = validFacts();
    raw.education = [
      { id: "experience_001", institution: "Otra", program: "Programa" }
    ];
    const result = CvFactsSchema.safeParse(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("Duplicate id");
    }
  });

  it("rejects malformed dates and end before start", () => {
    const bad = validFacts();
    (bad.experience as { start_date: string }[])[0]!.start_date = "01/2023";
    expect(CvFactsSchema.safeParse(bad).success).toBe(false);

    const inverted = validFacts();
    (inverted.experience as { start_date: string; end_date: string }[])[0]!.start_date = "2026-01";
    expect(CvFactsSchema.safeParse(inverted).success).toBe(false);
  });

  it("rejects unknown keys so typos never silently drop facts", () => {
    const raw = validFacts();
    raw.experiences = raw.experience;
    expect(CvFactsSchema.safeParse(raw).success).toBe(false);
  });
});
