import { describe, it, expect } from "vitest";
import { buildFactIndex } from "../src/profile/factIndex.js";
import { ALIAS_MAP, canonicalize } from "../src/profile/aliases.js";
import { assignMissingFids } from "../src/profile/schema.js";
import fixture from "../../../fixtures/sample-resume.json";

const overlapProfile = assignMissingFids({
  basics: { name: "Test User", email: "test@example.com" },
  work: [
    {
      company: "AlphaCorp",
      position: "Backend Engineer",
      startDate: "2019-01",
      endDate: "2021-06",
      highlights: [
        "Built ingestion services in Python processing 1.2k events per second",
      ],
    },
    {
      company: "BetaWorks",
      position: "Senior Backend Engineer",
      startDate: "2021-01",
      endDate: "2023-12",
      highlights: ["Led the Python platform team of 5 engineers"],
    },
  ],
  skills: [{ name: "Python", keywords: ["pandas"] }],
});

describe("Fact Index (gates 1.7, 1.8)", () => {
  it("counts overlapping intervals inclusively: python = 5.0 years, not 5.5", () => {
    const idx = buildFactIndex(overlapProfile);
    expect(idx.yearsOfExperience("python")).toBe(5.0);
  });

  it("returns 0 for skills with no dated facts", () => {
    const idx = buildFactIndex(overlapProfile);
    expect(idx.yearsOfExperience("rust")).toBe(0);
  });

  it("resolves aliases: hasSkill('k8s') is true when profile lists Kubernetes", () => {
    const idx = buildFactIndex(assignMissingFids(fixture));
    expect(idx.hasSkill("k8s")).toBe(true);
    expect(idx.hasSkill("Kubernetes")).toBe(true);
    expect(idx.hasSkill("postgres")).toBe(true);
  });

  it("normalizes numbers: 1,200 / 1.2k / 1200 collapse to one token", () => {
    const idx = buildFactIndex(overlapProfile);
    expect(idx.numbers.has("1200")).toBe(true);
    expect(idx.numbers.has("5")).toBe(true);
  });

  it("extracts entities through the alias map", () => {
    const idx = buildFactIndex(assignMissingFids(fixture));
    expect(idx.entities.has("nimbuspay")).toBe(true);
    expect(idx.entities.has("certified kubernetes administrator")).toBe(true);
  });

  it("has at least 150 alias entries", () => {
    expect(Object.keys(ALIAS_MAP).length).toBeGreaterThanOrEqual(150);
  });

  it("canonicalizes gcp and js", () => {
    expect(canonicalize("GCP")).toBe("google cloud");
    expect(canonicalize("js")).toBe("javascript");
  });
});
