import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { createApplication, prisma } from "@jobpilot/db";
import { requireUserRequest } from "@/lib/guard";

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
  /** Optional tailored version; when given it must already be approved. */
  resumeVersionId: z.string().min(1).optional(),
});

const listQuery = z.object({
  status: z
    .enum(["QUEUED", "RUNNING", "PAUSED_NEEDS_HUMAN", "BLOCKED", "SUBMITTED", "ERROR"])
    .optional(),
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedQuery = listQuery.safeParse({
    status: new URL(req.url).searchParams.get("status") ?? undefined,
  });
  if (!parsedQuery.success) {
    return NextResponse.json(
      { error: "Unknown status filter", issues: parsedQuery.error.issues },
      { status: 422 },
    );
  }

  const applications = await prisma.application.findMany({
    where: parsedQuery.data.status ? { status: parsedQuery.data.status } : {},
    orderBy: { id: "desc" },
    take: 50,
    include: {
      job: { select: { id: true, title: true, company: true, url: true } },
      // The dashboard lists what the browser actually did, in order.
      events: {
        orderBy: { at: "desc" },
        take: 20,
        select: { type: true, payload: true, at: true },
      },
      _count: { select: { events: true } },
    },
  });

  return NextResponse.json(
    {
      applications: applications.map((application) => ({
        id: application.id,
        status: application.status,
        portal: application.portal,
        mode: application.mode,
        submittedAt: application.submittedAt?.toISOString() ?? null,
        notes: application.notes,
        events: application._count.events,
        actions: application.events.map((event) => ({
          type: event.type,
          at: event.at.toISOString(),
          detail:
            typeof (event.payload as { detail?: unknown }).detail === "string"
              ? (event.payload as { detail: string }).detail
              : null,
        })),
        job: application.job,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const guarded = await requireUserRequest(req);
  if (guarded instanceof Response) return guarded;
  const { userId } = guarded;

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

  if (parsed.data.resumeVersionId) {
    const profile = await prisma.profile.findUnique({
      where: { userId },
      select: { id: true },
    });
    const version = await prisma.resumeVersion.findUnique({
      where: { id: parsed.data.resumeVersionId },
      select: { id: true, profileId: true, approvedAt: true },
    });
    if (!version || !profile || version.profileId !== profile.id) {
      return NextResponse.json({ error: "Unknown resume version" }, { status: 404 });
    }
    if (!version.approvedAt) {
      return NextResponse.json(
        { error: "Approve the tailored resume before applying (I3)" },
        { status: 409 },
      );
    }
  }

  const application = await createApplication({
    jobId: job.id,
    portal: job.source,
  });

  return NextResponse.json(
    {
      id: application.id,
      status: application.status,
      resumeDocumentId: resume.id,
      resumeVersionId: parsed.data.resumeVersionId ?? null,
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}