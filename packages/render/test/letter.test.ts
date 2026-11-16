import { describe, expect, it } from "vitest";
import type { LetterDraft } from "@jobpilot/core";
import { renderLetter } from "../src/letter.js";

const coverLetter: LetterDraft = {
  kind: "COVER_LETTER",
  subject: "Backend Engineer at NimbusPay",
  paragraphs: [
    "I am applying for the Backend Engineer role.",
    "I cut p99 latency by 40% at NimbusPay <script>alert(1)</script>.",
  ],
  claims: ["NimbusPay"],
};

const offerReply: LetterDraft = {
  kind: "OFFER_REPLY",
  subject: "Re: offer",
  paragraphs: ["Thank you for the offer. I would like to confirm the start date."],
  claims: [],
};

describe("gate 4.4: the renderer marks every letter (I6)", () => {
  it("renders a cover letter as DRAFT in both text and HTML", () => {
    const rendered = renderLetter(coverLetter);
    expect(rendered.watermark).toBe("DRAFT");
    expect(rendered.text).toContain("[DRAFT]");
    expect(rendered.html).toContain("letter-watermark");
    // Header, fixed overlay and footer: three visible marks, none optional.
    expect(rendered.html.split("DRAFT").length - 1).toBeGreaterThanOrEqual(3);
  });

  it("forces SAMPLE for a mock offer reply regardless of the draft's own text", () => {
    const rendered = renderLetter(offerReply);
    expect(rendered.watermark).toBe("SAMPLE");
    expect(rendered.html).toContain("[SAMPLE]");
    expect(rendered.text).toContain("[SAMPLE]");
    expect(rendered.text).not.toContain("[DRAFT]");
  });

  it("escapes the letter body instead of trusting it", () => {
    const rendered = renderLetter(coverLetter);
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
  });
});
