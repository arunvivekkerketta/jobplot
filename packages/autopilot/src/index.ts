import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  canUnlockPortal,
  playwrightPage,
  readPortalPolicy,
  runApplication,
  runAutopilot,
  selectAutopilotQueue,
  trustState,
  type AutopilotCandidate,
  type AutopilotOutcome,
  type PageLike,
  type SkippedCandidate,
} from "@jobpilot/apply";
import { startOfDayInZone, type JsonResumeProfile, type NotifyInput } from "@jobpilot/core";
import { notifyHumanNeeded } from "./notify.js";
import {
  CLAIM_STALE_MS,
  approvedCoPilotByPortal,
  releaseStaleApplicationClaims,
  claimApplication,
  createApplication,
  listAnswers,
  listAutopilotRunHistory,
  listSchedulingSettings,
  prisma,
  readDocumentBytes,
  recordApplicationResult,
  releaseApplication,
  setPortalPolicy,
  submissionCounts,
  writeAudit,
} from "@jobpilot/db";

/** One applicant-facing view of Auto-Pilot for the page and the API. */
export interface PortalStatus {
  portal: string;
  unlocked: boolean;
  unlockedAt: string | null;
  submissionsToday: number;
  open: number;
  /** Co-Pilot applications the user approved on this portal (trust ladder, 4.2). */
  approved: number;
  required: number;
  remaining: number;
}

export interface AutopilotStatus {
  mode: string;
  allowSubmit: boolean;
  killSwitch: boolean;
  dailyCap: number;
  matchThreshold: number;
  submissionsToday: number;
  portals: PortalStatus[];
  eligible: Array<AutopilotCandidate & { resumeVersionId: string | null }>;
  skipped: SkippedCandidate[];
  /** The newest run, for callers that only want the last summary. */
  lastRun: RunHistoryEntry | null;
  /** Every run still in the audit trail, newest first — the page's run history. */
  history: RunHistoryEntry[];
}

export interface RunHistoryEntry {
  at: string;
  submitted: number;
  paused: number;
  queued: number;
  stopReason: string | null;
  portals: string[];
}

interface StoredCandidate extends AutopilotCandidate {
  pdfPath: string | null;
}

/**
 * The daily cap is a calendar concept, so it follows APP_TIMEZONE rather than the
 * server's own zone; a run at 01:00 in Kolkata must already count as a new day.
 */
function startOfToday(now = new Date()): Date {
  return startOfDayInZone(now, process.env.APP_TIMEZONE ?? "UTC");
}

async function settingsFor(userId: string) {
  return prisma.settings.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

/**
 * Builds the candidate list from stored state only: scored postings above the
 * threshold with no application yet, each paired with an approved resume version
 * (the posting's own first, otherwise the newest approved one) (gate 7.2).
 */
async function loadCandidates(
  userId: string,
  filter: { portal?: string; jobIds?: string[] } = {},
): Promise<StoredCandidate[]> {
  const portal = filter.portal;
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!profile) return [];

  const matches = await prisma.matchScore.findMany({
    // An explicit job filter must run in the query: a score-ordered `take` would
    // truncate the requested postings before the filter ever saw them.
    where: {
      profileId: profile.id,
      ...(filter.jobIds ? { jobId: { in: filter.jobIds } } : {}),
    },
    orderBy: [{ score: "desc" }, { id: "asc" }],
    take: filter.jobIds ? 50 : 30,
    include: {
      job: { select: { id: true, title: true, url: true, source: true } },
    },
  });

  const versions = await prisma.resumeVersion.findMany({
    where: { profileId: profile.id, approvedAt: { not: null }, pdfPath: { not: null } },
    orderBy: { id: "desc" },
    select: { id: true, jobId: true, pdfPath: true },
  });

  const applications = await prisma.application.findMany({
    where: {
      userId,
      jobId: { in: matches.map((match) => match.job.id) },
    },
    select: { jobId: true, status: true },
  });
  // A paused application is retried (a missing Answer Bank entry is fixable);
  // only a submitted one is finished. A posting that ended in ERROR is left
  // alone: its page is unreachable, and a scheduled tick must not spend its one
  // slot on the same dead host every time.
  const applied = new Set(
    applications
      .filter(
        (application) =>
          application.status === "SUBMITTED" ||
          application.status === "ERROR" ||
          // Another run already owns this row; it must not be selected again (H5).
          application.status === "RUNNING",
      )
      .map((application) => application.jobId),
  );

  return matches
    .filter((match) => !applied.has(match.job.id))
    .filter((match) => !portal || match.job.source === portal)
    .filter((match) => !filter.jobIds || filter.jobIds.includes(match.job.id))
    .map((match) => {
      // Only a resume approved for this posting (or a generic approved version)
      // may be attached; a version tailored for another job is not evidence for
      // this one (I1/I3).
      const version =
        versions.find((entry) => entry.jobId === match.job.id) ??
        versions.find((entry) => entry.jobId === null) ??
        null;
      return {
        jobId: match.job.id,
        portal: match.job.source,
        title: match.job.title,
        url: match.job.url,
        score: match.score,
        resumeVersionId: version?.id ?? null,
        pdfPath: version?.pdfPath ?? null,
      };
    });
}

