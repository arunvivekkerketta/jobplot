/**
 * packages/apply — shared vocabulary for the field mapper, the Answer Bank
 * resolver, the preflight stop gate and the fill planner.
 *
 * Nothing here touches the network or a browser. Every string that arrives from
 * a page is untrusted (I2), so descriptors keep both the raw label and the
 * delimiter-wrapped form; only the wrapped form may reach a prompt.
 */

export const CANONICAL_FIELDS = [
  "first_name",
  "last_name",
  "full_name",
  "email",
  "phone",
  "location",
  "linkedin",
  "website",
  "resume",
  "cover_letter",
  "work_auth",
  "years_experience",
  "salary_expectation",
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

/** Fields whose values may only come from an AnswerBankEntry the user entered (I5). */
export const SENSITIVE_FIELDS: ReadonlySet<CanonicalField> = new Set<CanonicalField>([
  "work_auth",
  "salary_expectation",
]);

/** One form control exactly as the browser saw it. All text is untrusted. */
export interface FieldDescriptor {
  label: string;
  name?: string;
  id?: string;
  autocomplete?: string;
  type?: string;
  required?: boolean;
}

export interface ClassifiedField extends FieldDescriptor {
  key: CanonicalField | null;
  sensitive: boolean;
  /** The only form of the label a prompt may ever receive (I2). */
  untrustedLabel: string;
  /** True when the label carried instruction-like text; such fields are never filled. */
  suspicious: boolean;
}

export interface AnswerBankEntryLike {
  key: string;
  questionPattern?: string | null;
  answer: string;
  sensitive?: boolean;
}

export type FillSource = "PROFILE" | "ANSWER_BANK" | "RESUME_VERSION";

export interface FillField {
  key: CanonicalField | null;
  label: string;
  untrustedLabel: string;
  action: "FILL" | "NEEDS_HUMAN" | "SKIP";
  source?: FillSource;
  value?: string;
  /** True when the value is a file to attach rather than text to type. */
  file?: boolean;
  reason?: string;
}

export interface FillPlan {
  fields: FillField[];
  fillable: FillField[];
  needsHuman: FillField[];
}

export interface StopSettings {
  killSwitch: boolean;
  allowSubmit: boolean;
  dailyCap: number;
  mode: string;
}

export type StopReason =
  | "KILL_SWITCH"
  | "DAILY_CAP"
  | "PORTAL_CAP"
  | "RATE_LIMIT"
  | "SUBMIT_DISABLED";

export interface PreflightInput {
  settings: StopSettings;
  /** Submissions recorded for this user since local midnight (not in-memory state). */
  submissionsToday: number;
  now: Date;
  /** Last browser action against the same host, if any. */
  lastActionAt?: Date | null;
  /** Minimum spacing between action batches on one host. Defaults to 30s. */
  domainMinIntervalMs?: number;
  perPortalCap?: number | null;
  perPortalSubmissionsToday?: number;
}

export type PreflightDecision =
  | { allowed: true }
  | { allowed: false; reason: StopReason; message: string; retryAfterMs?: number };