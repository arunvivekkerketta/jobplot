import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma, recentFailedLogins, recordLoginAttempt } from "../src/index.js";

vi.setConfig({ testTimeout: 30_000 });

const stamp = `login-${Date.now()}`;
const email = `${stamp}@jobpilot.test`;

afterAll(async () => {
  await prisma.loginAttempt.deleteMany({ where: { email: { contains: stamp } } });
  await prisma.$disconnect();
});

describe("gate 2.6: failed sign-ins are counted per address (M7)", () => {
  it("counts failures only, inside the window, whatever the casing", async () => {
    await recordLoginAttempt(email.toUpperCase(), true);
    expect(await recentFailedLogins(email, 15)).toBe(0);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await recordLoginAttempt(email, false);
    }
    expect(await recentFailedLogins(email, 15)).toBe(3);

    await prisma.loginAttempt.create({
      data: { email, ok: false, at: new Date(Date.now() - 60 * 60_000) },
    });
    // The old failure is outside the 15-minute window but inside a two-hour one.
    expect(await recentFailedLogins(email, 15)).toBe(3);
    expect(await recentFailedLogins(email, 120)).toBe(4);
  });
});
