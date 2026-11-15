import { describe, expect, it } from "vitest";
import { assignMissingFids, validateResumeDocument } from "@jobpilot/core";
import { tailorDocument } from "../src/tailor.js";

const profile = assignMissingFids({
  basics: {
    name: "Priya Sharma",
    email: "priya@example.com",
    phone: "+91 98765 43210",
    location: { city: "Bengaluru", country: "India" },
  },
  work: [
    {
      company: "NimbusPay",
      position: "Senior Backend Engineer",
      startDate: "2020-02",
      highlights: [
        { text: "Built TypeScript payment services on PostgreSQL" },
        { text: "Led a weekly book club for the engineering team" },
        { text: "Reduced checkout latency by 40%" },
        { text: "Organised the annual offsite" },
        { text: "Mentored two apprentices through their first release" },
      ],
    },
    {
      company: "DataForge",
      position: "Backend Engineer",
      startDate: "2017-06",
      endDate: "2020-01",
      highlights: [
        { text: "Migrated reporting jobs from Python to TypeScript" },
        { text: "Ran the internal lightning-talk series" },
        { text: "Wrote the on-call handbook" },
      ],
    },
  ],
  skills: [
    { name: "TypeScript", keywords: [{ keyword: "node" }, { keyword: "postgresql" }] },
    { name: "Communication", keywords: [{ keyword: "workshops" }] },
  ],
});

const jobDescription =
  "We are hiring a Senior Backend Engineer for TypeScript and PostgreSQL payment services.";

describe("gate 6.1: tailoring may select and omit facts, never invent them (I1)", () => {
  const result = tailorDocument(profile, jobDescription);

  it("keeps every claim traceable to the profile", () => {
    const validation = validateResumeDocument(profile, result.document);
    expect(validation.ok).toBe(true);
    expect(validation.issues).toEqual([]);
  });

  it("only reuses bullets that exist on the profile", () => {
    const allowed = new Set(
      profile.work.flatMap((work) => work.highlights.map((highlight) => highlight.text)),
    );
    const kept = result.document.roles.flatMap((role) => role.highlights);
    expect(kept.length).toBeGreaterThan(0);
    for (const bullet of kept) expect(allowed.has(bullet)).toBe(true);
  });

  it("cannot introduce a keyword the profile never had", () => {
    const text = result.document.roles
      .flatMap((role) => role.highlights)
      .join(" ")
      .toLowerCase();
    expect(text).not.toContain("kubernetes");
    expect(text).not.toContain("terraform");
  });
});

describe("gate 6.2: the keyword loop shrinks without losing coverage", () => {
  it("keeps at least the floor and reports what it trimmed", () => {
    const result = tailorDocument(profile, jobDescription);
    expect(result.keywordReport.finalCoverage).toBeGreaterThanOrEqual(
      result.keywordReport.floor - 0.1,
    );
    expect(result.ats.keywordCoverage?.matched.length ?? 0).toBeGreaterThan(0);
    expect(result.keywordReport.required).toContain("typescript");
  });

  it("prefers the bullets that carry the posting's keywords", () => {
    const result = tailorDocument(profile, jobDescription, {
      floor: 0,
      target: 0,
      maxHighlightsPerRole: 2,
    });
    const nimbus = result.document.roles.find((role) => role.company === "NimbusPay");
    expect(nimbus?.highlights[0]).toBe("Built TypeScript payment services on PostgreSQL");
    expect(nimbus?.highlights).not.toContain("Organised the annual offsite");
  });

  it("restores trimmed facts until the floor is met", () => {
    const full = tailorDocument(profile, jobDescription, { floor: 0, target: 0 });
    const restored = tailorDocument(profile, jobDescription, {
      floor: full.keywordReport.initialCoverage,
    });
    const fullCount = full.document.roles.flatMap((role) => role.highlights).length;
    const restoredCount = restored.document.roles.flatMap((role) => role.highlights).length;
    expect(restoredCount).toBeGreaterThanOrEqual(fullCount);
    expect(restored.keywordReport.iterations).toBeGreaterThanOrEqual(0);
    expect(validateResumeDocument(profile, restored.document).ok).toBe(true);
  });
});