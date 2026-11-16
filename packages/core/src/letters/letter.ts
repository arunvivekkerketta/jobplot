import { z } from "zod";
import type { JsonResumeProfile } from "../profile/schema.js";

export const LETTER_KINDS = ["COVER_LETTER", "COLD_EMAIL", "OFFER_REPLY"] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];

/**
 * The only shape a drafted letter may take. `claims` is not decoration: it is
 * the list of profile facts the model says it used, and every one of them is
 * re-checked against the profile before the text is shown or stored (I1).
 */
export const letterDraftSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  paragraphs: z.array(z.string().trim().min(1).max(1200)).min(1).max(8),
  claims: z.array(z.string().trim().min(1).max(120)).max(40).default([]),
});

export type LetterDraftBody = z.infer<typeof letterDraftSchema>;

export interface LetterDraft extends LetterDraftBody {
  kind: LetterKind;
}

/**
 * A draft is a draft, and a mock offer is a mock (I6). There is no parameter to
 * change this: the renderer derives the mark from the kind alone.
 */
export function letterWatermark(kind: LetterKind): "DRAFT" | "SAMPLE" {
  return kind === "OFFER_REPLY" ? "SAMPLE" : "DRAFT";
}

/** Human title for a kind, used by the UI and by the notification text. */
export function letterTitle(kind: LetterKind): string {
  switch (kind) {
    case "COVER_LETTER":
      return "Cover letter";
    case "COLD_EMAIL":
      return "Cold email";
    case "OFFER_REPLY":
      return "Offer reply";
  }
}

/**
 * The plain-text artifact. The watermark is written at the top and the bottom on
 * every call, so no code path can hand the user an unmarked draft.
 */
export function formatLetter(draft: LetterDraft): string {
  const mark = letterWatermark(draft.kind);
  return [
    `[${mark}] ${letterTitle(draft.kind)}`,
    "",
    `Subject: ${draft.subject}`,
    "",
    ...draft.paragraphs,
    "",
    `[${mark}] This is a ${mark === "SAMPLE" ? "sample" : "draft"} — review every claim before sending.`,
  ].join("\n");
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, out);
  } else if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) collectStrings(entry, out);
  }
  return out;
}

const norm = (value: string): string => value.toLowerCase().replace(/\s+/g, " ").trim();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type LetterIssueCode = "UNKNOWN_CLAIM" | "UNKNOWN_NUMBER";

export interface LetterIssue {
  code: LetterIssueCode;
  value: string;
}

export interface LetterCheck {
  ok: boolean;
  issues: LetterIssue[];
  checkedClaims: number;
}

/**
 * I1 for prose. A letter is free text, so it is checked on the two things that
 * can be objectively wrong: a named claim the profile cannot support, and any
 * number (years, team size, percentages, revenue) that appears nowhere in the
 * profile.
 *
 * The check is deliberately conservative in the user's favour on ordinary
 * words: a claim passes when any distinctive word in it (3+ letters) occurs in
 * the profile, but a number in the body must occur in the profile exactly.
 */
/**
 * The Answer Bank keys that hold prose rather than a short field answer. Saving
 * one of these is the moment a letter would become text the runner types into an
 * employer's form, so that is where the claims are re-checked (I1).
 */
const LETTER_ANSWER_KEYS = new Set(["cover letter", "cold email", "offer reply"]);

export function isLetterAnswerKey(key: string): boolean {
  const normalized = key
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return LETTER_ANSWER_KEYS.has(normalized);
}

export class LetterClaimError extends Error {
  constructor(readonly check: LetterCheck) {
    super("The draft contains claims the profile cannot support.");
    this.name = "LetterClaimError";
  }
}

export function recheckLetterClaims(
  profile: JsonResumeProfile,
  draft: Pick<LetterDraftBody, "paragraphs" | "claims">,
): LetterCheck {
  const strings = collectStrings(profile).map(norm).filter(Boolean);
  const corpus = strings.join("\n");
  const numbers = new Set<string>();
  for (const text of strings) {
    for (const match of text.match(/\d+(?:\.\d+)?/g) ?? []) numbers.add(match);
  }

  const issues: LetterIssue[] = [];
  let checkedClaims = 0;

  const hasWord = (word: string): boolean =>
    new RegExp(`(^|[^a-z0-9])${escapeRegExp(word)}([^a-z0-9]|$)`, "i").test(corpus);

  for (const claim of draft.claims) {
    checkedClaims += 1;
    const normalized = norm(claim);
    if (!normalized) continue;

    const claimNumbers = normalized.match(/\d+(?:\.\d+)?/g) ?? [];
    const missingNumber = claimNumbers.find((number) => !numbers.has(number));
    if (missingNumber) {
      issues.push({ code: "UNKNOWN_NUMBER", value: missingNumber });
      continue;
    }

    const words = normalized.split(/[^a-z]+/i).filter((word) => word.length >= 3);
    if (words.length > 0 && !words.some(hasWord)) {
      issues.push({ code: "UNKNOWN_CLAIM", value: claim });
    }
  }

  // Every number in the body has to be present in the profile as well, so an
  // invented metric cannot ride along inside a sentence nobody labelled a claim.
  for (const paragraph of draft.paragraphs) {
    for (const number of paragraph.match(/\d+(?:\.\d+)?/g) ?? []) {
      checkedClaims += 1;
      if (!numbers.has(number)) {
        issues.push({ code: "UNKNOWN_NUMBER", value: number });
      }
    }
  }

  return { ok: issues.length === 0, issues, checkedClaims };
}
