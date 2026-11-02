import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assignMissingFids,
  buildFactIndex,
  type JsonResumeProfile,
} from "@jobpilot/core";
import { buildFactRows, prisma, saveProfileWithFacts } from "../src/index.js";
import fixture from "../../../fixtures/sample-resume.json";

const profile = assignMissingFids(fixture);
const email = `gate-1-10-${Date.now()}@jobpilot.local`;
let userId = "";
let profileId = "";

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email, passwordHash: "not-a-real-hash" },
  });
  userId = user.id;
});

afterAll(async () => {
  if (profileId) {
    await prisma.auditLog.deleteMany({ where: { entityId: profileId } });
  }
  if (userId) {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

describe("gate 1.10: fact persistence", () => {
  it("writes exactly one Fact row per Fact Index fact", async () => {
    const saved = await saveProfileWithFacts(userId, profile);
    profileId = saved.profileId;

    const index = buildFactIndex(profile);
    expect(saved.factCount).toBe(index.facts.length);
    expect(buildFactRows(profile)).toHaveLength(index.facts.length);

    const storedFids = await prisma.fact.findMany({
      where: { profileId },
      select: { fid: true },
    });
    expect(storedFids).toHaveLength(index.facts.length);
    expect(new Set(storedFids.map((f) => f.fid)).size).toBe(index.facts.length);
  });

  it("rolls back profile, facts and audit row when the transaction fails", async () => {
    const before = await prisma.profile.findUniqueOrThrow({ where: { userId } });
    const beforeFacts = await prisma.fact.count({ where: { profileId } });
    const beforeAudit = await prisma.auditLog.count({
      where: { entityId: profileId },
    });

    const broken = structuredClone(profile) as JsonResumeProfile;
    const highlights = broken.work[0]!.highlights;
    expect(highlights.length).toBeGreaterThan(1);
    // A repeated fid violates @@unique([profileId, fid]) after the profile
    // update and the fact delete have already run inside the transaction.
    highlights[1]!.fid = highlights[0]!.fid;

    await expect(saveProfileWithFacts(userId, broken)).rejects.toThrow();

    const after = await prisma.profile.findUniqueOrThrow({ where: { userId } });
    expect(after.version).toBe(before.version);
    expect(after.jsonResume).toEqual(before.jsonResume);
    expect(await prisma.fact.count({ where: { profileId } })).toBe(beforeFacts);
    expect(
      await prisma.auditLog.count({ where: { entityId: profileId } }),
    ).toBe(beforeAudit);
  });
});
