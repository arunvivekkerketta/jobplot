import { describe, expect, it } from "vitest";
import { buildAnswerCoverage, coverageSummary } from "../src/coverage.js";

const at = (minutesAgo: number): Date => new Date(Date.now() - minutesAgo * 60_000);

describe("the Answer Bank coverage report", () => {
  it("groups the audited stops by reason, most frequent first", () => {
    const latestStop = at(10);
    const report = buildAnswerCoverage({
      stops: [
        { code: "NEEDS_HUMAN_FIELDS", delivered: false, at: at(30) },
        { code: "NO_APPROVED_RESUME", delivered: true, at: at(20) },
        { code: "NEEDS_HUMAN_FIELDS", delivered: true, at: latestStop },
      ],
      missing: [],
      answeredKeys: [],
    });

    expect(report.totalStops).toBe(3);
    expect(report.groups.map((group) => group.code)).toEqual([
      "NEEDS_HUMAN_FIELDS",
      "NO_APPROVED_RESUME",
    ]);
    expect(report.groups[0]?.count).toBe(2);
    // The latest of the grouped stops, not the first seen.
    expect(report.groups[0]?.lastAt).toBe(latestStop.toISOString());
  });

  it("names the missing key and links to the prefilled add form", () => {
    const report = buildAnswerCoverage({
      stops: [{ code: "NEEDS_HUMAN_FIELDS", delivered: false, at: at(5) }],
      missing: [
        { key: "salary_expectation", at: at(5) },
        { key: "salary_expectation", at: at(4) },
      ],
      answeredKeys: [],
    });

    expect(report.suggestions).toHaveLength(1);
    const suggestion = report.suggestions[0];
    expect(suggestion?.key).toBe("salary_expectation");
    expect(suggestion?.count).toBe(2);
    expect(suggestion?.addHref.startsWith("/answers?key=salary_expectation&questionPattern=")).toBe(
      true,
    );
    expect(suggestion?.addHref.endsWith("#answer-form")).toBe(true);
    expect(decodeURIComponent(suggestion?.addHref ?? "")).toContain("salary|compensation");
    expect(report.unanswerable).toBe(0);
  });

  it("does not propose a key the Answer Bank already has", () => {
    const report = buildAnswerCoverage({
      stops: [{ code: "NEEDS_HUMAN_FIELDS", delivered: false, at: at(5) }],
      missing: [{ key: "salary_expectation", at: at(5) }],
      answeredKeys: ["Salary Expectation"],
    });

    expect(report.suggestions).toEqual([]);
    // The stop is still counted; it is just no longer an answer to add.
    expect(report.groups[0]?.code).toBe("NEEDS_HUMAN_FIELDS");
  });

  it("normalises the key before comparing and proposing", () => {
    const report = buildAnswerCoverage({
      stops: [],
      missing: [{ key: "  Salary-Expectation ", at: at(1) }],
      answeredKeys: [],
    });

    expect(report.suggestions[0]?.key).toBe("salary_expectation");
  });

  it("keeps a stop with no Answer Bank fix, and says where it is fixed", () => {
    const report = buildAnswerCoverage({
      stops: [
        { code: "NO_APPROVED_RESUME", delivered: true, at: at(3) },
        { code: "SOMETHING_NEW", delivered: false, at: at(2) },
      ],
      missing: [],
      answeredKeys: [],
    });

    const resume = report.groups.find((group) => group.code === "NO_APPROVED_RESUME");
    expect(resume?.href).toBe("/tailor");
    expect(resume?.note).toContain("approved resume");

    const unknown = report.groups.find((group) => group.code === "SOMETHING_NEW");
    expect(unknown?.href).toBeNull();
    expect(unknown?.note).toBe("Auto-Pilot stopped and left this application for you.");

    expect(report.unanswerable).toBe(2);
  });

  it("ignores a missing entry with no key, which no answer could have fixed", () => {
    const report = buildAnswerCoverage({
      stops: [{ code: "NEEDS_HUMAN_FIELDS", delivered: false, at: at(1) }],
      missing: [{ key: null, at: at(1) }],
      answeredKeys: [],
    });

    expect(report.suggestions).toEqual([]);
    expect(report.unanswerable).toBe(1);
  });

  it("reads as empty until a run has actually stopped", () => {
    const report = buildAnswerCoverage({ stops: [], missing: [], answeredKeys: [] });

    expect(report.totalStops).toBe(0);
    expect(coverageSummary(report)).toContain("No Auto-Pilot stops recorded yet");
    expect(coverageSummary(report)).toContain("untested");
  });

  it("summarises what there is to do", () => {
    const report = buildAnswerCoverage({
      stops: [{ code: "NEEDS_HUMAN_FIELDS", delivered: false, at: at(1) }],
      missing: [{ key: "work_auth", at: at(1) }],
      answeredKeys: [],
    });

    expect(coverageSummary(report)).toBe(
      "1 stop(s) recorded, 1 answer(s) would have prevented the answerable ones.",
    );
  });
});
