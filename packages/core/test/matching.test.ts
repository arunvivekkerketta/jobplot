import { describe, expect, it } from "vitest";
import { assignMissingFids } from "../src/profile/schema.js";
import {
  MATCH_WEIGHTS,
  candidateYears,
  meetsThreshold,
  scoreJob,
} from "../src/matching/score.js";
import {
  EMBEDDING_DIMS,
  cosineSimilarity,
  hashEmbedding,
  vectorLiteral,
} from "../src/matching/embedding.js";
import {
  buildMatchExplanationPrompt,
  fallbackExplanation,
} from "../src/matching/explain.js";
import type { MatchJobInput } from "../src/matching/types.js";

const profile = assignMissingFids({
  basics: {
    name: "Priya Sharma",
    email: "priya@example.com",
    phone: "+91 98765 43210",
    location: { city: "Bengaluru", region: "Karnataka", country: "India" },
  },
  work: [
    {
      company: "NimbusPay",
      position: "Senior Backend Engineer",
      startDate: "2018-01",
      highlights: [{ text: "Built payment services in TypeScript and Python" }],
    },
  ],
  skills: [
    { name: "TypeScript", keywords: [{ keyword: "typescript" }, { keyword: "node" }, { keyword: "postgresql" }] },
    { name: "Python", keywords: [{ keyword: "python" }, { keyword: "fastapi" }] },
  ],
});

const asOf = new Date("2026-01-15T00:00:00.000Z");

const strongJob: MatchJobInput = {
  title: "Senior Backend Engineer",
  company: "NimbusPay",
  descriptionText:
    "We need TypeScript, Node, PostgreSQL and Python services. 5+ years experience building payments.",
  location: "Bengaluru, India",
  remote: false,
  postedAt: "2026-01-10T00:00:00.000Z",
};

const weakJob: MatchJobInput = {
  title: "Registered Nurse",
  company: "Klinik Nord",
  descriptionText: "Patient care, clinical rotation and hospital ward experience required.",
  location: "Berlin, Germany",
  remote: false,
  postedAt: "2025-11-01T00:00:00.000Z",
};

describe("gate 5.1: the scorer is deterministic and fully broken down", () => {
  it("produces the same score for the same inputs", () => {
    const first = scoreJob(profile, strongJob, { asOf });
    const second = scoreJob(profile, strongJob, { asOf });
    expect(second).toEqual(first);
  });

  it("weights sum to 1 so the score is a true percentage", () => {
    const total =
      MATCH_WEIGHTS.skills +
      MATCH_WEIGHTS.seniority +
      MATCH_WEIGHTS.location +
      MATCH_WEIGHTS.freshness;
    expect(total).toBeCloseTo(1, 10);
  });

  it("equals its own weighted breakdown and stays an integer in 0-100", () => {
    const result = scoreJob(profile, strongJob, { asOf });
    const expected = Math.round(
      result.breakdown.skills * MATCH_WEIGHTS.skills +
        result.breakdown.seniority * MATCH_WEIGHTS.seniority +
        result.breakdown.location * MATCH_WEIGHTS.location +
        result.breakdown.freshness * MATCH_WEIGHTS.freshness,
    );
    expect(result.score).toBe(expected);
    expect(Number.isInteger(result.score)).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("ranks a real match above an unrelated posting", () => {
    const strong = scoreJob(profile, strongJob, { asOf });
    const weak = scoreJob(profile, weakJob, { asOf });
    expect(strong.score).toBeGreaterThanOrEqual(80);
    expect(weak.score).toBeLessThan(strong.score);
    expect(strong.matchedSkills).toContain("typescript");
    expect(weak.matchedSkills).toHaveLength(0);
  });

  it("partitions the required keywords into matched and missing", () => {
    const result = scoreJob(profile, strongJob, { asOf });
    expect([...result.matchedSkills, ...result.missingSkills].sort()).toEqual(
      [...result.requiredKeywords].sort(),
    );
  });

  it("derives seniority from the dates on the profile, not from a guess", () => {
    expect(candidateYears(profile, asOf)).toBeCloseTo(8.1, 1);
    const result = scoreJob(profile, strongJob, { asOf });
    expect(result.yearsRequired).toBe(5);
    expect(result.breakdown.seniority).toBe(100);
  });
});

describe("gate 5.2: the threshold gate", () => {
  it("admits a score at the threshold and rejects one below it", () => {
    expect(meetsThreshold(75, 75)).toBe(true);
    expect(meetsThreshold(80, 75)).toBe(true);
    expect(meetsThreshold(74, 75)).toBe(false);
  });
});

describe("gate 5.3: explanations never invent anything", () => {
  it("builds a prompt that carries the breakdown and the wrapped description", () => {
    const result = scoreJob(profile, strongJob, { asOf });
    const prompt = buildMatchExplanationPrompt({
      jobTitle: strongJob.title,
      company: strongJob.company,
      wrappedJobDescription:
        '<untrusted label="job-description">\npayments\n</untrusted>',
      profileSummary: "Senior Backend Engineer with TypeScript and Python.",
      result,
    });
    expect(prompt.user).toContain(`Score: ${result.score}/100`);
    expect(prompt.user).toContain('<untrusted label="job-description">');
    expect(prompt.user).toMatch(/Matched keywords: .*typescript/);
    expect(prompt.system).toContain("Never invent");
  });

  it("has a deterministic fallback that restates the numbers", () => {
    const result = scoreJob(profile, strongJob, { asOf });
    const text = fallbackExplanation(result);
    expect(text).toContain(`${result.score}/100`);
    expect(text).toContain(`seniority ${result.breakdown.seniority}`);
    expect(fallbackExplanation(result)).toBe(text);
  });
});

describe("gate 5.6: the offline embedding", () => {
  it("is deterministic, normalized and the right width", () => {
    const first = hashEmbedding("Senior TypeScript engineer building payment services");
    const second = hashEmbedding("Senior TypeScript engineer building payment services");
    expect(first).toEqual(second);
    expect(first).toHaveLength(EMBEDDING_DIMS);
    const norm = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 3);
  });

  it("scores the same text at 1 and related text above unrelated text", () => {
    const job = hashEmbedding("TypeScript PostgreSQL payment services");
    const near = hashEmbedding("TypeScript PostgreSQL services engineer");
    const far = hashEmbedding("Registered nurse clinical ward rotation");
    expect(cosineSimilarity(job, job)).toBeCloseTo(1, 5);
    expect(cosineSimilarity(job, near)).toBeGreaterThan(cosineSimilarity(job, far));
  });

  it("emits a pgvector literal", () => {
    expect(vectorLiteral([0.5, -0.25, 0])).toBe("[0.5,-0.25,0]");
  });
});