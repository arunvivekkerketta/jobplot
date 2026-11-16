import { NextResponse } from "next/server";
import { saveGapReport } from "@jobpilot/db";
import { requireUserRequest } from "@/lib/guard";
import { gapSeverity, loadGap } from "@/lib/gap";

export const dynamic = "force-dynamic";

/**
 * Saves the same gap report /skills renders, from stored scores and the Fact
 * Index (I1). The only inputs are the user's own profile and postings; nothing is
 * invented, and the report never writes to the profile.
 */
export async function POST(req: Request) {
  const guarded = await requireUserRequest(req);
  if (guarded instanceof Response) return guarded;
  const { userId } = guarded;

  const { profile, matches, gap, missing, projects } = await loadGap(userId);
  if (!profile) {
    return NextResponse.json({ error: "Import a profile first." }, { status: 409 });
  }

  const report = await saveGapReport({
    userId,
    inputJobIds: matches.map((match) => match.job.id),
    gaps: gap.map((entry) => ({
      keyword: entry.keyword,
      jobs: entry.jobIds,
      severity: gapSeverity(entry, matches.length),
    })),
  });

  return NextResponse.json(
    { reportId: report.id, gap, missing, projects },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
