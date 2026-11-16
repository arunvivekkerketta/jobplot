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
  | {
      ok: false;
      reason: "KILL_SWITCH" | "SUBMIT_DISABLED" | "TRUST_LADDER";
      message: string;
    };

/**
 * A portal is earned, not chosen: this many applications the user approved
 * themselves in Co-Pilot mode are required before it may run unattended (4.2).
 */
export const TRUST_LADDER_MIN = 3;

export interface TrustState {
  approved: number;
  required: number;
  remaining: number;
  earned: boolean;
}

/**
 * Progress towards the trust ladder. The ONLY input is the number of stored
 * SUBMITTED Co-Pilot applications for that portal, so no UI state or request body
 * can talk a portal into being unlocked.
 */
export function trustState(approved: number, required = TRUST_LADDER_MIN): TrustState {
  const safe = Number.isFinite(approved) && approved > 0 ? Math.floor(approved) : 0;
  return {
    approved: safe,
    required,
    remaining: Math.max(0, required - safe),
    earned: safe >= required,
  };
}

/**
 * Unlocking a portal hands it unattended submission, so it is refused while the
 * master switch is off, while the kill switch is on (I3/I4), and until the user
 * has approved enough Co-Pilot applications on that portal themselves (4.2).
 */
export function canUnlockPortal(
  settings: { allowSubmit: boolean; killSwitch: boolean },
  trust: { approved: number },
): UnlockDecision {
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

  const state = trustState(trust.approved);
  if (!state.earned) {
    return {
      ok: false,
      reason: "TRUST_LADDER",
      message:
        `Approve ${state.remaining} more Co-Pilot application(s) on this portal before ` +
        `unlocking it (${state.approved} of ${state.required}).`,
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
  /**
   * The questions only a human could answer, without any value: the key, and the
   * planner's own reason. The label is page text (I2), so it stays out of here —
   * the Answer Bank coverage report only needs to know which key was missing.
   */
  needsHuman: Array<{ key: string | null; reason: string }>;
}

export interface RunAutopilotOptions {
  targets: readonly AutopilotTarget[];
  openPage: () => Promise<AutopilotPage>;
  profile: Pick<JsonResumeProfile, "basics">;
  answers?: readonly AnswerBankEntryLike[];
  /**
   * Built per target so a cap, or a kill switch flipped during the run, stops the
   * next one. It may be async because the caller must re-read stored settings.
   */
  preflightFor: (target: AutopilotTarget, index: number) => PreflightInput | Promise<PreflightInput>;
  /** Waits out a short per-host interval; tests pass a fake so no test sleeps. */
  sleep?: (ms: number) => Promise<void>;
  /** Re-checked inside the runner immediately before the submit click (I4). */
  beforeSubmit?: (target: AutopilotTarget) => Promise<boolean>;
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
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (const [index, target] of options.targets.entries()) {
    if (index >= max) break;

    let decision = evaluatePreflight(await options.preflightFor(target, index));
    // A wait this short is just spacing between postings on one host; anything
    // longer means the run should stop rather than hold a browser open.
    if (
      !decision.allowed &&
      decision.reason === "RATE_LIMIT" &&
      decision.retryAfterMs !== undefined &&
      decision.retryAfterMs <= 60_000
    ) {
      await sleep(decision.retryAfterMs);
      decision = evaluatePreflight(await options.preflightFor(target, index));
    }
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
        ...(options.beforeSubmit
          ? { beforeSubmit: () => options.beforeSubmit!(target) }
          : {}),
      });
      const outcome: AutopilotOutcome = {
        jobId: target.jobId,
        portal: target.portal,
        status: result.status,
        actions: result.actions,
        needsHuman: result.needsHuman.map((field) => ({
          key: field.key,
          reason: field.reason ?? "needs a human answer",
        })),
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
        needsHuman: [],
      };
      outcomes.push(outcome);
      await options.onOutcome?.(outcome);
    } finally {
      await page.close();
    }
  }

  return { outcomes };
}