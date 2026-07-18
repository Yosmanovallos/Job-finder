import { describe, expect, it } from "vitest";
import { loadEnv, ConfigError } from "./load-env.js";

describe("loadEnv", () => {
  it("parses a valid environment and applies defaults", () => {
    const env = loadEnv({
      DATABASE_URL: "postgres://user:pass@localhost:5432/job_radar"
    });

    expect(env.DATABASE_URL).toBe("postgres://user:pass@localhost:5432/job_radar");
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.TIMEZONE).toBe("America/Bogota");
  });

  it("accepts explicit overrides", () => {
    const env = loadEnv({
      DATABASE_URL: "postgres://user:pass@localhost:5432/job_radar",
      NODE_ENV: "production",
      LOG_LEVEL: "debug",
      TIMEZONE: "UTC"
    });

    expect(env.NODE_ENV).toBe("production");
    expect(env.LOG_LEVEL).toBe("debug");
    expect(env.TIMEZONE).toBe("UTC");
  });

  it("throws ConfigError with an actionable message when DATABASE_URL is missing", () => {
    expect(() => loadEnv({})).toThrow(ConfigError);
    try {
      loadEnv({});
      throw new Error("expected loadEnv to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).toContain("DATABASE_URL");
      expect((error as Error).message).toContain(".env.example");
    }
  });

  it("throws ConfigError when DATABASE_URL is not a valid URL", () => {
    expect(() => loadEnv({ DATABASE_URL: "not-a-url" })).toThrow(ConfigError);
  });

  it("throws ConfigError when NODE_ENV has an unsupported value", () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: "postgres://user:pass@localhost:5432/job_radar",
        NODE_ENV: "staging"
      })
    ).toThrow(ConfigError);
  });
});
