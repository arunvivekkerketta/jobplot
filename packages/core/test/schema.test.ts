import { describe, it, expect } from "vitest";
import { assignMissingFids, parseMonth } from "../src/profile/schema.js";
import fixture from "../../../fixtures/sample-resume.json";

describe("assignMissingFids (gate 1.6)", () => {
  it("preserves every existing fid", () => {
    const once = assignMissingFids(fixture);
    const twice = assignMissingFids(once);
    expect(twice).toEqual(once);
  });

  it("never changes an existing fid even across re-ordering", () => {
    const once = assignMissingFids(fixture);
    const shuffled = {
      ...once,
      work: [...once.work].reverse(),
      skills: [...once.skills].reverse(),
    };
    const twice = assignMissingFids(shuffled);
    const firstIds = once.work.map((w) => w.fid).sort();
    const secondIds = twice.work.map((w) => w.fid).sort();
    expect(secondIds).toEqual(firstIds);
    expect(twice.skills.map((s) => s.fid).sort()).toEqual(
      once.skills.map((s) => s.fid).sort(),
    );
  });

  it("assigns new fids where absent and keeps them stable on re-run", () => {
    const plain = {
      basics: { name: "T", email: "t@example.com" },
      work: [
        {
          company: "C",
          position: "Dev",
          startDate: "2020-01",
          highlights: ["Did a thing"],
        },
      ],
      skills: [{ name: "Python", keywords: ["pandas"] }],
    };
    const once = assignMissingFids(plain);
    expect(once.work[0]!.fid).toMatch(/^fid_/);
    expect(once.work[0]!.highlights[0]!.fid).toMatch(/^fid_/);
    expect(once.skills[0]!.keywords[0]!.fid).toMatch(/^fid_/);
    const twice = assignMissingFids(once);
    expect(twice.work[0]!.fid).toBe(once.work[0]!.fid);
    expect(twice.work[0]!.highlights[0]!.fid).toBe(once.work[0]!.highlights[0]!.fid);
  });

  it("rejects malformed fids", () => {
    const bad = {
      basics: { name: "T", email: "t@example.com" },
      work: [{ fid: "not-a-fid", company: "C", position: "Dev", startDate: "2020-01" }],
    };
    expect(() => assignMissingFids(bad)).toThrow();
  });
});

describe("parseMonth", () => {
  it("converts YYYY-MM into an inclusive month index", () => {
    expect(parseMonth("2019-01")).toBe(2019 * 12 + 0);
    expect(parseMonth("2021-06")).toBe(2021 * 12 + 5);
  });
});
