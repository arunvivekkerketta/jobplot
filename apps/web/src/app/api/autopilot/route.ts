import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { isSameOriginRequest } from "@/lib/origin";
import { prisma, writeAudit } from "@jobpilot/db";
import {
  BrowserUnavailableError,
  loadAutopilotStatus,
  runAutopilotNow,
  runScheduledTick,
  updatePortal,
} from "@jobpilot/autopilot";

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

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = await loadAutopilotStatus(userId);
  return NextResponse.json(status, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "Cross-origin request refused" }, { status: 403 });
  }

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

  try {
    const result = await runAutopilotNow(userId, {
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
      ...(parsed.data.jobIds !== undefined ? { jobIds: parsed.data.jobIds } : {}),
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof BrowserUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    await writeAudit({
      actor: "SYSTEM",
      action: "autopilot.failed",
      entityType: "Settings",
      entityId: userId,
      payload: { message: error instanceof Error ? error.message : "unknown error" },
    });
    return NextResponse.json({ error: "Auto-Pilot run failed" }, { status: 500 });
  }
}