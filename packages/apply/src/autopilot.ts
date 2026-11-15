import { evaluatePreflight } from "./preflight.js";
import { runApplication, type RunAction, type RunResult, type RunnerPage } from "./runner.js";
import type { AnswerBankEntryLike, PreflightInput, StopSettings } from "./types.js";
import type { JsonResumeProfile } from "@jobpilot/core";

export interface PortalPolicy {
  mode: "AUTOPILOT";
  unlockedAt: string;
}

export type PortalPolicies = Record<string, PortalPolicy | undefined>;

/** Reads one portal's policy out of Settings.perPortalMode (untrusted JSON). */
export function readPortalPolicy(policies: unknown, portal: string): PortalPolicy | null {
  if (typeof policies !== "object" || policies === null) return null;
  const entry = (policies as Record<string, unknown>)[portal];
  if (typeof entry !== "object" || entry === null) return null;
  const mode = (entry as { mode?: unknown }).mode;
  const unlockedAt = (entry as { unlockedAt?: unknown }).unlockedAt;
  if (mode !== "AUTOPILOT" || typeof unlockedAt !== "string") return null;
  return { mode: "AUTOPILOT", unlockedAt };
}

export function isPortalUnlocked(policies: unknown, portal: string): boolean {
  return readPortalPolicy(policies, portal) !== null;
}

export type UnlockDecision =
  | { ok: true }
  | { ok: false; reason: "KILL_SWITCH" | "SUBMIT_DISABLED"; message: string };

/**
 * Unlocking a portal hands it unattended submission, so it is refused while the
 * master switch is off or the kill switch is on (I3/I4).
 */
export function canUnlockPortal(settings: {
  allowSubmit: boolean;
  killSwitch: boolean;
}): UnlockDecision {
  if (settings.killSwitch) {
    return {
      ok: false,
      reason: "KILL_SWITCH",
      message: "Turn the kill switch off before unlocking a portal.",
    };
  }
  if (!settings.allowSubmit) {
    return {
      ok: false,
      reason: "SUBMIT_DISABLED",
      message: "allowSubmit is off, so Auto-Pilot could only fill forms, never send them.",
    };
  }
  return { ok: true };
}

export interface AutopilotCandidate {
  jobId: string;
  portal: string;
  title: string;
  url: string;
  score: number;
  /** Set when an approved resume version covers this posting. */
  resumeVersionId: string | null;
}

export type SkipReason =
  | "KILL_SWITCH"
  | "SUBMIT_DISABLED"
  | "BELOW_THRESHOLD"
  | "PORTAL_LOCKED"
  | "NO_APPROVED_RESUME"
  | "DAILY_CAP"
  | "PORTAL_CAP"
  | "RATE_LIMIT"
  | "RUN_LIMIT";

export interface SkippedCandidate {
  jobId: string;
  portal: string;
  title: string;
  reason: SkipReason;
  message: string;
}

export interface SelectAutopilotInput {
  policies: unknown;
  settings: StopSettings & { allowSubmit: boolean; killSwitch: boolean };
  threshold: number;
  candidates: readonly AutopilotCandidate[];
  submissionsToday: number;
  perPortalToday?: Record<string, number>;
  lastActionAt?: Record<string, Date | undefined>;
  now: Date;
  perPortalCap?: number | null;
  domainMinIntervalMs?: number;
  limit?: number;
}

export interface SelectAutopilotResult {
  eligible: AutopilotCandidate[];
  skipped: SkippedCandidate[];
}

/**
 * The queue is decided before any browser opens: every posting either becomes
 * eligible or carries exactly one reason it was skipped, and the counts include
 * the postings already accepted in this selection so a run cannot overshoot a cap
 * by planning them all at once (gate 7.2/7.3).
 */
