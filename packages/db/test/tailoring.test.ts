import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assignMissingFids } from "@jobpilot/core";
import {
  approveResumeVersion,
  deleteAnswer,
  findResumeVersion,
  listAnswers,
  listResumeVersions,
  prisma,
  saveProfileWithFacts,
  saveResumeVersion,
  setResumeVersionArtifacts,
  upsertAnswer,
} from "../src/index.js";
import fixture from "../../../fixtures/sample-resume.json";

const profile = assignMissingFids(fixture);
const stamp = Date.now();
const email = `gate-6-${stamp}@jobpilot.local`;
const otherEmail = `gate-6-other-${stamp}@jobpilot.local`;

let userId = "";
let otherUserId = "";
let profileId = "";
const versionIds: string[] = [];
const answerIds: string[] = [];

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email, passwordHash: "not-a-real-hash" } });
  const other = await prisma.user.create({
    data: { email: otherEmail, passwordHash: "not-a-real-hash" },
  });
  userId = user.id;
  otherUserId = other.id;
  profileId = (await saveProfileWithFacts(userId, profile)).profileId;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: [...versionIds, ...answerIds] } } });
  await prisma.auditLog.deleteMany({ where: { entityId: profileId } });
  await prisma.resumeVersion.deleteMany({ where: { profileId } });
  await prisma.answerBankEntry.deleteMany({ where: { userId } });
  await prisma.fact.deleteMany({ where: { profileId } });
  if (userId) await prisma.profile.deleteMany({ where: { userId } });
  for (const id of [userId, otherUserId]) {
    if (id) await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

describe("gate 6.3: versions persist with their reports and audit row", () => {
  it("stores the tailored document, claim check and keyword report", async () => {
    const version = await saveResumeVersion({
      profileId,
      jobId: null,
      tailoredJson: { contact: { name: profile.basics.name, email: profile.basics.email }, roles: [] },
      validationReport: { ok: true, issues: [], checkedClaims: 12 },
      keywordReport: { initialCoverage: 80, finalCoverage: 80, trimmedHighlights: 3 },
    });
    versionIds.push(version.id);

    expect(version.approvedAt).toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: version.id, action: "resume.tailor" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actor).toBe("SYSTEM");
  });

  it("lists newest first and attaches artifacts", async () => {
    const second = await saveResumeVersion({
      profileId,
      jobId: null,
      tailoredJson: { roles: [] },
      validationReport: { ok: true },
      keywordReport: { finalCoverage: 91 },
    });
    versionIds.push(second.id);

    await setResumeVersionArtifacts(second.id, {
      pdfPath: "/api/documents/pdf-1",
      docxPath: "/api/documents/docx-1",
    });
    const stored = await findResumeVersion(second.id);
    expect(stored?.pdfPath).toBe("/api/documents/pdf-1");
    expect(stored?.docxPath).toBe("/api/documents/docx-1");

    const listed = await listResumeVersions(profileId);
    expect(listed[0]?.id).toBe(second.id);
    expect(listed.length).toBeGreaterThanOrEqual(2);
  });
});

describe("gate 6.4: approval is explicit and audited", () => {
  it("sets approvedAt once and records resume.approve", async () => {
    const id = versionIds[0]!;
    const approved = await approveResumeVersion(id);
    expect(approved.approvedAt).toBeInstanceOf(Date);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: id, action: "resume.approve" },
    });
    expect(audit?.actor).toBe("USER");

    const reread = await findResumeVersion(id);
    expect(reread?.approvedAt).not.toBeNull();
  });
});

describe("gate 6.5: Answer Bank CRUD is user-scoped and never logs the answer", () => {
  it("creates, updates in place and lists one row per key", async () => {
    const created = await upsertAnswer({
      userId,
      key: `work_auth_${stamp}`,
      answer: "Yes, I am authorised to work in the UK",
      sensitive: true,
    });
    answerIds.push(created.id);

    const updated = await upsertAnswer({
      userId,
      key: `work_auth_${stamp}`,
      answer: "Yes — no sponsorship needed",
      sensitive: true,
    });
    expect(updated.id).toBe(created.id);

    const answers = await listAnswers(userId);
    const row = answers.find((entry) => entry.key === `work_auth_${stamp}`);
    expect(row?.answer).toBe("Yes — no sponsorship needed");
    expect(answers.filter((entry) => entry.key === `work_auth_${stamp}`)).toHaveLength(1);

    const audits = await prisma.auditLog.findMany({
      where: { entityId: created.id, action: "answer.save" },
    });
    expect(audits).toHaveLength(2);
    for (const audit of audits) {
      expect(JSON.stringify(audit.payload)).not.toContain("sponsorship");
    }
  });

  it("refuses to delete another user's entry", async () => {
    const id = answerIds[0]!;
    expect(await deleteAnswer({ userId: otherUserId, id })).toBe(false);
    expect((await listAnswers(userId)).some((entry) => entry.id === id)).toBe(true);

    expect(await deleteAnswer({ userId, id })).toBe(true);
    expect((await listAnswers(userId)).some((entry) => entry.id === id)).toBe(false);
    expect(
      await prisma.auditLog.count({ where: { entityId: id, action: "answer.delete" } }),
    ).toBe(1);
  });
});