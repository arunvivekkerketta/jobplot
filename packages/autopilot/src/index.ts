import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  canUnlockPortal,
  playwrightPage,
  readPortalPolicy,
  runAutopilot,
  selectAutopilotQueue,
  type AutopilotCandidate,
  type AutopilotOutcome,
  type PageLike,
  type SkippedCandidate,
} from "@jobpilot/apply";
import type { JsonResumeProfile } from "@jobpilot/core";
import {
  claimApplication,
  createApplication,
  listAnswers,
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
  lastRun: {
    at: string;
    submitted: number;
    paused: number;
    queued: number;
    stopReason: string | null;
  } | null;
}

interface StoredCandidate extends AutopilotCandidate {
  pdfPath: string | null;
}

function startOfToday(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
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
    where: { jobId: { in: matches.map((match) => match.job.id) } },
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
  const counts = await submissionCounts({ since: startOfToday() });
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

  const portals: PortalStatus[] = sources
    .map((row) => row.source)
    .sort()
    .map((portal) => {
      const policy = readPortalPolicy(settings.perPortalMode, portal);
      return {
        portal,
        unlocked: policy !== null,
        unlockedAt: policy?.unlockedAt ?? null,
        submissionsToday: counts.byPortal[portal] ?? 0,
        open: candidates.filter((candidate) => candidate.portal === portal).length,
      };
    });

  const lastAudit = await prisma.auditLog.findFirst({
    where: { action: "autopilot.run" },
    orderBy: { at: "desc" },
    select: { at: true, payload: true },
  });
  const payload = (lastAudit?.payload ?? null) as
    | { submitted?: number; paused?: number; queued?: number; stopReason?: string | null }
    | null;

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
    lastRun: lastAudit
      ? {
          at: lastAudit.at.toISOString(),
          submitted: payload?.submitted ?? 0,
          paused: payload?.paused ?? 0,
          queued: payload?.queued ?? 0,
          stopReason: payload?.stopReason ?? null,
        }
      : null,
  };
}

export type PortalUpdate =
  | { ok: true; portal: string; unlocked: boolean }
  | { ok: false; status: number; error: string };

/** Unlocking is refused unless submissions are enabled and nothing is stopped (7.1). */
export async function updatePortal(
  userId: string,
  portal: string,
  unlocked: boolean,
): Promise<PortalUpdate> {
  const settings = await settingsFor(userId);

  if (unlocked) {
    const decision = canUnlockPortal({
      allowSubmit: settings.allowSubmit,
      killSwitch: settings.killSwitch,
    });
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
  const settings = await settingsFor(userId);
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) throw new Error("Import a profile before running Auto-Pilot.");

  const counts = await submissionCounts({ since: startOfToday() });
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

  const answers = await listAnswers(userId);
  const tempFiles: string[] = [];
  const resumePaths = new Map<string, string>();
  for (const candidate of claimed) {
    const pdfPath = candidate.pdfPath;
    if (!pdfPath) continue;
    const documentId = pdfPath.split("/").pop();
    if (!documentId) continue;
    const stored = await readDocumentBytes({ id: documentId, userId });
    if (!stored) continue;
    const file = path.join(os.tmpdir(), `jobpilot-autopilot-${candidate.jobId}.pdf`);
    fs.writeFileSync(file, stored.bytes);
    tempFiles.push(file);
    resumePaths.set(candidate.jobId, file);
  }

  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (error) {
    // Nothing was applied, so the claims must not lock these postings out.
    await releaseClaims();
    await writeAudit({
      actor: "SYSTEM",
      action: "autopilot.unavailable",
      entityType: "Settings",
      entityId: userId,
      payload: { message: error instanceof Error ? error.message : "playwright missing" },
    });
    throw new BrowserUnavailableError(
      "The browser runtime is not installed, so Auto-Pilot cannot run.",
    );
  }

  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch();
  } catch (error) {
    await releaseClaims();
    await writeAudit({
      actor: "SYSTEM",
      action: "autopilot.unavailable",
      entityType: "Settings",
      entityId: userId,
      payload: { message: error instanceof Error ? error.message : "browser launch failed" },
    });
    throw new BrowserUnavailableError(
      "The browser could not be started, so Auto-Pilot cannot run.",
    );
  }
  try {
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
        const today = await submissionCounts({ since: startOfToday() });
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
      // Last chance to stop: the form is filled but nothing has been sent.
      beforeSubmit: async () => !(await settingsFor(userId)).killSwitch,
      onOutcome: async (outcome) => {
        const applicationId = applicationIds.get(outcome.jobId);
        if (!applicationId) return;
        await recordApplicationResult({
          applicationId,
          status: outcome.status,
          actions: outcome.actions,
          ...(outcome.reason ? { reason: outcome.reason } : {}),
          ...(outcome.submissionText ? { submissionText: outcome.submissionText } : {}),
        });
      },
    });

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
    for (const file of tempFiles) fs.rmSync(file, { force: true });
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
