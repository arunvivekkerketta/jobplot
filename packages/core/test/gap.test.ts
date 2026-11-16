import { describe, expect, it } from "vitest";
import { extractGap, suggestProjects } from "../src/gap/extract.js";
import { buildFactIndex } from "../src/profile/factIndex.js";
import { assignMissingFids } from "../src/profile/schema.js";
import sample from "../../../fixtures/sample-resume.json";

const profile = assignMissingFids(sample as never);
const index = buildFactIndex(profile);

const jobs = [
  {
    id: "job-1",
    title: "Platform Engineer",
    parsed: { keywords: ["Kubernetes", "Terraform", "Rust"] },
  },
  {
    id: "job-2",
    title: "Senior Backend Engineer",
    parsed: { keywords: ["Kubernetes", "rust", "PostgreSQL"] },
  },
  {
    id: "job-3",
    title: "Data Engineer",
    parsed: { keywords: ["Airflow", "kubernetes", "Kubernetes"] },
  },
];

describe("gate 4.3: the gap report comes from the Fact Index (I1)", () => {
  it("counts postings, not repetitions, and checks the profile", () => {
    const gap = extractGap(jobs, index);

    const kubernetes = gap.find((entry) => entry.keyword.toLowerCase() === "kubernetes");
    expect(kubernetes?.jobsMentioning).toBe(3);
    expect(kubernetes?.haveIt).toBe(true);

    const rust = gap.find((entry) => entry.keyword.toLowerCase() === "rust");
    expect(rust?.jobsMentioning).toBe(2);
    expect(rust?.haveIt).toBe(false);

    // Sorted by how many postings mention it.
    expect(gap[0]?.jobsMentioning).toBe(3);
    expect(gap.at(-1)?.jobsMentioning).toBe(1);
  });

  it("marks a skill the profile cannot prove as missing", () => {
    const gap = extractGap(
      [{ id: "j", title: "x", parsed: { keywords: ["Elixir", "Kubernetes"] } }],
      index,
    );
    expect(gap.find((entry) => entry.keyword === "Elixir")?.haveIt).toBe(false);
    expect(gap.find((entry) => entry.keyword === "Kubernetes")?.haveIt).toBe(true);
  });

  it("ignores a posting whose parsed data is not a keyword list", () => {
    const gap = extractGap(
      [
        { id: "a", title: "x", parsed: null },
        { id: "b", title: "y", parsed: { keywords: "not-an-array" } },
        { id: "c", title: "z", parsed: { keywords: ["Docker"] } },
      ],
      index,
    );
    expect(gap.map((entry) => entry.keyword)).toEqual(["Docker"]);
  });

  it("suggests a project with four to six steps for a missing skill", () => {
    const ideas = suggestProjects(["terraform"]);
    expect(ideas).toHaveLength(1);
    expect(ideas[0]?.title).toContain("Terraform");
    expect(ideas[0]?.steps.length).toBeGreaterThanOrEqual(4);
    expect(ideas[0]?.steps.length).toBeLessThanOrEqual(6);
    expect(ideas[0]?.doneWhen.length).toBeGreaterThan(10);
  });

  it("falls back to a generic idea for an unknown skill", () => {
    const ideas = suggestProjects(["Elixir"]);
    expect(ideas[0]?.title).toContain("Elixir");
    expect(ideas[0]?.skills).toEqual(["Elixir"]);
  });
});
