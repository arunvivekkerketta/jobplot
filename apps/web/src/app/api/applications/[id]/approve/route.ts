import { NextResponse } from "next/server";
import { z } from "zod";
import { runApprovedApplication } from "@jobpilot/autopilot";
import { requireUserRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

/** The click is the consent (I3): nothing is sent without it. */
const approveInput = z.object({ consent: z.literal(true) });

/**
 * "Approve and send" for one Co-Pilot application (4.2).
 *
 * The browser work lives in `@jobpilot/autopilot`, next to the Auto-Pilot loop, so
 * both paths share the same stop checks; this route only decides that a signed-in,
 * same-origin request carrying explicit consent may ask for it.
 */
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

  const parsed = approveInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Approving a send needs explicit consent (I3)", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const outcome = await runApprovedApplication(userId, id);
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }

  return NextResponse.json(
    {
      id,
      mode: outcome.mode,
      status: outcome.status,
      reason: outcome.reason,
      actions: outcome.actions,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
