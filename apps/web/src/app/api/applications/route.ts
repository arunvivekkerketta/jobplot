import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { createApplication, prisma } from "@jobpilot/db";

export const dynamic = "force-dynamic";

/**
 * Consent is explicit (I3): the caller names the approved resume it wants
 * attached and states that it is applying, so a queued row can never appear by
 * accident.
 */
const createInput = z.object({
  jobId: z.string().min(1),
  resumeDocumentId: z.string().min(1),
  consent: z.literal(true),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const applications = await prisma.application.findMany({
    orderBy: { id: "desc" },
    take: 50,
    include: {
      job: { select: { id: true, title: true, company: true, url: true } },
      _count: { select: { events: true } },
    },
  });

  return NextResponse.json(
    {
      applications: applications.map((application) => ({
        id: application.id,
        status: application.status,
        portal: application.portal,
        submittedAt: application.submittedAt?.toISOString() ?? null,
        notes: application.notes,
        events: application._count.events,
        job: application.job,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = createInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const job = await prisma.job.findUnique({
    where: { id: parsed.data.jobId },
    select: { id: true, source: true },
  });
  if (!job) {
    return NextResponse.json({ error: "Unknown job" }, { status: 404 });
  }

  // Only a rendered, user-owned PDF can be attached, and only the caller's own.
  const resume = await prisma.document.findFirst({
    where: {
      id: parsed.data.resumeDocumentId,
      userId,
      type: "RESUME",
      format: "pdf",
    },
    select: { id: true },
  });
  if (!resume) {
    return NextResponse.json(
      {
        error:
          "An approved PDF resume from your Documents is required before applying (I3)",
      },
      { status: 409 },
    );
  }

  const application = await createApplication({
    jobId: job.id,
    portal: job.source,
  });

  return NextResponse.json(
    { id: application.id, status: application.status, resumeDocumentId: resume.id },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}