export async function loadAutopilotStatus(userId: string): Promise<AutopilotStatus> {
  const settings = await settingsFor(userId);
  const counts = await submissionCounts({ userId, since: startOfToday() });
  const candidates = await loadCandidates(userId);

  const selection = selectAutopilotQueue({
    policies: settings.perPortalMode,
    settings: {
      killSwitch: settings.killSwitch,
      allowSubmit: settings.allowSubmit,
      dailyCap: settings.dailyCap,
      mode: settings.mode,
    },
    threshold: settings.matchThreshold,
    candidates,
    submissionsToday: counts.total,
    perPortalToday: counts.byPortal,
    lastActionAt: counts.lastByPortal,
    now: new Date(),
    limit: 3,
  });

  const sources = await prisma.job.groupBy({
    by: ["source"],
    _count: { _all: true },
  });
  const trustCounts = await approvedCoPilotByPortal(userId);

  const portals: PortalStatus[] = sources
    .map((row) => row.source)
    .sort()
    .map((portal) => {
      const policy = readPortalPolicy(settings.perPortalMode, portal);
      const trust = trustState(trustCounts[portal] ?? 0);
      return {
        portal,
        unlocked: policy !== null,
        unlockedAt: policy?.unlockedAt ?? null,
        submissionsToday: counts.byPortal[portal] ?? 0,
        open: candidates.filter((candidate) => candidate.portal === portal).length,
        approved: trust.approved,
        required: trust.required,
        remaining: trust.remaining,
      };
    });

  // Scoped to this user: a single-row deployment would otherwise show the last
  // run of whoever happened to trigger one. The rows come from the audit trail,
  // which every run writes, so the history cannot drift from what was submitted.
  const history: RunHistoryEntry[] = (
    await listAutopilotRunHistory({ userId, take: RUN_HISTORY_LIMIT })
  ).map((row) => ({
    at: row.at.toISOString(),
    submitted: row.submitted,
    paused: row.paused,
    queued: row.queued,
    stopReason: row.stopReason,
    portals: row.portals,
  }));

  return {
    mode: settings.mode,
    allowSubmit: settings.allowSubmit,
    killSwitch: settings.killSwitch,
    dailyCap: settings.dailyCap,
    matchThreshold: settings.matchThreshold,
    submissionsToday: counts.total,
    portals,
    eligible: selection.eligible,
    skipped: selection.skipped,
    lastRun: history[0] ?? null,
    history,
  };
}

export type PortalUpdate =
  | { ok: true; portal: string; unlocked: boolean }
  | { ok: false; status: number; error: string };

/**
 * Unlocking is refused unless submissions are enabled, nothing is stopped (7.1)
 * and the portal has been earned with Co-Pilot approvals first (4.2).
 */
