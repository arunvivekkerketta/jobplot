import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma, saveJobs } from "@jobpilot/db";
import { parseManualPosting } from "@jobpilot/sources";
import { requireUserRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

/** Paste-a-posting body; the posting text itself is untrusted data (I2). */
const manualJobInput = z.object({
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().min(1).max(200),
  url: z.string().trim().min(1).max(2000),
  text: z.string().max(200_000).optional(),
  html: z.string().max(400_000).optional(),
  location: z.string().max(200).optional(),
  postedAt: z.string().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobs = await prisma.job.findMany({
    orderBy: { fetchedAt: "desc" },
    take: 50,
    select: {
      id: true,
      source: true,
      title: true,
      company: true,
      location: true,
      remote: true,
      url: true,
      salaryMin: true,
      salaryMax: true,
      postedAt: true,
      fetchedAt: true,
    },
  });

  return NextResponse.json(
    {
      jobs: jobs.map((job) => ({
        ...job,
        postedAt: job.postedAt?.toISOString() ?? null,
        fetchedAt: job.fetchedAt.toISOString(),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const guarded = await requireUserRequest(req);
  if (guarded instanceof Response) return guarded;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = manualJobInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid job", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  let draft;
  try {
    draft = parseManualPosting(parsed.data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid job", issues: error.issues },
        { status: 422 },
      );
    }
    throw error;
  }

  const saved = await saveJobs([draft], { actor: "USER" });

  return NextResponse.json(
    {
      created: saved.created,
      updated: saved.updated,
      job: {
        id: saved.ids[0],
        source: draft.source,
        title: draft.title,
        company: draft.company,
        url: draft.url,
      },
    },
    { status: 201 },
  );
}
