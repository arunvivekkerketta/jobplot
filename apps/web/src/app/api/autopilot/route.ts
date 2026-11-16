import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createAutopilotRun,
  failAutopilotRun,
  prisma,
  writeAudit,
} from "@jobpilot/db";
import { enqueueAutopilotRun } from "@jobpilot/autopilot/queue";
import {
  BrowserUnavailableError,
  loadAutopilotStatus,
  runScheduledTick,
  updatePortal,
} from "@jobpilot/autopilot";
import { requireUserRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("unlock"), portal: z.string().min(1).max(40) }),
  z.object({ action: z.literal("lock"), portal: z.string().min(1).max(40) }),
  z.object({
    action: z.literal("run"),
    limit: z.number().int().min(1).max(5).optional(),
    /** Optional narrowing to specific postings; every gate still applies. */
    jobIds: z.array(z.string().min(1)).max(10).optional(),
  }),
  z.object({ action: z.literal("stop") }),
  /** Runs the scheduler once, for the same service the cron job calls. */
  z.object({ action: z.literal("tick") }),
]);

export async function GET(req: Request) {
  const guarded = await requireUserRequest(req);
  if (guarded instanceof Response) return guarded;
  const { userId } = guarded;

  const status = await loadAutopilotStatus(userId);
  return NextResponse.json(status, { headers: { "Cache-Control": "private, no-store" } });
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

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  if (parsed.data.action === "unlock" || parsed.data.action === "lock") {
    const result = await updatePortal(
      userId,
      parsed.data.portal,
      parsed.data.action === "unlock",
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  }

  if (parsed.data.action === "stop") {
    await prisma.settings.upsert({
      where: { userId },
      update: { killSwitch: true },
      create: { userId, killSwitch: true },
    });
    await writeAudit({
      actor: "USER",
      action: "autopilot.stop",
      entityType: "Settings",
      entityId: userId,
      payload: { killSwitch: true },
    });
    return NextResponse.json({ stopReason: "KILL_SWITCH" });
  }

  if (parsed.data.action === "tick") {
    try {
      const report = await runScheduledTick();
      return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof BrowserUnavailableError) {
        return NextResponse.json({ error: error.message }, { status: 503 });
      }
      return NextResponse.json({ error: "Scheduled tick failed" }, { status: 500 });
    }
  }

  // 4.6: the click queues the run and returns at once. The worker owns the batch
  // from here — a five-minute browser run no longer has to fit in one request.
  const run = await createAutopilotRun({
    userId,
    ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
    ...(parsed.data.jobIds !== undefined ? { jobIds: parsed.data.jobIds } : {}),
  });

  try {
    await enqueueAutopilotRun({
      runId: run.id,
      userId,
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
      ...(parsed.data.jobIds !== undefined ? { jobIds: parsed.data.jobIds } : {}),
    });
  } catch (error) {
    // No silent in-request fallback: without a working queue the answer is a
    // clear 503, a failed run row and an audit entry.
    const message = error instanceof Error ? error.message : "queue unavailable";
    await failAutopilotRun({ id: run.id, error: message });
    await writeAudit({
      actor: "SYSTEM",
      action: "autopilot.run.enqueue.failed",
      entityType: "AutopilotRun",
      entityId: run.id,
      payload: { message },
    });
    return NextResponse.json(
      { error: "Auto-Pilot could not be queued. Is the worker running?", runId: run.id },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { runId: run.id, status: "QUEUED" },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}