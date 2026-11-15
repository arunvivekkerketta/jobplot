import { describe, expect, it } from "vitest";
import {
  ClaimValidationError,
  assignMissingFids,
  buildResumeDocument,
  type ResumeDocument,
} from "@jobpilot/core";
import { FakeLLMClient } from "../src/fakeClient.js";
import { TAILOR_TAG, allowedFacts, buildTailoringPrompt, tailorWithClient } from "../src/tailor.js";

const profile = assignMissingFids({
  basics: { name: "Priya Sharma", email: "priya@example.com" },
  work: [
    {
      company: "NimbusPay",
      position: "Senior Backend Engineer",
      startDate: "2020-02",
      highlights: [{ text: "Built TypeScript payment services" }],
    },
  ],
  skills: [{ name: "TypeScript", keywords: [{ keyword: "node" }] }],
});

const jobDescription = "TypeScript payment services engineer needed.";

function documentWith(mutate: (doc: ResumeDocument) => void): ResumeDocument {
  const doc = buildResumeDocument(profile);
  mutate(doc);
  return doc;
}

describe("gate 6.1: an invented claim is rejected before it can be stored (I1)", () => {
  it("throws ClaimValidationError for an employer the profile does not have", async () => {
    const invented = documentWith((doc) => {
      doc.roles[0]!.company = "Google";
      doc.roles[0]!.title = "Staff Engineer";
    });
    const client = new FakeLLMClient().fixture(TAILOR_TAG, invented);

    await expect(
      tailorWithClient({ client, profile, jobDescription }),
    ).rejects.toBeInstanceOf(ClaimValidationError);
  });

  it("accepts a document that only restates the profile", async () => {
    const honest = documentWith((doc) => {
      doc.roles[0]!.highlights = ["Built TypeScript payment services"];
    });
    const client = new FakeLLMClient().fixture(TAILOR_TAG, honest);
    const result = await tailorWithClient({ client, profile, jobDescription });
    expect(result.validation.ok).toBe(true);
    expect(result.validation.checkedClaims).toBeGreaterThan(0);
    expect(client.callsFor(TAILOR_TAG)).toBe(1);
  });

  it("rejects an invented bullet even when the employer is real", async () => {
    const invented = documentWith((doc) => {
      doc.roles[0]!.highlights = ["Scaled the platform to ten million users"];
    });
    const client = new FakeLLMClient().fixture(TAILOR_TAG, invented);
    await expect(
      tailorWithClient({ client, profile, jobDescription }),
    ).rejects.toBeInstanceOf(ClaimValidationError);
  });
});

describe("gate 6.1b: the prompt hands the model a closed list of facts", () => {
  const prompt = buildTailoringPrompt({ profile, jobDescription });

  it("lists the allowed facts and the wrapped posting", () => {
    expect(prompt.user).toContain("ALLOWED FACTS");
    expect(prompt.user).toContain("bullet: Built TypeScript payment services");
    expect(prompt.user).toContain('<untrusted label="job-description">');
    expect(prompt.system).toContain("Never invent");
  });

  it("exposes only facts that exist on the profile", () => {
    const facts = allowedFacts(profile);
    expect(facts.some((fact) => fact.includes("NimbusPay"))).toBe(true);
    expect(facts.some((fact) => fact.includes("Google"))).toBe(false);
  });
});