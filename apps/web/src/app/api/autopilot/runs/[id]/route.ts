import { NextResponse } from "next/server";
import { getAutopilotRun } from "@jobpilot/db";
import { requireUserRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

/** 4.6: the poll the page does while the worker owns the run. */
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const guarded = await requireUserRequest(req);
  if (guarded instanceof Response) return guarded;
  const { userId } = guarded;

  const { id } = await context.params;
  const run = await getAutopilotRun({ id, userId });
  if (!run) {
    return NextResponse.json({ error: "Unknown run" }, { status: 404 });
  }

  return NextResponse.json(
    {
      id: run.id,
      status: run.status,
      requestedAt: run.requestedAt.toISOString(),
      finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      result: run.result,
      error: run.error,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
