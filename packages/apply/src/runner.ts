import type { JsonResumeProfile } from "@jobpilot/core";
import { classifyFields } from "./fields.js";
import { buildFillPlan } from "./plan.js";
import { evaluatePreflight } from "./preflight.js";
import type { AnswerBankEntryLike, FillField, PreflightInput } from "./types.js";

/** One form control as the browser saw it (untrusted text, I2). */
export interface RawControl {
  index: number;
  label: string;
  name: string;
  id: string;
  autocomplete: string;
  type: string;
}

/**
 * The browser port. `playwrightPage()` implements it on top of a Playwright page;
 * unit tests implement it with a state machine, so the runner's control flow is
 * proven without a browser or a network call.
 */
export interface RunnerPage {
  goto(url: string): Promise<void>;
  controls(): Promise<RawControl[]>;
  buttonIndices(pattern: string): Promise<number[]>;
  fill(control: RawControl, value: string): Promise<void>;
  attach(control: RawControl, path: string): Promise<void>;
  clickButton(index: number): Promise<void>;
  bodyText(): Promise<string>;
}

export type ActionKind =
  | "NAVIGATE"
  | "FILL"
  | "ATTACH"
  | "CLICK"
  | "SUBMIT"
  | "PAUSE"
  | "BLOCK";

export interface RunAction {
  kind: ActionKind;
  detail: string;
  field?: string;
}

export type RunStatus = "SUBMITTED" | "PAUSED_NEEDS_HUMAN" | "BLOCKED";

export interface RunResult {
  status: RunStatus;
  reason?: string;
  actions: RunAction[];
  needsHuman: FillField[];
  submissionText?: string;
}

export interface RunOptions {
  page: RunnerPage;
  url: string;
  profile: Pick<JsonResumeProfile, "basics">;
  answers?: readonly AnswerBankEntryLike[];
  /** Absolute path of the approved resume, when one exists. */
  resumePath?: string;
  preflight?: PreflightInput;
  maxSteps?: number;
}

const CONFIRMATION_RE = /(application received|submitted successfully|thanks for applying)/i;

/**
 * Anything that means a human must take over (I4). CAPTCHA and session expiry are
 * checked before the password field, because an expired form often also asks the
 * user to sign in again.
 */
async function detectPause(page: RunnerPage): Promise<string | null> {
  const text = await page.bodyText();
  if (/(captcha|complete the challenge)/i.test(text)) return "CAPTCHA";
  if (/(session (has )?expired|sign in again)/i.test(text)) return "SESSION_EXPIRED";
  if (/(two-factor|2fa|verification code)/i.test(text)) return "TWO_FACTOR";

  const controls = await page.controls();
  if (controls.some((control) => control.type === "password")) return "LOGIN_WALL";
  return null;
}

/**
 * Drives one application form. The stop gate runs before the first navigation,
 * unresolved fields pause the run before any button is clicked, and every action
 * is returned so the caller can audit it (I8).
 */
export async function runApplication(options: RunOptions): Promise<RunResult> {
  const actions: RunAction[] = [];
  const record = (action: RunAction): void => {
    actions.push(action);
  };

  if (options.preflight) {
    const decision = evaluatePreflight(options.preflight);
    if (!decision.allowed) {
      record({ kind: "BLOCK", detail: `${decision.reason}: ${decision.message}` });
      return { status: "BLOCKED", reason: decision.reason, actions, needsHuman: [] };
    }
  }

  await options.page.goto(options.url);
  record({ kind: "NAVIGATE", detail: options.url });

  const initialPause = await detectPause(options.page);
  if (initialPause) {
    record({ kind: "PAUSE", detail: initialPause });
    return { status: "PAUSED_NEEDS_HUMAN", reason: initialPause, actions, needsHuman: [] };
  }

  const maxSteps = options.maxSteps ?? 5;
  let needsHuman: FillField[] = [];

  for (let step = 1; step <= maxSteps; step += 1) {
    const controls = await options.page.controls();
    const plan = buildFillPlan({
      fields: classifyFields(
        controls.map((control) => ({
          label: control.label,
          name: control.name,
          id: control.id,
          autocomplete: control.autocomplete,
          type: control.type,
        })),
      ),
      profile: options.profile,
      answers: options.answers ?? [],
      resumeAvailable: options.resumePath !== undefined,
    });
    needsHuman = plan.needsHuman;

    for (const [position, field] of plan.fields.entries()) {
      const control = controls[position];
      if (!control || field.action !== "FILL") continue;

      if (field.file) {
        if (options.resumePath === undefined) continue;
        await options.page.attach(control, options.resumePath);
        record({ kind: "ATTACH", detail: options.resumePath, field: field.label });
        continue;
      }
      if (field.value === undefined) continue;
      await options.page.fill(control, field.value);
      record({ kind: "FILL", detail: field.source ?? "PROFILE", field: field.label });
    }

    // Nothing is clicked while a question is unresolved, so a partially filled
    // form can never reach the employer.
    if (needsHuman.length > 0) {
      record({ kind: "PAUSE", detail: "NEEDS_HUMAN_FIELDS" });
      return {
        status: "PAUSED_NEEDS_HUMAN",
        reason: "NEEDS_HUMAN_FIELDS",
        actions,
        needsHuman,
      };
    }

    const nextIndices = await options.page.buttonIndices("next|continue");
    const submitIndices = await options.page.buttonIndices("submit|apply|send application");
    const nextIndex = nextIndices.at(0);
    const submitIndex = submitIndices.at(0);

    // A "next" control only advances when there is no submit control on the page.
    if (nextIndex !== undefined && submitIndex === undefined) {
      await options.page.clickButton(nextIndex);
      record({ kind: "CLICK", detail: `next step ${step}` });
      const submitted = await options.page.bodyText();
      if (CONFIRMATION_RE.test(submitted)) {
        return { status: "SUBMITTED", actions, needsHuman, submissionText: submitted.slice(0, 500) };
      }
      const paused = await detectPause(options.page);
      if (paused) {
        record({ kind: "PAUSE", detail: paused });
        return { status: "PAUSED_NEEDS_HUMAN", reason: paused, actions, needsHuman };
      }
      continue;
    }

    if (submitIndex === undefined) {
      record({ kind: "PAUSE", detail: "NO_SUBMIT_CONTROL" });
      return { status: "PAUSED_NEEDS_HUMAN", reason: "NO_SUBMIT_CONTROL", actions, needsHuman };
    }

    await options.page.clickButton(submitIndex);
    record({ kind: "SUBMIT", detail: options.url });
    const afterSubmit = await options.page.bodyText();
    if (CONFIRMATION_RE.test(afterSubmit)) {
      return {
        status: "SUBMITTED",
        actions,
        needsHuman,
        submissionText: afterSubmit.slice(0, 500),
      };
    }
    record({ kind: "PAUSE", detail: "CONFIRMATION_MISSING" });
    return { status: "PAUSED_NEEDS_HUMAN", reason: "CONFIRMATION_MISSING", actions, needsHuman };
  }

  record({ kind: "PAUSE", detail: "STEP_LIMIT" });
  return { status: "PAUSED_NEEDS_HUMAN", reason: "STEP_LIMIT", actions, needsHuman };
}