export async function updatePortal(
  userId: string,
  portal: string,
  unlocked: boolean,
): Promise<PortalUpdate> {
  const settings = await settingsFor(userId);

  if (unlocked) {
    // Read from stored applications, never from the request (4.2).
    const trust = trustState((await approvedCoPilotByPortal(userId))[portal] ?? 0);
    const decision = canUnlockPortal(
      { allowSubmit: settings.allowSubmit, killSwitch: settings.killSwitch },
      { approved: trust.approved },
    );
    if (!decision.ok) {
      return { ok: false, status: 409, error: decision.message };
    }
  }

  await setPortalPolicy({
    userId,
    portal,
    mode: unlocked ? "AUTOPILOT" : "COPILOT",
  });
  return { ok: true, portal, unlocked };
}

export class BrowserUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserUnavailableError";
  }
}

export interface RunAutopilotResult {
  queued: number;
  submitted: number;
  paused: number;
  outcomes: AutopilotOutcome[];
  skipped: SkippedCandidate[];
  stopReason: string | null;
}

/**
 * Executes one Auto-Pilot batch: decide the queue, queue the applications, open a
 * browser per posting and record every outcome. The stop gate is re-checked per
 * posting inside `runAutopilot`, so a cap reached mid-batch stops the batch.
 */
