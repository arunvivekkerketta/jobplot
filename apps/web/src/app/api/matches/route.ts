import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listMatches, prisma } from "@jobpilot/db";
import { meetsThreshold } from "@jobpilot/core";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!profile) {
    return NextResponse.json({ error: "Import a profile before matching" }, { status: 409 });
  }

  const settings = await prisma.settings.upsert({
    where: { userId },
    update: {},
    create: { userId },
    select: { matchThreshold: true },
  });

  const onlyAbove = new URL(req.url).searchParams.get("aboveThreshold") === "1";
  const matches = await listMatches(profile.id, {
    ...(onlyAbove ? { threshold: settings.matchThreshold } : {}),
  });

  return NextResponse.json(
    {
      threshold: settings.matchThreshold,
      matches: matches.map((match) => ({
        jobId: match.jobId,
        score: match.score,
        aboveThreshold: meetsThreshold(match.score, settings.matchThreshold),
        explanation: match.explanation,
        breakdown: match.breakdown,
        algoVersion: match.algoVersion,
        job: {
          ...match.job,
          postedAt: match.job.postedAt?.toISOString() ?? null,
        },
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}