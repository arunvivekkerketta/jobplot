import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { assignMissingFids } from "@jobpilot/core";
import fixture from "../../../fixtures/sample-resume.json";

/**
 * Gate 2.4, failure path, against a real database.
 *
 * The unit test next door mocks `@jobpilot/db`; this one keeps the database real
 * and mocks only `playwright`, so the run goes through the actual claim, resume
 * staging, release and audit code paths. Run it with:
 *
 *   pnpm test:integration
 *
 * which creates `<database>_e2e`, applies the committed migrations, runs this file
 * against it and exits non-zero if the suite skipped. The direct form, when that
 * database already exists:
 *
 *   DATABASE_URL=postgresql://jobpilot:jobpilot@127.0.0.1:55432/jobpilot_e2e \
 *     pnpm --filter @jobpilot/autopilot exec vitest run test/tempdir.integration.test.ts
 *
 * It skips (and says so) when DATABASE_URL does not name the e2e database, so it
 * can never write rows into a developer's own data by accident.
 */

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const IS_E2E_DATABASE = /\/(jobpilot_e2e)(\?|$)/.test(DATABASE_URL);

const state = vi.hoisted(() => ({
  dirs: [] as string[],
  existedAtThrow: false,
}));

vi.mock("playwright", async () => {
  const fsSync = await import("node:fs");
  state.existedAtThrow =
    state.dirs.length > 0 && fsSync.default.existsSync(state.dirs[0] as string);
  throw new Error("Cannot find module 'playwright'");
});

const stamp = Date.now();
const PORTAL = `gate24-${stamp}`;
const EMAIL = `gate24-${stamp}@jobpilot.local`;

describe.skipIf(!IS_E2E_DATABASE)("gate 2.4: a failed real run leaves no temp directory", () => {
  let prisma: typeof import("@jobpilot/db").prisma;
  let runAutopilotNow: typeof import("../src/index.js").runAutopilotNow;
  let BrowserUnavailableError: typeof import("../src/index.js").BrowserUnavailableError;
  let userId = "";
  let jobId = "";

  beforeAll(async () => {
    ({ prisma } = await import("@jobpilot/db"));
    ({ runAutopilotNow, BrowserUnavailableError } = await import("../src/index.js"));

    const user = await prisma.user.create({
      data: { email: EMAIL, passwordHash: "gate24-not-a-real-hash" },
    });
    userId = user.id;

    const profile = await prisma.profile.create({
      data: {
        userId,
        jsonResume: assignMissingFids(fixture as never) as never,
      },
    });

    const job = await prisma.job.create({
      data: {
        // A unique portal keeps this run clear of the per-domain spacing and of
        // this database's existing submission counts.
        source: PORTAL,
        url: `https://example.test/${PORTAL}`,
        canonicalUrl: `https://example.test/${PORTAL}`,
        company: "NimbusPay",
        title: "Backend Engineer",
        descriptionText: "Backend role.",
        contentHash: `gate24-${stamp}`,
      },
    });
    jobId = job.id;

    await prisma.matchScore.create({
      data: {
        jobId,
        profileId: profile.id,
        score: 92,
        breakdown: {},
        explanation: "gate 2.4 fixture",
        algoVersion: 1,
      },
    });

    const document = await prisma.document.create({
      data: {
        userId,
        type: "RESUME",
        format: "pdf",
        content: Buffer.from("%PDF-1.4 gate 2.4 fixture").toString("base64"),
        metadata: { filename: "gate24.pdf" },
      },
    });

    await prisma.resumeVersion.create({
      data: {
        profileId: profile.id,
        jobId,
        tailoredJson: {},
        validationReport: { ok: true, issues: [], checkedClaims: 0 },
        keywordReport: {},
        approvedAt: new Date(),
        // runAutopilotNow reads the document id back off the end of this path.
        pdfPath: `documents/${document.id}`,
      },
    });

    await prisma.settings.create({
      data: {
        userId,
        mode: "AUTOPILOT",
        allowSubmit: true,
        killSwitch: false,
        // The e2e database already submitted today; this run is about cleanup.
        dailyCap: 9999,
        matchThreshold: 50,
        perPortalMode: {
          [PORTAL]: { mode: "AUTOPILOT", unlockedAt: new Date().toISOString() },
        },
      },
    });
  });

  afterAll(async () => {
    for (const dir of state.dirs) fs.rmSync(dir, { recursive: true, force: true });
    if (!IS_E2E_DATABASE || !userId) return;
    // Children that do not cascade from User go first: applications (Job), the
    // settings row, documents, then the profile, which takes its facts, matches
    // and resume versions with it.
    await prisma.application.deleteMany({ where: { jobId } });
    await prisma.auditLog.deleteMany({ where: { action: "autopilot.unavailable", entityId: userId } });
    await prisma.settings.deleteMany({ where: { userId } });
    await prisma.document.deleteMany({ where: { userId } });
    await prisma.profile.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.$disconnect();
  });

  it("removes the run directory and releases the claim when Playwright cannot be imported", async () => {
    const actual = fs.mkdtempSync.bind(fs);
    const spy = vi.spyOn(fs, "mkdtempSync").mockImplementation(((prefix: string) => {
      const dir = actual(prefix);
      state.dirs.push(dir);
      return dir;
    }) as typeof fs.mkdtempSync);

    try {
      await expect(
        runAutopilotNow(userId, { jobIds: [jobId], limit: 1 }),
      ).rejects.toBeInstanceOf(BrowserUnavailableError);

      // The run had a directory, holding the decrypted resume, when the import
      // failed; otherwise "it is gone" would prove nothing.
      expect(state.dirs).toHaveLength(1);
      const runDir = state.dirs[0] as string;
      expect(state.existedAtThrow).toBe(true);
      expect(fs.existsSync(runDir)).toBe(false);

      // The claim was given back in the database, so the posting is retryable.
      const application = await prisma.application.findUnique({
        where: { userId_jobId: { userId, jobId } },
      });
      expect(application?.status).toBe("QUEUED");
      expect(application?.claimedAt).toBeNull();

      // And the failure was audited (I8).
      const audit = await prisma.auditLog.findFirst({
        where: { action: "autopilot.unavailable", entityId: userId },
        orderBy: { at: "desc" },
      });
      expect(audit).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

if (!IS_E2E_DATABASE) {
  // Printed so a plain `pnpm test` says why this file did nothing.
  console.log(
    "gate 2.4 integration test skipped: set DATABASE_URL to the jobpilot_e2e database to run it",
  );
}
