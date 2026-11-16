import { NextResponse } from "next/server";
import { z } from "zod";
import { buildFactIndex, extractGap, suggestProjects } from "@jobpilot/core";
import { prisma, saveGapReport } from "@jobpilot/db";
import { requireUserRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

const gapInput = z.object({
  jobIds: z.array(z.string().min(1)).max(20).optional(),
});

/**
 * Builds the gap report from stored scores and the Fact Index (I1). The only
 * inputs are the user's own profile and postings; nothing is invented, and the
 * report never writes to the profile.
 */
export async function POST(req: Request) {
  const guarded = await requireUserRequest(req);
  if (guarded instanceof Response) return guarded;
  const { userId } = guarded;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = gapInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { id: true, jsonResume: true },
  });
  if (!profile) {
    return NextResponse.json({ error: "Import a profile first." }, { status: 409 });
  }

  const matches = await prisma.matchScore.findMany({
    where: {
      profileId: profile.id,
      ...(parsed.data.jobIds ? { jobId: { in: parsed.data.jobIds } } : {}),
    },
    orderBy: [{ score: "desc" }, { id: "asc" }],
    take: 20,
    include: { job: { select: { id: true, title: true, parsed: true } } },
  });

  const index = buildFactIndex(profile.jsonResume as never);
  const gap = extractGap(
    matches.map((match) => match.job),
    index,
  );
  const missing = gap.filter((entry) => !entry.haveIt).map((entry) => entry.keyword);
  const projects = suggestProjects(missing);

  const keywordsByJob = new Map<string, string[]>(
    matches.map((match) => [
      match.job.id,
      Array.isArray((match.job.parsed as { keywords?: unknown } | null)?.keywords)
        ? ((match.job.parsed as { keywords: string[] }).keywords ?? [])
        : [],
    ]),
  );
  const jobsFor = (keyword: string): string[] =>
    [...keywordsByJob.entries()]
      .filter(([, keywords]) =>
        keywords.some((value) => value.toLowerCase() === keyword.toLowerCase()),
      )
      .map(([jobId]) => jobId);

  const report = await saveGapReport({
    userId,
    inputJobIds: matches.map((match) => match.job.id),
    gaps: gap.map((entry) => ({
      keyword: entry.keyword,
      jobs: jobsFor(entry.keyword),
      severity:
        entry.jobsMentioning * 3 >= matches.length * 2
          ? ("high" as const)
          : entry.jobsMentioning * 3 >= matches.length
            ? ("medium" as const)
            : ("low" as const),
    })),
  });

  return NextResponse.json(
    { reportId: report.id, gap, missing, projects },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
