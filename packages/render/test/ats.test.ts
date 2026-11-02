import { describe, expect, it } from "vitest";
import { assignMissingFids, buildResumeDocument } from "@jobpilot/core";
import fixture from "../../../fixtures/sample-resume.json";
import { lintResumeDocument } from "../src/index.js";

const document = buildResumeDocument(assignMissingFids(fixture));

describe("gate 2.4: ATS lint", () => {
  it("passes a complete resume without errors", () => {
    const report = lintResumeDocument(document);
    expect(report.ok).toBe(true);
    expect(report.score).toBeGreaterThan(0);
    expect(report.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("returns an error when the contact email is missing", () => {
    const broken = structuredClone(document);
    broken.contact.email = "";
    const report = lintResumeDocument(broken);
    expect(report.ok).toBe(false);
    expect(report.issues.map((i) => i.id)).toContain("ATS_EMAIL_MISSING");
    expect(report.score).toBeLessThan(100);
  });

  it("flags oversized bullets and missing skills", () => {
    const broken = structuredClone(document);
    broken.skills = [];
    broken.roles[0]!.highlights[0] = "x".repeat(500);
    const report = lintResumeDocument(broken);
    const ids = report.issues.map((i) => i.id);
    expect(ids).toContain("ATS_BULLET_TOO_LONG");
    expect(ids).toContain("ATS_SKILLS_MISSING");
  });

  it("reports keyword coverage against a job description", () => {
    const report = lintResumeDocument(document, {
      jobDescription:
        "We need a senior backend engineer with Kubernetes, Python and COBOL experience.",
      minKeywordCoverage: 95,
    });
    expect(report.keywordCoverage).toBeDefined();
    const coverage = report.keywordCoverage!;
    expect(coverage.matched).toContain("kubernetes");
    expect(coverage.matched).toContain("python");
    expect(coverage.missing).toContain("cobol");
    expect(coverage.coverage).toBeGreaterThan(0);
    expect(coverage.coverage).toBeLessThan(100);
    expect(report.issues.map((i) => i.id)).toContain("ATS_KEYWORD_GAP");
  });
});
