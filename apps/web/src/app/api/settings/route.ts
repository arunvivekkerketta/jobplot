import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { prisma, writeAudit } from "@jobpilot/db";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settings = await prisma.settings.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
  return NextResponse.json(settings);
}

const putSchema = z.object({
  // AUTOPILOT is what makes the scheduled worker tick pick this user up (8.2).
  mode: z.enum(["COPILOT", "AUTOPILOT"]).optional(),
  dailyCap: z.number().int().min(1).max(25).optional(),
  matchThreshold: z.number().int().min(0).max(100).optional(),
  killSwitch: z.boolean().optional(),
  // Auto-Pilot cannot unlock a portal while this is off (I3).
  allowSubmit: z.boolean().optional(),
});

export async function PUT(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const before = await prisma.settings.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });

  const after = await prisma.settings.update({
    where: { userId },
    data: parsed.data,
  });

  await writeAudit({
    actor: "USER",
    action: "settings.update",
    entityType: "Settings",
    entityId: userId,
    payload: { before, after },
  });

  return NextResponse.json(after);
}
