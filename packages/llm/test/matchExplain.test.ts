import { describe, expect, it } from "vitest";
import { assignMissingFids } from "@jobpilot/core";
import { scoreJob } from "@jobpilot/core";
import { buildMatchExplanation, candidateSummary } from "../src/matchExplain.js";

const profile = assignMissingFids({
  basics: {
    name: "Priya Sharma",
    email: "priya.sharma@example.com",
    phone: "+91 98765 43210",
    location: { city: "Bengaluru", country: "India" },
  },
  work: [
    {
      company: "NimbusPay",
      position: "Senior Backend Engineer",
      startDate: "2019-04",
      highlights: [{ text: "Built payment services" }],
    },
  ],
  skills: [{ name: "TypeScript", keywords: [{ keyword: "node" }] }],
});

const result = scoreJob(profile, {
  title: "Senior Backend Engineer",
  company: "NimbusPay",
  descriptionText: "TypeScript and Node services. 5+ years experience.",
  location: "Bengaluru, India",
  postedAt: "2026-01-10T00:00:00.000Z",
});

describe("gate 5.4: nothing identifying reaches the model (I7)", () => {
  const summary = candidateSummary(profile);
  const request = buildMatchExplanation({
    job: {
      title: "Senior Backend Engineer",
      company: "NimbusPay",
      descriptionText: "TypeScript and Node services. 5+ years experience.",
    },
    profile,
    result,
  });

  it("leaves the name, email and phone out of the summary", () => {
    expect(summary).not.toContain("Priya");
    expect(summary).not.toContain("priya.sharma@example.com");
    expect(summary).not.toContain("98765");
    expect(summary).toContain("Senior Backend Engineer");
    expect(summary).toContain("TypeScript");
  });

  it("keeps them out of the assembled prompt and wraps the posting (I2)", () => {
    expect(request.user).not.toContain("priya.sharma@example.com");
    expect(request.user).not.toContain("98765");
    expect(request.user).not.toContain("Priya");
    expect(request.user).toContain('<untrusted label="job-description">');
    expect(request.user).toContain("</untrusted>");
    expect(request.system).toContain("untrusted data");
  });

  it("supplies a deterministic fallback for every request", () => {
    expect(request.fallback).toContain(`${result.score}/100`);
  });
});