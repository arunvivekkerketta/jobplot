import type { JsonResumeProfile } from "@jobpilot/core";
import { answerFor } from "./answers.js";
import {
  SENSITIVE_FIELDS,
  type AnswerBankEntryLike,
  type CanonicalField,
  type ClassifiedField,
  type FillField,
  type FillPlan,
} from "./types.js";

type Basics = JsonResumeProfile["basics"];

export interface PlanInput {
  fields: readonly ClassifiedField[];
  profile: Pick<JsonResumeProfile, "basics">;
  answers?: readonly AnswerBankEntryLike[];
  /** True only when an approved ResumeVersion has a rendered PDF (gate 4.7). */
  resumeAvailable?: boolean;
}

function nameParts(fullName: string): { first: string | null; last: string | null } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts.at(0) ?? null;
  const rest = parts.slice(1).join(" ");
  return { first, last: rest.length > 0 ? rest : null };
}

function locationLine(basics: Basics): string | null {
  const location = basics.location;
  if (!location) return null;
  const parts = [location.city, location.region, location.country].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

function isLinkedIn(url: string | undefined): boolean {
  return typeof url === "string" && /linkedin\.com/i.test(url);
}

/**
 * Reads a value straight off the master profile. Anything not listed here has no
 * profile source at all: years of experience, salary expectations, work
 * authorization and cover letters must come from the Answer Bank or the human.
 */
function profileValue(key: CanonicalField, basics: Basics): string | null {
  switch (key) {
    case "first_name":
      return nameParts(basics.name).first;
    case "last_name":
      return nameParts(basics.name).last;
    case "full_name":
      return basics.name.trim().length > 0 ? basics.name : null;
    case "email":
      return basics.email.trim().length > 0 ? basics.email : null;
    case "phone":
      return basics.phone && basics.phone.trim().length > 0 ? basics.phone : null;
    case "location":
      return locationLine(basics);
    case "linkedin":
      return isLinkedIn(basics.url) && basics.url ? basics.url : null;
    case "website":
      return basics.url && !isLinkedIn(basics.url) ? basics.url : null;
    default:
      return null;
  }
}

function planField(field: ClassifiedField, input: PlanInput): FillField {
  const base = {
    key: field.key,
    label: field.label,
    untrustedLabel: field.untrustedLabel,
  };

  if (field.suspicious) {
    return {
      ...base,
      action: "NEEDS_HUMAN",
      reason: "label contained instruction-like text; treated as data (I2)",
    };
  }
  if (!field.key) {
    return { ...base, action: "NEEDS_HUMAN", reason: "unmapped form field" };
  }

  const key = field.key;
  const entry = answerFor(field, input.answers ?? []);

  if (key === "resume") {
    return input.resumeAvailable
      ? {
          ...base,
          action: "FILL",
          source: "RESUME_VERSION",
          file: true,
          reason: "attach the approved resume PDF",
        }
      : { ...base, action: "NEEDS_HUMAN", reason: "no approved resume version to attach" };
  }

  if (SENSITIVE_FIELDS.has(key)) {
    return entry
      ? { ...base, action: "FILL", source: "ANSWER_BANK", value: entry.answer }
      : {
          ...base,
          action: "NEEDS_HUMAN",
          reason: `sensitive question with no Answer Bank entry for "${key}" (I5)`,
        };
  }

  if (entry) {
    return { ...base, action: "FILL", source: "ANSWER_BANK", value: entry.answer };
  }

  const value = profileValue(key, input.profile.basics);
  if (value !== null) {
    return { ...base, action: "FILL", source: "PROFILE", value };
  }

  return { ...base, action: "NEEDS_HUMAN", reason: `no profile value for "${key}"` };
}

/**
 * Turns classified fields into an explicit per-field decision, so the runner
 * never improvises: each control is FILL with a known source, or NEEDS_HUMAN
 * with a reason the UI can show.
 */
export function buildFillPlan(input: PlanInput): FillPlan {
  const fields = input.fields.map((field) => planField(field, input));
  return {
    fields,
    fillable: fields.filter((field) => field.action === "FILL"),
    needsHuman: fields.filter((field) => field.action === "NEEDS_HUMAN"),
  };
}