import { afterAll, describe, expect, it, vi } from "vitest";
import {
  CLAIM_STALE_MS,
  claimApplication,
  createApplication,
  findApplicationForUser,
  listAnswers,
  prisma,
  recordApplicationResult,
  releaseApplication,
  releaseStaleApplicationClaims,
  upsertAnswer,
} from "../src/index.js";

// These cases hit a local Postgres, which regularly takes longer than the 5s
// default on this machine.
vi.setConfig({ testTimeout: 30_000 });

const stamp = `claim-${Date.now()}`;
const email = `${stamp}@jobpilot.test`;
let jobCounter = 0;
let userId = "";

async function makeJob(): Promise<{ id: string }> {
  jobCounter += 1;
  const suffix = String(jobCounter);
  return prisma.job.create({
    data: {
      source: "manual",
      url: `https://jobs.example/${stamp}/${suffix}`,
      canonicalUrl: `https://jobs.example/${stamp}/${suffix}`,
      company: "Acme",
      title: `Backend Engineer ${suffix}`,
      descriptionText: "Backend role",
      contentHash: `${stamp}-${suffix}`,
    },
    select: { id: true },
  });
}

async function makeApplication(): Promise<string> {
  const job = await makeJob();
  const application = await createApplication({
    userId: await ensureUser(),
    jobId: job.id,
    portal: "manual",
  });
  return application.id;
}

async function ensureUser(): Promise<string> {
  if (userId) return userId;
  const user = await prisma.user.create({
    data: { email, passwordHash: "not-a-real-hash" },
    select: { id: true },
  });
  userId = user.id;
  return userId;
}

afterAll(async () => {
  const jobs = { job: { canonicalUrl: { contains: stamp } } };
  await prisma.application.deleteMany({ where: jobs });
  await prisma.job.deleteMany({ where: { canonicalUrl: { contains: stamp } } });
  if (userId) {
    await prisma.answerBankEntry.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { email } });
  }
  await prisma.$disconnect();
});

describe("gate 1.4: one posting is run by one run at a time (H5)", () => {
  it("gives the claim to exactly one caller", async () => {
    const applicationId = await makeApplication();
    expect(await claimApplication(applicationId)).toBe(true);
    expect(await claimApplication(applicationId)).toBe(false);

    const stored = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      select: { status: true, claimedAt: true },
    });
    expect(stored.status).toBe("RUNNING");
    expect(stored.claimedAt).not.toBeNull();
  });

  it("re-claims a claim older than thirty minutes", async () => {
    const applicationId = await makeApplication();
    expect(await claimApplication(applicationId)).toBe(true);

    const stale = new Date(Date.now() - 31 * 60_000);
    await prisma.application.update({ where: { id: applicationId }, data: { claimedAt: stale } });

    expect(await claimApplication(applicationId)).toBe(true);
  });

  it("releases a claim back to the queue", async () => {
    const applicationId = await makeApplication();
    expect(await claimApplication(applicationId)).toBe(true);
    await releaseApplication(applicationId);

    const stored = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      select: { status: true, claimedAt: true },
    });
    expect(stored.status).toBe("QUEUED");
    expect(stored.claimedAt).toBeNull();
    expect(await claimApplication(applicationId)).toBe(true);
  });
});

