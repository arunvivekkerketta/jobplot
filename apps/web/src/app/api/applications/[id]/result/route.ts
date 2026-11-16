import { NextResponse } from "next/server";
import { z } from "zod";
import { findApplicationForUser, recordApplicationResult } from "@jobpilot/db";
import { requireUserRequest } from "@/lib/guard";

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
  const guarded = await requireUserRequest(req);
  if (guarded instanceof Response) return guarded;

  const { userId } = guarded;

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

  // Owner-scoped: a result may only be reported for the caller's own application.
  const application = await findApplicationForUser({ id, userId });
  if (!application) {
    return NextResponse.json({ error: "Unknown application" }, { status: 404 });
  }

  // A finished application never changes again, and a result may only be reported
  // while the row is still in flight (L1).
  if (application.status === "SUBMITTED") {
    return NextResponse.json(
      { error: "Application is already submitted" },
      { status: 409 },
    );
  }
  if (
    parsed.data.status === "SUBMITTED" &&
    !["QUEUED", "RUNNING", "PAUSED_NEEDS_HUMAN"].includes(application.status)
  ) {
    return NextResponse.json(
      { error: `Cannot report SUBMITTED from status ${application.status}` },
      { status: 409 },
    );
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