export async function runAutopilotNow(
  userId: string,
  options: { limit?: number; jobIds?: string[] } = {},
): Promise<RunAutopilotResult> {
  // A run that was killed mid-batch left its rows claimed and RUNNING, and
  // candidate selection skips those, so nothing would ever retry them. Release
  // them before choosing this run's candidates (H5).
  await releaseStaleApplicationClaims({
    olderThan: new Date(Date.now() - CLAIM_STALE_MS),
  });

  const settings = await settingsFor(userId);
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) throw new Error("Import a profile before running Auto-Pilot.");

  const counts = await submissionCounts({ userId, since: startOfToday() });
  const candidates = await loadCandidates(userId, {
    ...(options.jobIds ? { jobIds: options.jobIds } : {}),
  });
  const limit = options.limit ?? 3;

  const selection = selectAutopilotQueue({
    policies: settings.perPortalMode,
    settings: {
      killSwitch: settings.killSwitch,
      allowSubmit: settings.allowSubmit,
      dailyCap: settings.dailyCap,
      mode: settings.mode,
    },
    threshold: settings.matchThreshold,
    candidates,
    submissionsToday: counts.total,
    perPortalToday: counts.byPortal,
    lastActionAt: counts.lastByPortal,
    now: new Date(),
    limit,
  });

  if (selection.eligible.length === 0) {
    await writeAudit({
      actor: "SYSTEM",
      action: "autopilot.skip",
      entityType: "Settings",
      entityId: userId,
      payload: { queued: 0, skipped: selection.skipped.length, reasons: selection.skipped.map((s) => s.reason) },
    });
    return {
      queued: 0,
      submitted: 0,
      paused: 0,
      outcomes: [],
      skipped: selection.skipped,
      stopReason: "NO_ELIGIBLE_CANDIDATES",
    };
  }

  const eligible = selection.eligible as StoredCandidate[];
  const applicationIds = new Map<string, string>();
  const claimed: StoredCandidate[] = [];
  const claimedIds: string[] = [];
  for (const candidate of eligible) {
    const application = await createApplication({
      userId,
      jobId: candidate.jobId,
      portal: candidate.portal,
      mode: "AUTOPILOT",
    });
    // Two runs can select the same posting (the button and the cron); only the one
    // that wins the conditional update may drive the browser (H5).
    if (!(await claimApplication(application.id))) continue;
    claimed.push(candidate);
    claimedIds.push(application.id);
    applicationIds.set(candidate.jobId, application.id);
  }

  if (claimed.length === 0) {
    await writeAudit({
      actor: "SYSTEM",
      action: "autopilot.skip",
      entityType: "Settings",
      entityId: userId,
      payload: { queued: 0, skipped: selection.skipped.length, reason: "ALREADY_RUNNING" },
    });
    return {
      queued: 0,
      submitted: 0,
      paused: 0,
      outcomes: [],
      skipped: selection.skipped,
      stopReason: "ALREADY_RUNNING",
    };
  }

  /** Gives every claim back so the next run can retry instead of being locked out. */
  const releaseClaims = async (): Promise<void> => {
    for (const id of claimedIds) await releaseApplication(id);
  };

  /** One exit for both browser failures: give the claims back, audit, then throw. */
  const browserFailure = async (error: unknown, message: string): Promise<Error> => {
    await releaseClaims();
    await writeAudit({
      actor: "SYSTEM",
      action: "autopilot.unavailable",
      entityType: "Settings",
      entityId: userId,
      payload: { message: error instanceof Error ? error.message : "browser unavailable" },
    });
    return new BrowserUnavailableError(message);
  };

  const answers = await listAnswers(userId);
  // One directory per run, readable only by this account and deleted on every
  // exit path, including a browser that never starts (M5).
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jobpilot-"));
  fs.chmodSync(tempDir, 0o700);

  try {
    // The approved resume is copied beside the run so the form can attach a file;
    // the copy is private to this account and removed by the outer finally.
    const resumePaths = new Map<string, string>();
    for (const candidate of claimed) {
      const documentId = candidate.pdfPath?.split("/").pop();
      if (!documentId) continue;
      const stored = await readDocumentBytes({ id: documentId, userId });
      if (!stored) continue;
      const file = path.join(tempDir, `${randomUUID()}.pdf`);
      fs.writeFileSync(file, stored.bytes, { mode: 0o600 });
      resumePaths.set(candidate.jobId, file);
    }

    let chromium: typeof import("playwright").chromium;
    try {
      ({ chromium } = await import("playwright"));
    } catch (error) {
      throw await browserFailure(
        error,
        "The browser runtime is not installed, so Auto-Pilot cannot run.",
      );
    }

    let browser: Awaited<ReturnType<typeof chromium.launch>>;
    try {
      browser = await chromium.launch();
    } catch (error) {
      throw await browserFailure(
        error,
        "The browser could not be started, so Auto-Pilot cannot run.",
      );
    }

    try {
      // Webhook deliveries are queued here and sent once the batch is over: a slow
      // or unreachable webhook must not stretch the gap between two applications.
      const notifications: NotifyInput[] = [];
      const report = await runAutopilot({
        targets: claimed.map((candidate) => ({
          jobId: candidate.jobId,
          portal: candidate.portal,
          url: candidate.url,
          ...(resumePaths.has(candidate.jobId)
            ? { resumePath: resumePaths.get(candidate.jobId)! }
            : {}),
        })),
        openPage: async () => {
          const page = await browser.newPage();
          const runtime = playwrightPage(page as unknown as PageLike);
          return {
            ...runtime,
            close: async () => {
              await page.close();
            },
          };
        },
        profile: profile.jsonResume as unknown as JsonResumeProfile,
        answers,
        maxApplications: limit,
        // Re-read from the database before every posting: the kill switch and the
        // caps must act on the run that is happening now, not on the snapshot taken
        // when the batch started (I4).
        preflightFor: async (target) => {
          const fresh = await settingsFor(userId);
          const today = await submissionCounts({ userId, since: startOfToday() });
          const last = today.lastByPortal[target.portal];
          return {
            settings: {
              killSwitch: fresh.killSwitch,
              allowSubmit: fresh.allowSubmit,
              dailyCap: fresh.dailyCap,
              mode: fresh.mode,
            },
            submissionsToday: today.total,
            perPortalSubmissionsToday: today.byPortal[target.portal] ?? 0,
            ...(last ? { lastActionAt: last } : {}),
            now: new Date(),
          };
        },
        // Last chance to stop: the form is filled but nothing has been sent. Both
        // switches are read again, so turning submissions off mid-run stops it too
        // (I3/I4).
        beforeSubmit: async () => {
          const fresh = await settingsFor(userId);
          return !fresh.killSwitch && fresh.allowSubmit;
        },
        onOutcome: async (outcome) => {
          const applicationId = applicationIds.get(outcome.jobId);
          if (!applicationId) return;
          await recordApplicationResult({
            applicationId,
            status: outcome.status,
            actions: outcome.actions,
            ...(outcome.reason ? { reason: outcome.reason } : {}),
            ...(outcome.submissionText ? { submissionText: outcome.submissionText } : {}),
            // Which questions blocked the run, so the Answer Bank coverage report
            // can name the entry that would have prevented it (4.10).
            needsHuman: outcome.needsHuman,
          });

          // Anything a human must finish is announced, with codes only (I5/I7).
          if (outcome.status !== "SUBMITTED") {
            const candidate = claimed.find((entry) => entry.jobId === outcome.jobId);
            notifications.push({
              title: candidate?.title ?? "Application",
              portal: candidate?.portal ?? "unknown",
              reason: outcome.reason ?? outcome.status,
            });
          }
        },
      });

      // Delivered together, and only now: the first one may already be slow while
      // the run is finished, instead of inside the loop that drives the browser.
      await Promise.allSettled(
        notifications.map((input) =>
          notifyHumanNeeded(input, {
            audit: async (payload) =>
              writeAudit({
                actor: "SYSTEM",
                action: "autopilot.notify",
                entityType: "Settings",
                entityId: userId,
                payload,
              }),
          }),
        ),
      );

      const submitted = report.outcomes.filter((outcome) => outcome.status === "SUBMITTED").length;
      const paused = report.outcomes.length - submitted;

      await writeAudit({
        actor: "SYSTEM",
        action: "autopilot.run",
        entityType: "Settings",
        entityId: userId,
        payload: {
          queued: eligible.length,
          submitted,
          paused,
          stopReason: report.stopReason ?? null,
          portals: [...new Set(eligible.map((candidate) => candidate.portal))],
        },
      });

      return {
        queued: eligible.length,
        submitted,
        paused,
        outcomes: report.outcomes,
        skipped: selection.skipped,
        stopReason: report.stopReason ?? null,
      };
    } finally {
      await browser.close();
    }
  } finally {
    // Runs even when the browser runtime is missing or fails to launch.
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export type ApproveOutcome =
  | {
      ok: true;
      mode: "COPILOT";
      status: "SUBMITTED" | "PAUSED_NEEDS_HUMAN" | "BLOCKED";
      reason: string | null;
      actions: number;
    }
  | { ok: false; status: number; error: string };

/** The statuses where a Co-Pilot row is still waiting for the user's decision. */
const APPROVABLE_STATUSES = ["QUEUED", "PAUSED_NEEDS_HUMAN", "BLOCKED"];

/** How many past runs the page shows; the audit trail keeps all of them. */
const RUN_HISTORY_LIMIT = 10;

/**
 * "Approve and send" for one Co-Pilot application (4.2).
 *
 * This is the only place a Co-Pilot row becomes SUBMITTED, so every stop check
 * lives here: the master switch, the kill switch, the daily cap and the per-row
 * claim are re-read now, and the kill switch is read once more while the form is
 * filled, immediately before the submit click (I4). The row keeps
 * `mode: "COPILOT"`, which is exactly what the trust ladder counts.
 */
export async function runApprovedApplication(
  userId: string,
  applicationId: string,
): Promise<ApproveOutcome> {
  const application = await prisma.application.findFirst({
    where: { id: applicationId, userId },
    select: { id: true, status: true, mode: true, jobId: true },
  });
  if (!application) return { ok: false, status: 404, error: "Unknown application" };
  if (application.mode !== "COPILOT") {
    return {
      ok: false,
      status: 409,
      error:
        "Only a Co-Pilot application can be approved here; an Auto-Pilot one needs an unlocked portal.",
    };
  }
  if (!APPROVABLE_STATUSES.includes(application.status)) {
    return {
      ok: false,
      status: 409,
      error: `Cannot approve an application in status ${application.status}`,
    };
  }

  const settings = await settingsFor(userId);
  if (settings.killSwitch) {
    return { ok: false, status: 409, error: "The kill switch is on, so nothing can be sent." };
  }
  if (!settings.allowSubmit) {
    return { ok: false, status: 409, error: "allowSubmit is off, so nothing can be sent." };
  }

  const today = await submissionCounts({ userId, since: startOfToday() });
  if (today.total >= settings.dailyCap) {
    return {
      ok: false,
      status: 409,
      error: `Daily cap reached (${today.total}/${settings.dailyCap}).`,
    };
  }

  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { id: true, jsonResume: true },
  });
  if (!profile) {
    return {
      ok: false,
      status: 409,
      error: "Import a profile before approving an application.",
    };
  }

  const job = await prisma.job.findUnique({
    where: { id: application.jobId },
    select: { id: true, url: true },
  });
  if (!job) return { ok: false, status: 404, error: "Unknown job" };

  // Two runs (a click and a retry) must never both drive this form (H5).
  if (!(await claimApplication(application.id))) {
    return { ok: false, status: 409, error: "This application is already being sent." };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jobpilot-approve-"));
  fs.chmodSync(tempDir, 0o700);
  try {
    // The same evidence rule as Auto-Pilot: a version approved for this posting,
    // otherwise a generic approved one (I1/I3).
    const approvedVersion =
      (await prisma.resumeVersion.findFirst({
        where: {
          profileId: profile.id,
          jobId: job.id,
          approvedAt: { not: null },
          pdfPath: { not: null },
        },
        orderBy: { id: "desc" },
        select: { pdfPath: true },
      })) ??
      (await prisma.resumeVersion.findFirst({
        where: {
          profileId: profile.id,
          jobId: null,
          approvedAt: { not: null },
          pdfPath: { not: null },
        },
        orderBy: { id: "desc" },
        select: { pdfPath: true },
      }));

    let resumePath: string | undefined;
    if (approvedVersion?.pdfPath) {
      const documentId = approvedVersion.pdfPath.split("/").pop();
      const stored = documentId
        ? await readDocumentBytes({ id: documentId, userId })
        : null;
      if (stored) {
        // Readable only by this account, and deleted on every exit path.
        resumePath = path.join(tempDir, `${randomUUID()}.pdf`);
        fs.writeFileSync(resumePath, stored.bytes, { mode: 0o600 });
      }
    }

    let chromium: typeof import("playwright").chromium;
    try {
      ({ chromium } = await import("playwright"));
    } catch {
      await releaseApplication(application.id);
      return {
        ok: false,
        status: 503,
        error: "The browser runtime is not installed, so nothing was sent.",
      };
    }

    let browser: Awaited<ReturnType<typeof chromium.launch>>;
    try {
      browser = await chromium.launch();
    } catch {
      await releaseApplication(application.id);
      return {
        ok: false,
        status: 503,
        error: "The browser could not be started, so nothing was sent.",
      };
    }

    try {
      const page = await browser.newPage();
      const result = await runApplication({
        page: playwrightPage(page as unknown as PageLike),
        url: job.url,
        profile: profile.jsonResume as unknown as JsonResumeProfile,
        answers: await listAnswers(userId),
        ...(resumePath ? { resumePath } : {}),
        // Last chance to stop: the form is filled, nothing has been sent (I4).
        beforeSubmit: async () => {
          const fresh = await settingsFor(userId);
          return !fresh.killSwitch && fresh.allowSubmit;
        },
      });

      await recordApplicationResult({
        applicationId: application.id,
        status: result.status,
        actions: result.actions,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.submissionText ? { submissionText: result.submissionText } : {}),
        needsHuman: result.needsHuman.map((field) => ({
          key: field.key,
          reason: field.reason ?? "needs a human answer",
        })),
      });

      await writeAudit({
        actor: "USER",
        action: "application.approve",
        entityType: "Application",
        entityId: application.id,
        payload: {
          mode: "COPILOT",
          status: result.status,
          reason: result.reason ?? null,
          actions: result.actions.length,
        },
      });

      return {
        ok: true,
        mode: "COPILOT",
        status: result.status,
        reason: result.reason ?? null,
        actions: result.actions.length,
      };
    } finally {
      await browser.close();
    }
  } catch (error) {
    // The claim must never outlive a failed attempt: the user can retry.
    await releaseApplication(application.id);
    await writeAudit({
      actor: "SYSTEM",
      action: "application.approve.failed",
      entityType: "Application",
      entityId: application.id,
      payload: { message: error instanceof Error ? error.message : "unknown error" },
    });
    return { ok: false, status: 500, error: "Approving the application failed" };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/** Each scheduled tick spends at most one submission per user. */
export const SCHEDULED_MAX_PER_USER = 1;

export interface SchedulingSettings {
  userId: string;
  mode: string;
  allowSubmit: boolean;
  killSwitch: boolean;
  perPortalMode: unknown;
}

/**
 * Pure predicate for the cron tick: a user is due only when Auto-Pilot is the
 * chosen mode, submissions are enabled, nothing is stopped and at least one
 * portal is unlocked. Anything else is ignored silently rather than guarded
 * per-posting, because a tick must not open a browser for a user who never
 * opted in.
 */
export function isScheduledCandidate(settings: SchedulingSettings): boolean {
  if (settings.mode !== "AUTOPILOT") return false;
  if (!settings.allowSubmit || settings.killSwitch) return false;
  const policies = settings.perPortalMode;
  if (typeof policies !== "object" || policies === null) return false;
  return Object.keys(policies as Record<string, unknown>).some(
    (portal) => readPortalPolicy(policies, portal) !== null,
  );
}

export interface ScheduledUserResult {
  userId: string;
  queued: number;
  submitted: number;
  paused: number;
  stopReason: string | null;
  error?: string;
}

export interface ScheduledRunReport {
  considered: number;
  due: number;
  submitted: number;
  users: ScheduledUserResult[];
}

export interface ScheduledRunDeps {
  listSettings: () => Promise<SchedulingSettings[]>;
  runForUser: (
    userId: string,
    limit: number,
  ) => Promise<{ queued: number; submitted: number; paused: number; stopReason: string | null }>;
  audit: (payload: Record<string, unknown>) => Promise<void>;
}

/**
 * One scheduler tick shared by the worker and the authenticated tick endpoint.
 * A failing user never blocks the rest, and the tick always writes one summary
 * audit row so a quiet schedule is distinguishable from a silent failure (I8).
 */
export async function runScheduledAutopilot(
  deps: ScheduledRunDeps,
  options: { limitPerUser?: number; now?: Date } = {},
): Promise<ScheduledRunReport> {
  const limit = options.limitPerUser ?? SCHEDULED_MAX_PER_USER;
  const all = await deps.listSettings();
  const due = all.filter(isScheduledCandidate);
  const users: ScheduledUserResult[] = [];
  let submitted = 0;

  for (const settings of due) {
    try {
      const result = await deps.runForUser(settings.userId, limit);
      submitted += result.submitted;
      users.push({
        userId: settings.userId,
        queued: result.queued,
        submitted: result.submitted,
        paused: result.paused,
        stopReason: result.stopReason,
      });
    } catch (error) {
      users.push({
        userId: settings.userId,
        queued: 0,
        submitted: 0,
        paused: 0,
        stopReason: null,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  await deps.audit({
    considered: all.length,
    due: due.length,
    submitted,
    ran: users.length,
    errors: users.filter((user) => user.error !== undefined).length,
    at: (options.now ?? new Date()).toISOString(),
  });

  return { considered: all.length, due: due.length, submitted, users };
}

/** Production wiring: real settings rows, the real run path, the real audit log. */
export async function runScheduledTick(
  options: { limitPerUser?: number; now?: Date } = {},
): Promise<ScheduledRunReport> {
  return runScheduledAutopilot(
    {
      listSettings: () => listSchedulingSettings(),
      runForUser: (userId, limit) => runAutopilotNow(userId, { limit }),
      audit: (payload) =>
        writeAudit({
          actor: "SYSTEM",
          action: "autopilot.tick",
          entityType: "Settings",
          payload,
        }),
    },
    options,
  );
}
