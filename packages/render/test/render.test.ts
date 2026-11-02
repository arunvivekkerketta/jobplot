import { describe, expect, it } from "vitest";
import {
  assignMissingFids,
  buildResumeDocument,
  ClaimValidationError,
} from "@jobpilot/core";
import fixture from "../../../fixtures/sample-resume.json";
import { renderResume, renderResumeHtml } from "../src/index.js";

const profile = assignMissingFids(fixture);
const document = buildResumeDocument(profile);

describe("gate 2.1: HTML render", () => {
  it("renders a standalone single-column document with the profile text", () => {
    const html = renderResumeHtml(document);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain(profile.basics.name);
    expect(html).toContain("Experience");
    expect(html).toContain("Education");
    expect(html).toContain("Skills");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("<img");
    // No external assets: only inline CSS.
    expect(html).not.toMatch(/<(script|link)[^>]+(src|href)=/i);
  });

  it("escapes profile text instead of emitting markup", () => {
    const xss = assignMissingFids({
      basics: { name: "Eve <script>alert(1)</script>", email: "eve@example.com" },
      work: [
        {
          company: "Acme & Sons <b>",
          position: "Engineer",
          startDate: "2020-01",
          highlights: ["Shipped <img src=x onerror=alert(1)>"],
        },
      ],
    });
    const html = renderResumeHtml(buildResumeDocument(xss));
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("Acme &amp; Sons &lt;b&gt;");
    expect(html).not.toContain("<img src=x");
  });

  it("bakes the I6 SAMPLE watermark into the markup", () => {
    const html = renderResumeHtml(document, { watermark: "SAMPLE" });
    expect(html).toContain('class="watermark"');
    expect(html).toContain("SAMPLE");
  });
});

describe("gate 2.5: claim guardrail (I1)", () => {
  it("accepts a verbatim projection of the profile", async () => {
    const result = await renderResume({ profile, format: "html" });
    expect(result.validation.ok).toBe(true);
    expect(result.validation.checkedClaims).toBeGreaterThan(20);
  });

  it("rejects a document that invents an employer", async () => {
    const tampered = structuredClone(document) as typeof document;
    tampered.roles[0]!.company = "Globex Corporation";
    await expect(
      renderResume({ profile, format: "html", document: tampered }),
    ).rejects.toBeInstanceOf(ClaimValidationError);

    try {
      await renderResume({ profile, format: "html", document: tampered });
    } catch (error) {
      const report = (error as ClaimValidationError).report;
      expect(report.ok).toBe(false);
      expect(report.issues.map((i) => i.code)).toContain("UNKNOWN_EMPLOYER");
    }
  });

  it("rejects an invented number-bearing bullet", async () => {
    const tampered = structuredClone(document) as typeof document;
    tampered.roles[0]!.highlights[0] = "Cut infrastructure spend 90% at Globex";
    await expect(
      renderResume({ profile, format: "pdf", document: tampered }),
    ).rejects.toBeInstanceOf(ClaimValidationError);
  });
});

describe("gate 2.6: MOCK_OFFER watermark (I6)", () => {
  it("forces SAMPLE even when the caller passes nothing", async () => {
    const result = await renderResume({
      profile,
      format: "html",
      kind: "MOCK_OFFER",
    });
    expect(result.watermark).toBe("SAMPLE");
    expect(result.content.toString("utf8")).toContain("SAMPLE");
  });
});

describe("gate 2.2/2.3: PDF and DOCX output", () => {
  it("produces a real PDF buffer", async () => {
    const result = await renderResume({ profile, format: "pdf" });
    expect(result.contentType).toBe("application/pdf");
    expect(result.content.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    expect(result.content.length).toBeGreaterThan(1500);
  });

  it("produces a real DOCX (OOXML zip) buffer", async () => {
    const result = await renderResume({ profile, format: "docx" });
    expect(result.extension).toBe("docx");
    expect(result.content.subarray(0, 2).toString("utf8")).toBe("PK");
    expect(result.content.length).toBeGreaterThan(1500);
  });
});
