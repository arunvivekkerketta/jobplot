import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Gate 2.4, failure path: when the browser runtime cannot be imported, the run
 * must still delete the directory it created for the resume PDFs (and give its
 * claims back), instead of leaving decrypted resumes on disk.
 *
 * The Playwright import is mocked to reject the way a missing runtime does, the
 * database is mocked so no server is needed, and the temporary directory is
 * observed through a spy on mkdtempSync: the test proves it existed at the moment
 * of the failure and is gone afterwards.
 */

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

const db = vi.hoisted(() => ({
  audits: [] as Array<Record<string, unknown>>,
  released: [] as string[],
}));

vi.mock("@jobpilot/db", () => {
  const settings = {
    userId: "user-1",
    allowSubmit: true,
    killSwitch: false,
    dailyCap: 10,
    matchThreshold: 50,
    mode: "AUTOPILOT",
    perPortalMode: {
      manual: { mode: "AUTOPILOT", unlockedAt: "2026-01-01T00:00:00.000Z" },
    },
  };
  const jsonResume = {
    basics: {
      name: "Priya Raman",
      email: "priya@example.com",
      phone: "+91 90000 00000",
      url: "https://example.com/priya",
      summary: "Backend engineer.",
      location: { city: "Bengaluru", countryCode: "IN" },
    },
    work: [],
    education: [],
    skills: [],
    projects: [],
    certificates: [],
  };
  const job = {
    id: "job-1",
    title: "Backend Engineer",
    url: "https://example.test/apply",
    source: "manual",
  };

  return {
    prisma: {
      settings: { upsert: async () => ({ ...settings }) },
      profile: { findUnique: async () => ({ id: "profile-1", jsonResume }) },
      matchScore: { findMany: async () => [{ id: "match-1", score: 90, job }] },
      resumeVersion: {
        findMany: async () => [{ id: "version-1", jobId: "job-1", pdfPath: "documents/doc-1.pdf" }],
      },
      application: { findMany: async () => [] },
    },
    createApplication: async () => ({ id: "app-1", status: "QUEUED" }),
    claimApplication: async () => true,
    // The run sweeps abandoned claims before choosing candidates; this case has
    // none, so the sweep is a no-op here.
    CLAIM_STALE_MS: 30 * 60_000,
    releaseStaleApplicationClaims: async () => ({ released: 0, ids: [] }),
    releaseApplication: async (id: string) => {
      db.released.push(id);
    },
    listAnswers: async () => [],
    readDocumentBytes: async () => ({ bytes: Buffer.from("%PDF-1.4 test"), format: "pdf" }),
    submissionCounts: async () => ({ total: 0, byPortal: {}, lastByPortal: {} }),
    writeAudit: async (entry: Record<string, unknown>) => {
      db.audits.push(entry);
    },
  };
});

const { runAutopilotNow, BrowserUnavailableError } = await import("../src/index.js");

let spy: { mockRestore: () => void };

beforeEach(() => {
  state.dirs.length = 0;
  state.existedAtThrow = false;
  db.audits.length = 0;
  db.released.length = 0;
  const actual = fs.mkdtempSync.bind(fs);
  spy = vi.spyOn(fs, "mkdtempSync").mockImplementation(((prefix: string) => {
    const dir = actual(prefix);
    state.dirs.push(dir);
    return dir;
  }) as typeof fs.mkdtempSync);
});

afterEach(() => {
  spy.mockRestore();
  for (const dir of state.dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe("gate 2.4: a failed run leaves no temporary directory behind", () => {
  it("removes the resume directory when the Playwright import throws", async () => {
    await expect(
      runAutopilotNow("user-1", { jobIds: ["job-1"], limit: 1 }),
    ).rejects.toBeInstanceOf(BrowserUnavailableError);

    // The run really had a directory, with the decrypted resume in it, at the
    // moment the import failed — otherwise "it is gone" would prove nothing.
    expect(state.dirs).toHaveLength(1);
    expect(state.existedAtThrow).toBe(true);

    expect(fs.existsSync(state.dirs[0] as string)).toBe(false);
    expect(fs.readdirSync(path.dirname(state.dirs[0] as string))).not.toContain(
      state.dirs[0]?.split(/[\\/]/).pop(),
    );

    // The claim was given back, so the posting is retryable, and the failure was
    // audited (I8).
    expect(db.released).toEqual(["app-1"]);
    expect(db.audits.some((entry) => entry.action === "autopilot.unavailable")).toBe(true);
  });
});
