import type { JsonResumeProfile } from "../profile/schema.js";
import { parseMonth } from "../profile/schema.js";
import type {
  MatchBreakdown,
  MatchContext,
  MatchJobInput,
  MatchResult,
  MatchWeights,
} from "./types.js";

/** Fixed weights: they must sum to 1 so the score is a real 0-100 percentage. */
export const MATCH_WEIGHTS: MatchWeights = {
  skills: 0.45,
  seniority: 0.2,
  location: 0.2,
  freshness: 0.15,
};

export const MATCH_ALGO_VERSION = 1;

const STOP_WORDS = new Set([
  "about", "after", "also", "and", "are", "but", "can", "company", "for",
  "from", "has", "have", "into", "its", "job", "more", "must", "not", "our",
  "role", "such", "team", "than", "that", "the", "their", "them", "then",
  "there", "these", "they", "this", "using", "was", "were", "will", "with",
  "work", "working", "years", "you", "your", "who", "what", "when", "where",
  "all", "any", "including", "plus", "strong", "good", "great", "least",
  "experience", "ability", "able", "knowledge", "understanding", "familiarity",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ""))
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function frequency(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

/** Every skill token the profile can attest to, from skills and their keywords. */
function profileVocabulary(profile: JsonResumeProfile): Set<string> {
  const vocabulary = new Set<string>();
  for (const skill of profile.skills) {
    for (const token of tokenize(skill.name)) vocabulary.add(token);
    for (const keyword of skill.keywords) {
      for (const token of tokenize(keyword.keyword)) vocabulary.add(token);
    }
  }
  for (const work of profile.work) {
    for (const token of tokenize(work.position)) vocabulary.add(token);
  }
  return vocabulary;
}

const YEARS_RE = /(\d{1,2})\s*(?:-\s*\d{1,2}\s*)?\+?\s*years?/i;

export function yearsRequiredBy(job: MatchJobInput): number | null {
  const match = YEARS_RE.exec(job.descriptionText);
  if (!match || !match[1]) return null;
  const years = Number(match[1]);
  return Number.isFinite(years) ? years : null;
}

/**
 * Total professional months, counted as the span from the earliest start date to
 * the latest end date (or the fixed clock). Overlapping roles are not
 * double-counted, so the number always matches the dates on the profile.
 */
export function candidateYears(profile: JsonResumeProfile, asOf?: Date): number | null {
  const starts = profile.work
    .map((work) => safeMonth(work.startDate))
    .filter((value): value is number => value !== null);
  if (starts.length === 0) return null;

  const ends = profile.work
    .map((work) => safeMonth(work.endDate))
    .filter((value): value is number => value !== null);
  const latestEnd = ends.length > 0 ? Math.max(...ends) : null;
  const clock = asOf ? asOf.getUTCFullYear() * 12 + asOf.getUTCMonth() : null;
  const end = Math.max(latestEnd ?? 0, clock ?? 0) || latestEnd;
  if (end === null || end === undefined) return null;

  const months = end - Math.min(...starts) + 1;
  return months > 0 ? Math.round((months / 12) * 10) / 10 : null;
}

function safeMonth(date?: string): number | null {
  if (!date) return null;
  try {
    return parseMonth(date);
  } catch {
    return null;
  }
}

function locationScore(job: MatchJobInput, profile: JsonResumeProfile): number {
  if (job.remote) return 100;
  const place = profile.basics.location;
  const profileTokens = new Set(
    tokenize([place?.city, place?.region, place?.country].filter(Boolean).join(" ")),
  );
  const jobTokens = new Set(tokenize(job.location ?? ""));
  if (jobTokens.size === 0) return 50;
  if (profileTokens.size === 0) return 0;
  for (const token of jobTokens) {
    if (profileTokens.has(token)) return 100;
  }
  return 0;
}

function freshnessScore(job: MatchJobInput, asOf?: Date): number {
  if (!job.postedAt) return 60;
  const posted = new Date(job.postedAt).getTime();
  if (Number.isNaN(posted)) return 60;
  const clock = asOf?.getTime() ?? posted;
  const ageDays = Math.max(0, (clock - posted) / 86_400_000);
  return Math.max(0, Math.round(100 - (ageDays / 30) * 100));
}

/**
 * Deterministic matcher. Pure: same profile, job and clock always produce the
 * same score, and every dimension is explained by the breakdown.
 */
export function scoreJob(
  profile: JsonResumeProfile,
  job: MatchJobInput,
  context: MatchContext = {},
): MatchResult {
  const jdTokens = tokenize(`${job.title} ${job.descriptionText}`);
  const counts = frequency(jdTokens);
  const requiredKeywords = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 40)
    .map(([token]) => token);

  const vocabulary = profileVocabulary(profile);
  const matchedSkills = requiredKeywords.filter((token) => vocabulary.has(token));
  const missingSkills = requiredKeywords.filter((token) => !vocabulary.has(token));
  const skills =
    requiredKeywords.length === 0
      ? 0
      : Math.round((matchedSkills.length / requiredKeywords.length) * 100);

  const yearsRequired = yearsRequiredBy(job);
  const years = candidateYears(profile, context.asOf);
  let seniority: number;
  if (yearsRequired === null) {
    // The posting asks for no specific seniority, so there is nothing to miss.
    seniority = 100;
  } else if (years === null) {
    seniority = 0;
  } else {
    seniority = Math.min(100, Math.round((years / yearsRequired) * 100));
  }

  const breakdown: MatchBreakdown = {
    skills,
    seniority,
    location: locationScore(job, profile),
    freshness: freshnessScore(job, context.asOf),
  };

  const weighted =
    breakdown.skills * MATCH_WEIGHTS.skills +
    breakdown.seniority * MATCH_WEIGHTS.seniority +
    breakdown.location * MATCH_WEIGHTS.location +
    breakdown.freshness * MATCH_WEIGHTS.freshness;

  return {
    score: Math.max(0, Math.min(100, Math.round(weighted))),
    breakdown,
    weights: MATCH_WEIGHTS,
    requiredKeywords,
    matchedSkills,
    missingSkills,
    yearsRequired,
    candidateYears: years,
  };
}

/** Threshold gate shared by the API, the UI and the worker queue (gate 5.2). */
export function meetsThreshold(score: number, threshold: number): boolean {
  return score >= threshold;
}