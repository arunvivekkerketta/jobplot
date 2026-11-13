/** Inputs and outputs of the deterministic matcher (Phase 5). */

export interface MatchJobInput {
  title: string;
  company: string;
  descriptionText: string;
  location?: string | null;
  remote?: boolean;
  postedAt?: string | null;
}

export interface MatchBreakdown {
  skills: number;
  seniority: number;
  location: number;
  freshness: number;
}

export type MatchWeights = MatchBreakdown;

export interface MatchResult {
  /** Weighted 0-100 score, rounded to an integer. */
  score: number;
  breakdown: MatchBreakdown;
  weights: MatchWeights;
  requiredKeywords: string[];
  matchedSkills: string[];
  missingSkills: string[];
  yearsRequired: number | null;
  candidateYears: number | null;
}

export interface MatchContext {
  /** Fixed clock for deterministic seniority maths. */
  asOf?: Date;
}

export interface ExplanationPromptInput {
  jobTitle: string;
  company: string;
  /** Already delimiter-wrapped by the caller (I2). */
  wrappedJobDescription: string;
  /** Already redacted by the caller (I7). */
  profileSummary: string;
  result: MatchResult;
}