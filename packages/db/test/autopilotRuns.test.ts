import { afterAll, describe, expect, it, vi } from "vitest";
import { listAutopilotRunHistory, prisma, writeAudit } from "../src/index.js";

// These cases hit a local Postgres, which regularly takes longer than the 5s
// default on this machine.
vi.setConfig({ testTimeout: 30_000 });

const stamp = `runhistory-${Date.now()}`;
const userIds: string[] = [];
let counter = 0;

async function makeUser(label: string): Promise<string> {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      email: `${stamp}-${label}-${counter}@jobpilot.test`,
      passwordHash: "not-a-real-hash",
    },
    select: { id: true },
  });
  userIds.push(user.id);
  return user.id;
}

async function writeRun(
  userId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await writeAudit({
    actor: "SYSTEM",
    action: "autopilot.run",
    entityType: "Settings",
    entityId: userId,
    payload,
  });
}

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe("the Auto-Pilot run history comes from the audited run rows", () => {
  it("returns this account's runs, newest first, with the summary fields", async () => {
    const owner = await makeUser("owner");

    await writeRun(owner, {
      queued: 3,
      submitted: 2,
      paused: 1,
      stopReason: null,
      portals: ["manual", "greenhouse"],
    });
    await writeRun(owner, {
      queued: 1,
      submitted: 0,
      paused: 1,
      stopReason: "KILL_SWITCH",
      portals: ["manual"],
    });

    const history = await listAutopilotRunHistory({ userId: owner });

    expect(history).toHaveLength(2);
    // Newest first: the stopped run is the later row.
    expect(history[0]?.stopReason).toBe("KILL_SWITCH");
    expect(history[0]?.paused).toBe(1);
    expect(history[1]?.submitted).toBe(2);
    expect(history[1]?.queued).toBe(3);
    expect(history[1]?.portals).toEqual(["manual", "greenhouse"]);
  });

  it("never shows another account's run", async () => {
    const owner = await makeUser("owner");
    const other = await makeUser("other");

    await writeRun(owner, { queued: 1, submitted: 1, paused: 0, stopReason: null });
    await writeRun(other, { queued: 9, submitted: 9, paused: 0, stopReason: "DAILY_CAP" });

    const history = await listAutopilotRunHistory({ userId: owner });

    expect(history).toHaveLength(1);
    expect(history[0]?.queued).toBe(1);
    expect(history.some((run) => run.stopReason === "DAILY_CAP")).toBe(false);
  });

  it("ignores a malformed payload instead of failing the page", async () => {
    const owner = await makeUser("owner");

    await writeAudit({
      actor: "SYSTEM",
      action: "autopilot.run",
      entityType: "Settings",
      entityId: owner,
      payload: { queued: "three", portals: "manual" },
    });

    const history = await listAutopilotRunHistory({ userId: owner });

    expect(history).toEqual([
      { at: expect.any(Date), queued: 0, submitted: 0, paused: 0, stopReason: null, portals: [] },
    ]);
  });

  it("honours the take limit", async () => {
    const owner = await makeUser("owner");
    for (let index = 0; index < 4; index += 1) {
      await writeRun(owner, { queued: index, submitted: 0, paused: 0, stopReason: null });
    }

    const history = await listAutopilotRunHistory({ userId: owner, take: 2 });

    expect(history).toHaveLength(2);
  });
});
