import { buildFactIndex, canonicalize } from "@jobpilot/core";
import type { JsonResumeProfile } from "@jobpilot/core";

export interface FactSummary {
  countsByKind: Record<string, number>;
  totalFacts: number;
  topSkills: Array<{ skill: string; years: number }>;
}

/** Builds the right-rail Fact Index summary for a stored profile. */
export function summarizeProfile(jsonResume: unknown): FactSummary {
  const profile = jsonResume as JsonResumeProfile;
  const idx = buildFactIndex(profile);

  const countsByKind: Record<string, number> = {};
  for (const f of idx.facts) {
    countsByKind[f.kind] = (countsByKind[f.kind] ?? 0) + 1;
  }

  const seen = new Set<string>();
  const candidates: Array<{ skill: string; years: number }> = [];
  for (const f of idx.facts) {
    if (f.kind !== "SKILL") continue;
    const canon = canonicalize(f.text);
    if (seen.has(canon)) continue;
    seen.add(canon);
    candidates.push({ skill: canon, years: idx.yearsOfExperience(canon) });
  }
  const topSkills = candidates.sort((a, b) => b.years - a.years).slice(0, 10);

  return { countsByKind, totalFacts: idx.facts.length, topSkills };
}
