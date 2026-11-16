import { describe, expect, it } from "vitest";
import { validateResumeDocument } from "../src/guardrails/claimValidator.js";
import { assignMissingFids } from "../src/profile/schema.js";
import { buildResumeDocument } from "../src/resume/document.js";
import duplicate from "../../../fixtures/duplicate-employer-resume.json";
import sample from "../../../fixtures/sample-resume.json";

describe("gate 2.1: a company with several roles is read as a list (H5/M2)", () => {
  it("validates a resume where one company appears twice", () => {
    const profile = assignMissingFids(duplicate as never);
    const report = validateResumeDocument(profile, buildResumeDocument(profile));
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("still accepts the single-role fixture", () => {
    const profile = assignMissingFids(sample as never);
    const report = validateResumeDocument(profile, buildResumeDocument(profile));
    expect(report.ok).toBe(true);
    expect(report.checkedClaims).toBeGreaterThan(20);
  });

  it("rejects an invented title even though the employer exists twice", () => {
    const profile = assignMissingFids(duplicate as never);
    const doc = buildResumeDocument(profile);
    doc.roles[0]!.title = "CTO";
    const report = validateResumeDocument(profile, doc);
    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain("UNKNOWN_TITLE");
  });
});
