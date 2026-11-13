import { parseManualPosting } from "@jobpilot/sources";
import { afterAll, describe, expect, it } from "vitest";
import { prisma, saveJobs } from "../src/index.js";

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const startedAt = new Date();
const trackedUrl = `https://jobs.example.com/role-${stamp}?utm_source=newsletter&gh_src=abc`;
const plainUrl = `https://jobs.example.com/role-${stamp}/`;

function posting(url: string, descriptionText: string) {
  return parseManualPosting({
    title: "Backend Engineer",
    company: "NimbusPay",
    url,
    text: descriptionText,
  });
}

afterAll(async () => {
  await prisma.job.deleteMany({ where: { canonicalUrl: { contains: stamp } } });
  await prisma.auditLog.deleteMany({
    where: { action: { in: ["job.import"] }, at: { gte: startedAt } },
  });
  await prisma.$disconnect();
});

describe("gate 3.10: importing postings dedupes on the canonical URL", () => {
  it("creates once, then updates the same row for a tracking-param variant", async () => {
    const first = await saveJobs([
      posting(trackedUrl, "Build payment services in Python."),
    ]);
    expect(first).toMatchObject({ created: 1, updated: 0, total: 1 });

    const second = await saveJobs([
      posting(plainUrl, "Build payment services in Python."),
    ]);
    expect(second).toMatchObject({ created: 0, updated: 1, total: 1 });
    expect(second.ids[0]).toBe(first.ids[0]);

    const rows = await prisma.job.findMany({
      where: { canonicalUrl: { contains: stamp } },
      select: { id: true, canonicalUrl: true, url: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.canonicalUrl).toBe(`https://jobs.example.com/role-${stamp}`);
    // The newest URL wins, so the row points at what the user last saw.
    expect(rows[0]!.url).toBe(plainUrl);
  });

  it("recomputes the content hash when the posting text changes", async () => {
    const before = await prisma.job.findFirstOrThrow({
      where: { canonicalUrl: { contains: stamp } },
      select: { id: true, contentHash: true },
    });

    await saveJobs([
      posting(plainUrl, "Build payment services in Python and Go, on call weekly."),
    ]);

    const after = await prisma.job.findUniqueOrThrow({
      where: { id: before.id },
      select: { contentHash: true, descriptionText: true },
    });
    expect(after.contentHash).not.toBe(before.contentHash);
    expect(after.descriptionText).toContain("and Go");
  });

  it("keeps manual postings' untrusted copy on the row (I2)", async () => {
    const row = await prisma.job.findFirstOrThrow({
      where: { canonicalUrl: { contains: stamp } },
      select: { parsed: true, source: true },
    });
    expect(row.source).toBe("manual");
    const untrusted = (row.parsed as { untrustedDescription?: string })
      .untrustedDescription;
    expect(untrusted).toContain('label="job-description"');
    expect(untrusted).toContain("Build payment services");
  });
});

describe("gate 3.11: every import is audited", () => {
  it("writes one job.import row per batch with created/updated counts", async () => {
    await saveJobs([posting(`${plainUrl}?ref=email`, "Fresh run.")], {
      actor: "SYSTEM",
    });

    const audits = await prisma.auditLog.findMany({
      where: {
        action: "job.import",
        at: { gte: startedAt },
        payload: { path: ["sources"], array_contains: ["manual"] },
      },
      select: { actor: true, payload: true },
    });

    expect(audits.length).toBeGreaterThanOrEqual(3);
    expect(audits.some((row) => row.actor === "SYSTEM")).toBe(true);
    expect(JSON.stringify(audits.at(-1)!.payload)).toContain('"total":1');
  });
});
