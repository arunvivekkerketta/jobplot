import { describe, expect, it } from "vitest";
import { assertProductionConfig, findConfigProblems } from "../src/config.js";

const strong = {
  NODE_ENV: "production",
  NEXTAUTH_SECRET: "8f3c1d9a7b2e4f60a1c5d8e9f0b3a7c2",
  // 32 bytes, and deliberately not one of the repository's placeholder keys.
  APP_ENCRYPTION_KEY: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  ADMIN_PASSWORD: "correct-horse-battery-staple",
};

describe("gate 1.7: production refuses publicly known secrets (H4)", () => {
  it("does not refuse to start outside production", () => {
    // findConfigProblems reports facts; only assertProductionConfig decides when
    // they stop a process, and it only does so in production.
    expect(() => assertProductionConfig({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertProductionConfig({ NODE_ENV: "test", NEXTAUTH_SECRET: "jobpilot" })).not.toThrow();
    expect(
      findConfigProblems({ NODE_ENV: "test", NEXTAUTH_SECRET: "jobpilot" }).map(
        (problem) => problem.name,
      ),
    ).toContain("NEXTAUTH_SECRET");
  });

  it("names every default value it refuses", () => {
    const problems = findConfigProblems({
      NODE_ENV: "production",
      NEXTAUTH_SECRET: "compose-secret-not-for-production",
      APP_ENCRYPTION_KEY: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
      ADMIN_PASSWORD: "jobpilot-admin",
    });
    expect(problems.map((problem) => problem.name).sort()).toEqual([
      "ADMIN_PASSWORD",
      "APP_ENCRYPTION_KEY",
      "NEXTAUTH_SECRET",
    ]);
    expect(problems.every((problem) => problem.problem.includes("publicly known"))).toBe(true);
  });

  it("passes with strong values", () => {
    expect(findConfigProblems(strong)).toEqual([]);
    expect(() => assertProductionConfig(strong)).not.toThrow();
  });

  it("refuses to start when ADMIN_PASSWORD is missing", () => {
    const env = { ...strong, ADMIN_PASSWORD: "" };
    expect(() => assertProductionConfig(env)).toThrow(/ADMIN_PASSWORD is not set/);
  });

  it("refuses a short NEXTAUTH_SECRET", () => {
    const env = { ...strong, NEXTAUTH_SECRET: "short" };
    expect(() => assertProductionConfig(env)).toThrow(/NEXTAUTH_SECRET is shorter than 16/);
  });
});

describe("gate 2.6: the lockout threshold is a plain rule", () => {
  it("locks at the fifth recent failure", async () => {
    const { isLoginLocked, LOGIN_FAILURE_LIMIT } = await import("../src/auth-policy.js");
    expect(LOGIN_FAILURE_LIMIT).toBe(5);
    expect(isLoginLocked(0)).toBe(false);
    expect(isLoginLocked(4)).toBe(false);
    expect(isLoginLocked(5)).toBe(true);
  });
});
