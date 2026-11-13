import { describe, expect, it } from "vitest";
import { parseAdzuna, fetchAdzuna } from "../src/adapters/adzuna.js";
import { parseAshby } from "../src/adapters/ashby.js";
import { parseGreenhouse } from "../src/adapters/greenhouse.js";
import { parseLever } from "../src/adapters/lever.js";
import { parseManualPosting } from "../src/adapters/manual.js";
import { SourceFetchError } from "../src/types.js";
import adzuna from "./fixtures/adzuna.json";
import ashby from "./fixtures/ashby.json";
import greenhouse from "./fixtures/greenhouse.json";
import lever from "./fixtures/lever.json";

describe("gate 3.4: Greenhouse adapter", () => {
  const drafts = parseGreenhouse(greenhouse, { company: "Acme" });

  it("maps every job in the board payload", () => {
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      source: "greenhouse",
      externalId: "4012345",
      company: "Acme",
      title: "Senior Backend Engineer",
      location: "Remote - Europe",
      remote: true,
    });
  });

  it("converts the HTML description and drops scripts", () => {
    const text = drafts[0]!.descriptionText;
    expect(text).toContain("Build Python services on Kubernetes");
    expect(text).toContain("Compensation: competitive & reviewed yearly.");
    expect(text).not.toContain("alert");
  });

  it("normalizes the board's timestamp to UTC ISO", () => {
    expect(drafts[0]!.postedAt).toBe(
      new Date("2026-04-02T10:15:00-04:00").toISOString(),
    );
  });

  it("rejects a payload that does not match the board contract", () => {
    expect(() => parseGreenhouse({ jobs: [{ id: 1 }] }, { company: "Acme" })).toThrow();
  });
});

describe("gate 3.5: Lever adapter", () => {
  const drafts = parseLever(lever, { company: "Acme" });

  it("maps postings, workplace type and categories", () => {
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      source: "lever",
      externalId: "8f2c1b7a-1111-4c2f-9a3e-000000000001",
      title: "Staff Software Engineer, Platform",
      location: "Remote (US)",
      remote: true,
    });
    expect(drafts[1]!.remote).toBe(false);
  });

  it("joins plain description, additional text and list sections", () => {
    const text = drafts[0]!.descriptionText;
    expect(text).toContain("Own the service mesh");
    expect(text).toContain("We sponsor visas.");
    expect(text).toContain("Scale Kubernetes clusters");
  });

  it("converts the epoch createdAt the board sends", () => {
    expect(drafts[0]!.postedAt).toBe(new Date(1712123456789).toISOString());
  });
});

describe("gate 3.6: Ashby adapter", () => {
  const drafts = parseAshby(ashby, { company: "Acme" });

  it("maps jobs and remote flags", () => {
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      source: "ashby",
      title: "Machine Learning Engineer",
      remote: true,
    });
    expect(drafts[1]!.remote).toBe(false);
  });

  it("parses the compensation summary into a salary range", () => {
    expect(drafts[0]!.salaryMin).toBe(150_000);
    expect(drafts[0]!.salaryMax).toBe(185_000);
  });

  it("prefers the plain description when the board provides one", () => {
    expect(drafts[1]!.descriptionText).toBe("Help customers integrate our API.");
  });
});

describe("gate 3.7: Adzuna adapter", () => {
  const drafts = parseAdzuna(adzuna, { query: "software engineer" });

  it("maps search results with company, location and salary", () => {
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      source: "adzuna",
      company: "NimbusPay",
      location: "Bengaluru, Karnataka",
      salaryMin: 2_400_000,
      salaryMax: 3_600_000,
    });
    expect(drafts[1]!.remote).toBe(true);
  });

  it("uses a single advertised figure as both bounds", () => {
    expect(drafts[1]!.salaryMin).toBe(1_800_000);
    expect(drafts[1]!.salaryMax).toBe(1_800_000);
  });

  it("refuses to fetch without credentials instead of silently returning nothing", async () => {
    await expect(
      fetchAdzuna({ country: "us", what: "engineer", appId: "", appKey: "" }),
    ).rejects.toMatchObject({ name: "SourceFetchError", kind: "config" });
    await expect(
      fetchAdzuna({ country: "us", what: "engineer", appId: "", appKey: "" }),
    ).rejects.toBeInstanceOf(SourceFetchError);
  });
});

describe("gate 3.8: manual posting", () => {
  const draft = parseManualPosting({
    title: "Backend Engineer",
    company: "NimbusPay",
    url: "https://nimbuspay.example/careers/backend?utm_source=email",
    html: "<p>Build payment services.</p><script>alert('x')</script>",
    location: "Remote",
  });

  it("converts pasted HTML and marks it remote from the location", () => {
    expect(draft.descriptionText).toBe("Build payment services.");
    expect(draft.remote).toBe(true);
    expect(draft.source).toBe("manual");
  });

  it("stores a delimiter-wrapped copy because the text is untrusted (I2)", () => {
    const untrusted = String(
      (draft.parsed as { untrustedDescription?: string }).untrustedDescription,
    );
    expect(untrusted).toContain("DATA NOTICE");
    expect(untrusted).toContain('<untrusted label="job-description">');
    expect(untrusted).toContain("Build payment services.");
  });
});
