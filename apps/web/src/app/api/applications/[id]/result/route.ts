import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma, recordApplicationResult } from "@jobpilot/db";

export const dynamic = "force-dynamic";

const resultInput = z.object({
  status: z.enum(["SUBMITTED", "PAUSED_NEEDS_HUMAN", "BLOCKED"]),
  actions: z
    .array(
      z.object({
        kind: z.enum(["NAVIGATE", "FILL", "ATTACH", "CLICK", "SUBMIT", "PAUSE", "BLOCK"]),
        detail: z.string().max(2000),
        field: z.string().max(300).optional(),
      }),
    )
    .max(200),
  reason: z.string().max(200).optional(),
  submissionText: z.string().max(2000).optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = resultInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const application = await prisma.application.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!application) {
    return NextResponse.json({ error: "Unknown application" }, { status: 404 });
  }

  const saved = await recordApplicationResult({
    applicationId: application.id,
    status: parsed.data.status,
    actions: parsed.data.actions,
    ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    ...(parsed.data.submissionText
      ? { submissionText: parsed.data.submissionText }
      : {}),
  });

  return NextResponse.json(saved, { headers: { "Cache-Control": "no-store" } });
}