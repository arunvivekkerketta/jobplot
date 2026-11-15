import {
  buildResumeDocument,
  resumeDocumentText,
  type JsonResumeProfile,
  type ResumeDocument,
  type ResumeRole,
} from "@jobpilot/core";
import { lintResumeDocument, type AtsReport } from "./ats.js";

export interface KeywordReport {
  initialCoverage: number;
  finalCoverage: number;
  floor: number;
  target: number;
  iterations: number;
  required: string[];
  matched: string[];
  missing: string[];
  trimmedHighlights: number;
  restoredHighlights: number;
}

export interface TailorResult {
  document: ResumeDocument;
  ats: AtsReport;
  keywordReport: KeywordReport;
}

export interface TailorOptions {
  /** Coverage the trimmed document must keep. Defaults to the initial coverage. */
  floor?: number;
  /** Coverage to aim for while shrinking. Defaults to the floor. */
  target?: number;
  maxHighlightsPerRole?: number;
  maxIterations?: number;
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .filter((token) => token.length >= 3),
  );
}

function hits(text: string, required: readonly string[]): number {
  const tokens = tokenSet(text);
  let count = 0;
  for (const keyword of required) if (tokens.has(keyword)) count += 1;
  return count;
}

function countHighlights(doc: ResumeDocument): number {
  return doc.roles.reduce((sum, role) => sum + role.highlights.length, 0);
}

/**
 * Keeps the bullets that speak to the posting, in relevance order, but never
 * rewrites one: the strings are the profile's own (I1). Roles keep their dates
 * and titles so claim validation can still match them.
 */
function trimRoles(
  doc: ResumeDocument,
  required: readonly string[],
  maxPerRole: number,
): ResumeDocument {
  const roles: ResumeRole[] = doc.roles.map((role) => {
    const ranked = role.highlights
      .map((text, index) => ({ text, index, score: hits(text, required) }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const keep = ranked.slice(0, Math.max(1, maxPerRole)).sort((a, b) => a.index - b.index);
    return { ...role, highlights: keep.map((entry) => entry.text) };
  });

  return { ...doc, roles };
}

function restoredDocument(
  trimmed: ResumeDocument,
  original: ResumeDocument,
  required: readonly string[],
  count: number,
): ResumeDocument {
  // Candidates are bullets that were trimmed away, best first.
  const candidates: Array<{ company: string; text: string; score: number; index: number }> = [];
  for (const role of original.roles) {
    const kept = new Set(
      trimmed.roles.find((candidate) => candidate.company === role.company)?.highlights ?? [],
    );
    for (const [index, text] of role.highlights.entries()) {
      if (kept.has(text)) continue;
      candidates.push({ company: role.company, text, score: hits(text, required), index });
    }
  }

  const chosen = candidates
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, count);

  const roles = trimmed.roles.map((role) => {
    const additions = chosen.filter((entry) => entry.company === role.company);
    if (additions.length === 0) return role;
    const originalOrder = original.roles.find((entry) => entry.company === role.company)?.highlights ?? [];
    const allowed = new Set([...role.highlights, ...additions.map((entry) => entry.text)]);
    return {
      ...role,
      highlights: originalOrder.filter((text) => allowed.has(text)),
    };
  });

  return { ...trimmed, roles };
}

/**
 * Deterministic tailoring: select and order existing facts for one posting,
 * then restore trimmed bullets until the coverage floor is met. Nothing is
 * generated, so a keyword the profile cannot attest to can never appear.
 */
export function tailorDocument(
  profile: JsonResumeProfile,
  jobDescription: string,
  options: TailorOptions = {},
): TailorResult {
  const original = buildResumeDocument(profile);
  const originalAts = lintResumeDocument(original, { jobDescription });
  const initialCoverage = originalAts.keywordCoverage?.coverage ?? 100;
  const required = originalAts.keywordCoverage?.required ?? [];

  const floor = options.floor ?? initialCoverage;
  const target = options.target ?? floor;
  const maxIterations = options.maxIterations ?? 2;
  const maxHighlightsPerRole = options.maxHighlightsPerRole ?? 4;

  let trimmed = trimRoles(original, required, maxHighlightsPerRole);
  let coverage = lintResumeDocument(trimmed, { jobDescription }).keywordCoverage?.coverage ?? 100;
  let iterations = 0;
  let restoredHighlights = 0;

  while (coverage < floor && iterations < maxIterations) {
    iterations += 1;
    const missingCount = Math.max(1, Math.ceil((floor - coverage) / 10));
    const restored = restoredDocument(trimmed, original, required, missingCount);
    const restoredCoverage =
      lintResumeDocument(restored, { jobDescription }).keywordCoverage?.coverage ?? coverage;
    if (restoredCoverage <= coverage) break;
    const restoredCount = countHighlights(restored) - countHighlights(trimmed);
    trimmed = restored;
    coverage = restoredCoverage;
    restoredHighlights += restoredCount;
    if (coverage >= target && coverage >= floor) break;
  }

  const ats = lintResumeDocument(trimmed, { jobDescription });
  const finalCoverage = ats.keywordCoverage?.coverage ?? coverage;

  return {
    document: trimmed,
    ats,
    keywordReport: {
      initialCoverage,
      finalCoverage,
      floor,
      target,
      iterations,
      required,
      matched: ats.keywordCoverage?.matched ?? [],
      missing: ats.keywordCoverage?.missing ?? [],
      trimmedHighlights: countHighlights(original) - countHighlights(trimmed),
      restoredHighlights,
    },
  };
}

/** Text of the tailored document, for callers that only need the claims. */
export function tailoredText(document: ResumeDocument): string {
  return resumeDocumentText(document);
}