import {
  buildMatchExplanationPrompt,
  candidateYears,
  fallbackExplanation,
  type JsonResumeProfile,
  type MatchResult,
} from "@jobpilot/core";
import { redact } from "./redact.js";
import { wrapUntrusted } from "./untrusted.js";

export interface ExplanationRequestInput {
  job: { title: string; company: string; descriptionText: string };
  profile: JsonResumeProfile;
  result: MatchResult;
  asOf?: Date;
}

/**
 * The only candidate facts allowed to reach the model: job titles, skills and the
 * years derived from the dated work history. Name, email, phone and address are
 * never included, and the result is redacted as a second line of defence (I7).
 */
export function candidateSummary(profile: JsonResumeProfile, asOf?: Date): string {
  const positions = profile.work.map((work) => work.position).slice(0, 5);
  const skills = profile.skills.flatMap((skill) => [
    skill.name,
    ...skill.keywords.map((keyword) => keyword.keyword),
  ]);
  const years = candidateYears(profile, asOf);
  return redact(
    [
      positions.join(", "),
      `skills: ${skills.join(", ")}`,
      years === null ? "experience length unknown" : `${years} years of dated experience`,
    ]
      .filter(Boolean)
      .join(". "),
  );
}

/**
 * Assembles the explanation request: wrapped job description (I2), redacted
 * candidate summary (I7), and the deterministic fallback to use if the model is
 * unavailable or its output fails validation.
 */
export function buildMatchExplanation(input: ExplanationRequestInput): {
  system: string;
  user: string;
  fallback: string;
} {
  const prompt = buildMatchExplanationPrompt({
    jobTitle: input.job.title,
    company: input.job.company,
    wrappedJobDescription: wrapUntrusted("job-description", input.job.descriptionText),
    profileSummary: candidateSummary(input.profile, input.asOf),
    result: input.result,
  });
  return { ...prompt, fallback: fallbackExplanation(input.result) };
}