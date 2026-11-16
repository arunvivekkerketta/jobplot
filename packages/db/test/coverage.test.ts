import { afterAll, describe, expect, it, vi } from "vitest";
import {
  createApplication,
  listMissingAnswerKeys,
  listNotifyStops,
  prisma,
  recordApplicationResult,
  writeAudit,
} from "../src/index.js";

// These cases hit a local Postgres, which regularly takes longer than the 5s
// default on this machine.
vi.setConfig({ testTimeout: 30_000 });

const stamp = `coverage-${Date.now()}`;
let counter = 0;
const userIds: string[] = [];

async function makeUser(label: string): Promise<string> {
  counter += 1;
  const user = await prisma.user.create({
    data: { email: `${stamp}-${label}-${counter}@jobpilot.test`, passwordHash: "not-a-real-hash" },
    select: { id: true },
  });
  userIds.push(user.id);
  return user.id;
}

async function makeApplication(userId: string): Promise<string> {
  counter += 1;
  const job = await prisma.job.create({
    data: {
      source: "manual",
      url: `https://jobs.example/${stamp}/${counter}`,
      canonicalUrl: `https://jobs.example/${stamp}/${counter}`,
      company: "Acme",
      title: `Backend Engineer ${counter}`,
      descriptionText: "Backend role",
      contentHash: `${stamp}-${counter}`,
    },
    select: { id: true },
  });
  const application = await createApplication({ userId, jobId: job.id, portal: "manual" });
  return application.id;
}

afterAll(async () => {
  await prisma.applicationEvent.deleteMany({
    where: { application: { job: { canonicalUrl: { contains: stamp } } } },
  });
  await prisma.application.deleteMany({ where: { job: { canonicalUrl: { contains: stamp } } } });
  await prisma.job.deleteMany({ where: { canonicalUrl: { contains: stamp } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

const since = new Date(Date.now() - 60 * 60_000);

describe("the coverage report's two audited inputs are owner-scoped", () => {
  it("groups only this account's stop notifications", async () => {
    const owner = await makeUser("owner");
    const other = await makeUser("other");

    for (const [entityId, code] of [
      [owner, "NEEDS_HUMAN_FIELDS"],
      [owner, "NO_APPROVED_RESUME"],
      [other, "DAILY_CAP"],
    ] as const) {
      await writeAudit({
        actor: "SYSTEM",
        action: "autopilot.notify",
        entityType: "Settings",
        entityId,
        payload: { delivered: false, reason: "NOT_CONFIGURED", code },
      });
    }

    const stops = await listNotifyStops({ userId: owner, since });

    expect(stops.map((stop) => stop.code).sort()).toEqual([
      "NEEDS_HUMAN_FIELDS",
      "NO_APPROVED_RESUME",
    ]);
    expect(stops.every((stop) => stop.delivered === false)).toBe(true);
  });

  it("reads the missing keys off this account's applications only", async () => {
    const owner = await makeUser("owner");
    const other = await makeUser("other");

    const mine = await makeApplication(owner);
    const theirs = await makeApplication(other);

    await recordApplicationResult({
      applicationId: mine,
      status: "PAUSED_NEEDS_HUMAN",
      actions: [],
      reason: "NEEDS_HUMAN_FIELDS",
      needsHuman: [
        { key: "salary_expectation", reason: "sensitive question with no Answer Bank entry" },
        { key: null, reason: "unmapped form field" },
      ],
    });
    await recordApplicationResult({
      applicationId: theirs,
      status: "PAUSED_NEEDS_HUMAN",
      actions: [],
      reason: "NEEDS_HUMAN_FIELDS",
      needsHuman: [{ key: "work_auth", reason: "sensitive question with no Answer Bank entry" }],
    });

    const missing = await listMissingAnswerKeys({ userId: owner, since });

    // Two events for the owner's paused application, and none from the other
    // account's — a leaked key would show up as `work_auth`.
    expect(missing).toHaveLength(2);
    expect(missing.map((row) => row.key).sort()).toEqual([null, "salary_expectation"]);
  });

  it("ignores rows outside the window", async () => {
    const owner = await makeUser("owner");
    const applicationId = await makeApplication(owner);

    await recordApplicationResult({
      applicationId,
      status: "PAUSED_NEEDS_HUMAN",
      actions: [],
      reason: "NEEDS_HUMAN_FIELDS",
      needsHuman: [{ key: "salary_expectation", reason: "sensitive question" }],
    });

    const future = new Date(Date.now() + 60_000);
    expect(await listMissingAnswerKeys({ userId: owner, since: future })).toEqual([]);
    expect(await listNotifyStops({ userId: owner, since: future })).toEqual([]);
  });
});