export function selectAutopilotQueue(input: SelectAutopilotInput): SelectAutopilotResult {
  const eligible: AutopilotCandidate[] = [];
  const skipped: SkippedCandidate[] = [];
  const limit = input.limit ?? 3;
  const perPortalToday: Record<string, number> = { ...(input.perPortalToday ?? {}) };
  const acceptedByPortal: Record<string, number> = {};
  let submissionsToday = input.submissionsToday;

  const skip = (
    candidate: AutopilotCandidate,
    reason: SkipReason,
    message: string,
  ): void => {
    skipped.push({
      jobId: candidate.jobId,
      portal: candidate.portal,
      title: candidate.title,
      reason,
      message,
    });
  };

  if (input.settings.killSwitch) {
    for (const candidate of input.candidates) {
      skip(candidate, "KILL_SWITCH", "Kill switch is on; nothing may be submitted.");
    }
    return { eligible, skipped };
  }
  if (!input.settings.allowSubmit) {
    for (const candidate of input.candidates) {
      skip(candidate, "SUBMIT_DISABLED", "allowSubmit is off; Auto-Pilot is paused.");
    }
    return { eligible, skipped };
  }

  for (const candidate of input.candidates) {
    if (candidate.score < input.threshold) {
      skip(
        candidate,
        "BELOW_THRESHOLD",
        `Score ${candidate.score} is below the ${input.threshold} threshold.`,
      );
      continue;
    }
    if (!isPortalUnlocked(input.policies, candidate.portal)) {
      skip(candidate, "PORTAL_LOCKED", `Portal ${candidate.portal} is not unlocked.`);
      continue;
    }
    if (!candidate.resumeVersionId) {
      skip(candidate, "NO_APPROVED_RESUME", "No approved resume version covers this posting.");
      continue;
    }
    if (eligible.length >= limit) {
      skip(candidate, "RUN_LIMIT", `This run is limited to ${limit} application(s).`);
      continue;
    }

    const preflight: PreflightInput = {
      settings: input.settings,
      submissionsToday,
      now: input.now,
      perPortalCap: input.perPortalCap ?? null,
      perPortalSubmissionsToday:
        (perPortalToday[candidate.portal] ?? 0) + (acceptedByPortal[candidate.portal] ?? 0),
      ...(input.lastActionAt?.[candidate.portal]
        ? { lastActionAt: input.lastActionAt[candidate.portal] } : {}),
      ...(input.domainMinIntervalMs !== undefined
        ? { domainMinIntervalMs: input.domainMinIntervalMs } : {}),
    };
    const decision = evaluatePreflight(preflight);
    if (!decision.allowed) {
      const reason =
        decision.reason === "DAILY_CAP"
          ? "DAILY_CAP"
          : decision.reason === "PORTAL_CAP"
            ? "PORTAL_CAP"
            : decision.reason === "RATE_LIMIT"
              ? "RATE_LIMIT"
              : decision.reason === "KILL_SWITCH"
                ? "KILL_SWITCH"
                : "SUBMIT_DISABLED";
      skip(candidate, reason, decision.message);
      continue;
    }

    eligible.push(candidate);
    submissionsToday += 1;
    acceptedByPortal[candidate.portal] = (acceptedByPortal[candidate.portal] ?? 0) + 1;
  }

  return { eligible, skipped };
}

export interface AutopilotPage extends RunnerPage {
  close(): Promise<void>;
}

export interface AutopilotTarget {
  jobId: string;
  portal: string;
  url: string;
  /** Absolute path of the approved resume, when one is attached. */
  resumePath?: string;
}

export interface AutopilotOutcome {
  jobId: string;
  portal: string;
  status: RunResult["status"] | "ERROR";
  reason?: string;
  actions: RunAction[];
  submissionText?: string;
}

export interface RunAutopilotOptions {
  targets: readonly AutopilotTarget[];
  openPage: () => Promise<AutopilotPage>;
  profile: Pick<JsonResumeProfile, "basics">;
  answers?: readonly AnswerBankEntryLike[];
  /** Built per target so a cap that fills mid-run stops the next one. */
  preflightFor: (target: AutopilotTarget, index: number) => PreflightInput;
  onOutcome?: (outcome: AutopilotOutcome) => Promise<void>;
  maxApplications?: number;
}

export interface AutopilotReport {
  outcomes: AutopilotOutcome[];
  stopReason?: string;
}

/**
 * Runs the queue unattended: no consent prompt per form because the portal was
 * unlocked, but the stop gate is re-evaluated before every single application, so
 * a cap reached mid-run stops the loop instead of the next form (gate 7.4).
 */
export async function runAutopilot(options: RunAutopilotOptions): Promise<AutopilotReport> {
  const outcomes: AutopilotOutcome[] = [];
  const max = options.maxApplications ?? options.targets.length;

  for (const [index, target] of options.targets.entries()) {
    if (index >= max) break;

    const decision = evaluatePreflight(options.preflightFor(target, index));
    if (!decision.allowed) {
      return { outcomes, stopReason: decision.reason };
    }

    const page = await options.openPage();
    try {
      const result = await runApplication({
        page,
        url: target.url,
        profile: options.profile,
        answers: options.answers ?? [],
        ...(target.resumePath ? { resumePath: target.resumePath } : {}),
      });
      const outcome: AutopilotOutcome = {
        jobId: target.jobId,
        portal: target.portal,
        status: result.status,
        actions: result.actions,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.submissionText ? { submissionText: result.submissionText } : {}),
      };
      outcomes.push(outcome);
      await options.onOutcome?.(outcome);
    } catch (error) {
      // One unreachable posting must not abandon the rest of the batch.
      const outcome: AutopilotOutcome = {
        jobId: target.jobId,
        portal: target.portal,
        status: "ERROR",
        reason: error instanceof Error ? error.message : "unknown browser error",
        actions: [],
      };
      outcomes.push(outcome);
      await options.onOutcome?.(outcome);
    } finally {
      await page.close();
    }
  }

  return { outcomes };
}