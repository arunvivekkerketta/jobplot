import { describe, expect, it } from "vitest";
import { assignMissingFids } from "@jobpilot/core";
import { renderResume } from "../src/index.js";

const profile = assignMissingFids({
  basics: { name: "Priya Sharma", email: "priya@example.com" },
  work: [
    {
      company: "NimbusPay",
      position: "Backend Engineer",
      startDate: "2020-02",
      highlights: [{ text: "Built payment services" }],
    },
  ],
  skills: [{ name: "TypeScript", keywords: [{ keyword: "node" }] }],
});

describe("gate 6.6: a mock offer is always watermarked (I6)", () => {
  it("forces SAMPLE even when the caller asks for no watermark", async () => {
    const rendered = await renderResume({
      profile,
      format: "html",
      kind: "MOCK_OFFER",
      watermark: "",
    });
    expect(rendered.watermark).toBe("SAMPLE");
    expect(rendered.content.toString("utf8")).toContain("SAMPLE");
  });

  it("does not watermark an ordinary resume", async () => {
    const rendered = await renderResume({ profile, format: "html" });
    expect(rendered.watermark).toBeUndefined();
    expect(rendered.content.toString("utf8")).not.toContain("SAMPLE");
  });

  it("watermarks the PDF path too", async () => {
    const rendered = await renderResume({
      profile,
      format: "pdf",
      kind: "MOCK_OFFER",
      watermark: "hidden",
    });
    expect(rendered.watermark).toBe("SAMPLE");
    expect(rendered.content.subarray(0, 5).toString()).toBe("%PDF-");
  });
});