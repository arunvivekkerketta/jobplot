import type { AnswerBankEntryLike, ClassifiedField } from "./types.js";

/** `work_auth`, `workAuth` and `Work Authorization` all normalize alike. */
export function normalizeAnswerKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function patternMatches(pattern: string, label: string): boolean {
  try {
    return new RegExp(pattern, "i").test(label);
  } catch {
    // A malformed pattern is a user data problem, never a crash mid-application.
    return false;
  }
}

/**
 * Resolves a field against the calling user's Answer Bank entries (I5).
 *
 * Order: exact canonical key, then `questionPattern` over the raw label. Two
 * different patterns matching the same question is ambiguous, so the field is
 * left to the human rather than picking one.
 */
export function answerFor(
  field: ClassifiedField,
  entries: readonly AnswerBankEntryLike[],
): AnswerBankEntryLike | null {
  if (field.key) {
    const wanted = normalizeAnswerKey(field.key);
    const exact = entries.find((entry) => normalizeAnswerKey(entry.key) === wanted);
    if (exact) return exact;
  }

  const patterned = entries.filter(
    (entry) => !!entry.questionPattern && patternMatches(entry.questionPattern, field.label),
  );
  if (patterned.length === 1) return patterned.at(0) ?? null;
  if (patterned.length > 1) {
    const sensitive = patterned.filter((entry) => entry.sensitive);
    return sensitive.length === 1 ? (sensitive.at(0) ?? null) : null;
  }
  return null;
}