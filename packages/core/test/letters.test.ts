import { describe, expect, it } from "vitest";
import {
  formatLetter,
  letterTitle,
  letterWatermark,
  LetterClaimError,
  recheckLetterClaims,
  type LetterDraft,
} from "../src/letters/letter.js";
import type { JsonResumeProfile } from "../src/profile/schema.js";

const profile = {
  basics: {
    name: "Priya Raman",
    email: "priya@example.com",
    phone: "+91 90000 00000",
    url: "https://example.com/priya",
    summary: "Backend engineer with 8 years of experience building payment systems.",
    location: { city: "Bengaluru", region: "Karnataka", countryCode: "IN" },
  },
  work: [
    {
      company: "NimbusPay",
      position: "Senior Backend Engineer",
      startDate: "2021-01-01",
      endDate: null,
      summary: "Led the payments platform.",
      highlights: [{ text: "Cut p99 latency by 40% across 12 services." }],
    },
  ],
  education: [],
  skills: [{ name: "PostgreSQL", level: "expert", keywords: [{ keyword: "indexing" }] }],
  projects: [],
  certificates: [],
} as unknown as JsonResumeProfile;

const coverLetter: LetterDraft = {
  kind: "COVER_LETTER",
  subject: "Senior Backend Engineer at NimbusPay",
  paragraphs: [
    "I am applying for the Senior Backend Engineer role at NimbusPay.",
    "At NimbusPay I cut p99 latency by 40% across 12 services using PostgreSQL.",
  ],
  claims: ["NimbusPay", "Senior Backend Engineer", "PostgreSQL", "40%", "12 services"],
};

describe("gate 4.4: letters are always marked and never unearned", () => {
  it("marks a draft DRAFT and a mock offer SAMPLE", () => {
    expect(letterWatermark("COVER_LETTER")).toBe("DRAFT");
    expect(letterWatermark("COLD_EMAIL")).toBe("DRAFT");
    expect(letterWatermark("OFFER_REPLY")).toBe("SAMPLE");
    expect(letterTitle("OFFER_REPLY")).toBe("Offer reply");
  });

  it("writes the mark at the top and the bottom of the text", () => {
    const text = formatLetter(coverLetter);
    expect(text.split("[DRAFT]")).toHaveLength(3); // header, footer, and the split itself
    expect(text).toContain("Subject: Senior Backend Engineer at NimbusPay");
    expect(text).toContain("40%");

    const offer = formatLetter({ ...coverLetter, kind: "OFFER_REPLY" });
    expect(offer).toContain("[SAMPLE]");
    expect(offer).not.toContain("[DRAFT]");
  });

  it("accepts claims the profile can support", () => {
    const check = recheckLetterClaims(profile, coverLetter);
    expect(check.ok).toBe(true);
    expect(check.issues).toEqual([]);
    expect(check.checkedClaims).toBeGreaterThan(4);
  });

  it("rejects a named skill the profile does not have", () => {
    const check = recheckLetterClaims(profile, {
      paragraphs: ["I have deep Kubernetes experience."],
      claims: ["Kubernetes"],
    });
    expect(check.ok).toBe(false);
    expect(check.issues).toEqual([{ code: "UNKNOWN_CLAIM", value: "Kubernetes" }]);
  });

  it("rejects an invented number inside the body", () => {
    const check = recheckLetterClaims(profile, {
      paragraphs: ["I led a team of 30 engineers across four time zones."],
      claims: [],
    });
    expect(check.ok).toBe(false);
    expect(check.issues).toContainEqual({ code: "UNKNOWN_NUMBER", value: "30" });
  });

  it("rejects a claim that borrows a real company but invents the number", () => {
    const check = recheckLetterClaims(profile, {
      paragraphs: [],
      claims: ["Led 250 engineers at NimbusPay"],
    });
    expect(check.ok).toBe(false);
    expect(check.issues).toEqual([{ code: "UNKNOWN_NUMBER", value: "250" }]);
  });

  it("carries the rejected check on the error", () => {
    const check = recheckLetterClaims(profile, {
      paragraphs: [],
      claims: ["Kubernetes"],
    });
    const error = new LetterClaimError(check);
    expect(error.name).toBe("LetterClaimError");
    expect(error.check.issues).toHaveLength(1);
  });
});
