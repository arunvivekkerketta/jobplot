import { buildFactIndex, extractGap, suggestProjects, type GapEntry } from "@jobpilot/core";
import { prisma } from "@jobpilot/db";

/** The postings the gap is measured against: the closest matches, nothing else. */
export const GAP_SAMPLE_SIZE = 20;

export type GapSeverity = "high" | "medium" | "low";

/** Two postings in three asking for it is high; one in three is medium. */
export function gapSeverity(entry: GapEntry, postings: number): GapSeverity {
  if (postings === 0) return "low";
  const share = entry.jobsMentioning / postings;
  if (share >= 2 / 3) return "high";
  return share >= 1 / 3 ? "medium" : "low";
}

/**
 * One gap computation for both readers: the /skills page and POST /api/gaps.
 * They read the same profile, the same postings and the same Fact Index, so the
 * page can never show a different gap from the one that was saved (I1).
 */
export async function loadGap(userId: string) {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { id: true, jsonResume: true },
  });
  if (!profile) {
    return { profile: null, matches: [], gap: [], have: [], missing: [], projects: [] };
  }

  const matches = await prisma.matchScore.findMany({
    where: { profileId: profile.id },
    orderBy: [{ score: "desc" }, { id: "asc" }],
    take: GAP_SAMPLE_SIZE,
    include: { job: { select: { id: true, title: true, parsed: true } } },
  });

  const index = buildFactIndex(profile.jsonResume as never);
  const gap = extractGap(
    matches.map((match) => match.job),
    index,
  );
  const have = gap.filter((entry) => entry.haveIt);
  const missing = gap.filter((entry) => !entry.haveIt);

  return {
    profile,
    matches,
    gap,
    have,
    missing,
    projects: suggestProjects(missing.map((entry) => entry.keyword)),
  };
}