describe("a claim a dead run left behind is released, a live one is not", () => {
  it("releases a claim older than the run budget", async () => {
    const applicationId = await makeApplication();
    expect(await claimApplication(applicationId)).toBe(true);

    // The process that owned this row died 31 minutes ago: past the budget.
    await prisma.application.update({
      where: { id: applicationId },
      data: { claimedAt: new Date(Date.now() - 31 * 60_000) },
    });

    const swept = await releaseStaleApplicationClaims({
      olderThan: new Date(Date.now() - CLAIM_STALE_MS),
    });
    expect(swept.ids).toContain(applicationId);

    const stored = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      select: { status: true, claimedAt: true, events: { select: { type: true } } },
    });
    expect(stored.status).toBe("QUEUED");
    expect(stored.claimedAt).toBeNull();
    expect(stored.events.map((event) => event.type)).toContain("CLAIM_RELEASED");

    // And the sweep is audited (I8).
    const audit = await prisma.auditLog.findMany({
      where: { action: "application.claim.released" },
      orderBy: { at: "desc" },
      take: 5,
      select: { payload: true },
    });
    expect(audit.map((row) => JSON.stringify(row.payload)).join(" ")).toContain(applicationId);
  });

  it("leaves a claim inside the budget alone", async () => {
    const applicationId = await makeApplication();
    expect(await claimApplication(applicationId)).toBe(true);

    // Claimed a moment ago: a run may still be driving this row right now.
    const swept = await releaseStaleApplicationClaims({
      olderThan: new Date(Date.now() - CLAIM_STALE_MS),
    });
    expect(swept.ids).not.toContain(applicationId);

    const stored = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      select: { status: true, claimedAt: true },
    });
    expect(stored.status).toBe("RUNNING");
    expect(stored.claimedAt).not.toBeNull();
  });

  it("does not release a row the run already finished", async () => {
    const applicationId = await makeApplication();
    expect(await claimApplication(applicationId)).toBe(true);

    // The result lands first, then a sweep runs with an old cutoff: the row is
    // SUBMITTED and must not be handed back to the queue.
    await prisma.application.update({
      where: { id: applicationId },
      data: { status: "SUBMITTED", claimedAt: new Date(Date.now() - 31 * 60_000) },
    });

    const swept = await releaseStaleApplicationClaims({
      olderThan: new Date(Date.now() - CLAIM_STALE_MS),
    });
    expect(swept.ids).not.toContain(applicationId);

    const stored = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      select: { status: true, claimedAt: true },
    });
    expect(stored.status).toBe("SUBMITTED");
    expect(stored.claimedAt).not.toBeNull();
  });
});

describe("an application belongs to the account that queued it", () => {
  it("lets two accounts apply to the same posting without sharing a row", async () => {
    const owner = await ensureUser();
    const other = await prisma.user.create({
      data: { email: `${stamp}-other@jobpilot.test`, passwordHash: "not-a-real-hash" },
      select: { id: true },
    });
    const job = await makeJob();

    try {
      const mine = await createApplication({ userId: owner, jobId: job.id, portal: "manual" });
      const theirs = await createApplication({ userId: other.id, jobId: job.id, portal: "manual" });
      expect(theirs.id).not.toBe(mine.id);

      // A second call from the same account is still the same row (gate 4.6).
      const again = await createApplication({ userId: other.id, jobId: job.id, portal: "manual" });
      expect(again.id).toBe(theirs.id);

      const owners = await prisma.application.findMany({
        where: { jobId: job.id },
        select: { userId: true },
      });
      expect(owners.map((row) => row.userId).sort()).toEqual([owner, other.id].sort());
    } finally {
      await prisma.application.deleteMany({ where: { jobId: job.id } });
      await prisma.job.deleteMany({ where: { id: job.id } });
      await prisma.user.deleteMany({ where: { id: other.id } });
    }
  });

  it("answers another account's id the same way as one that does not exist", async () => {
    const owner = await ensureUser();
    const other = await prisma.user.create({
      data: { email: `${stamp}-intruder@jobpilot.test`, passwordHash: "not-a-real-hash" },
      select: { id: true },
    });

    try {
      const applicationId = await makeApplication();

      const mine = await findApplicationForUser({ id: applicationId, userId: owner });
      expect(mine?.id).toBe(applicationId);

      expect(await findApplicationForUser({ id: applicationId, userId: other.id })).toBeNull();
      expect(await findApplicationForUser({ id: "cuid_that_does_not_exist", userId: owner })).toBeNull();
    } finally {
      await prisma.user.deleteMany({ where: { id: other.id } });
    }
  });

  it("refuses a result write that names another account's application", async () => {
    const owner = await ensureUser();
    const other = await prisma.user.create({
      data: { email: `${stamp}-writer@jobpilot.test`, passwordHash: "not-a-real-hash" },
      select: { id: true },
    });

    try {
      const applicationId = await makeApplication();
      const before = await prisma.application.findUniqueOrThrow({
        where: { id: applicationId },
        select: { status: true, _count: { select: { events: true } } },
      });
      // Queuing the row already wrote its own audit trail; the refused write adds none.
      const auditsBefore = await prisma.auditLog.count({ where: { entityId: applicationId } });

      // The owner filter is part of the UPDATE, so the caller does not have to read
      // the row first for the write to be safe.
      const refused = await recordApplicationResult({
        userId: other.id,
        applicationId,
        status: "SUBMITTED",
        actions: [{ kind: "SUBMIT", detail: "not this account's row" }],
      });
      expect(refused).toBeNull();

      const after = await prisma.application.findUniqueOrThrow({
        where: { id: applicationId },
        select: { status: true, _count: { select: { events: true } } },
      });
      expect(after.status).toBe(before.status);
      expect(after._count.events).toBe(before._count.events);
      // A write that did not happen leaves no audit trail behind it (I8).
      expect(await prisma.auditLog.count({ where: { entityId: applicationId } })).toBe(auditsBefore);

      // A missing id is the same answer: the caller cannot tell them apart.
      expect(
        await recordApplicationResult({
          userId: other.id,
          applicationId: "cuid_that_does_not_exist",
          status: "SUBMITTED",
          actions: [],
        }),
      ).toBeNull();

      // And the owner's own write still lands.
      const own = await recordApplicationResult({
        userId: owner,
        applicationId,
        status: "SUBMITTED",
        actions: [{ kind: "SUBMIT", detail: "by the owner" }],
      });
      expect(own?.status).toBe("SUBMITTED");
      expect(own?.events).toBeGreaterThan(after._count.events);
    } finally {
      await prisma.user.deleteMany({ where: { id: other.id } });
    }
  });
});

describe("gate 1.6: sensitive answers are encrypted at rest (H2)", () => {
  it("stores ciphertext and returns the plaintext", async () => {
    const owner = await ensureUser();
    const plain = "$120,000 base plus equity";

    const saved = await upsertAnswer({
      userId: owner,
      key: `salary_expectation_${stamp}`,
      answer: plain,
      sensitive: true,
    });

    const raw = await prisma.answerBankEntry.findUniqueOrThrow({
      where: { id: saved.id },
      select: { answer: true, sensitive: true },
    });
    expect(raw.sensitive).toBe(true);
    expect(raw.answer.startsWith("v1.")).toBe(true);
    expect(raw.answer).not.toContain(plain);

    const listed = await listAnswers(owner);
    const entry = listed.find((row) => row.id === saved.id);
    expect(entry?.answer).toBe(plain);
  });

  it("keeps non-sensitive answers readable and never logs the value", async () => {
    const owner = await ensureUser();
    const plain = `${stamp} cover letter paragraph`;

    const saved = await upsertAnswer({
      userId: owner,
      key: `cover_letter_${stamp}`,
      answer: plain,
      sensitive: false,
    });

    const raw = await prisma.answerBankEntry.findUniqueOrThrow({
      where: { id: saved.id },
      select: { answer: true },
    });
    expect(raw.answer).toBe(plain);

    const audit = await prisma.auditLog.findMany({
      where: { action: "answer.save", entityId: saved.id },
      select: { payload: true },
    });
    expect(audit.length).toBeGreaterThan(0);
    for (const row of audit) {
      expect(JSON.stringify(row.payload)).not.toContain(plain);
    }
  });

  it("stores an empty string when the stored value cannot be decrypted", async () => {
    const owner = await ensureUser();
    const saved = await upsertAnswer({
      userId: owner,
      key: `work_auth_${stamp}`,
      answer: "Requires sponsorship",
      sensitive: true,
    });
    await prisma.answerBankEntry.update({
      where: { id: saved.id },
      data: { answer: "v1.AAAA.BBBB.CCCC" },
    });

    const listed = await listAnswers(owner);
    expect(listed.find((row) => row.id === saved.id)?.answer).toBe("");
  });
});
