import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@jobpilot/db";
import { recomputeMatches } from "@/lib/matcher";

export const dynamic = "force-dynamic";

const recomputeInput = z.object({
  limit: z.number().int().min(1).max(50).optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown = {};
  const text = await req.text();
  if (text.trim().length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
    }
  }

  const parsed = recomputeInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const settings = await prisma.settings.upsert({
    where: { userId },
    update: {},
    create: { userId },
    select: { matchThreshold: true },
  });

  const rows = await recomputeMatches({
    userId,
    threshold: settings.matchThreshold,
    ...(parsed.data.limit ? { limit: parsed.data.limit } : {}),
  });
  if (rows === null) {
    return NextResponse.json({ error: "Import a profile before matching" }, { status: 409 });
  }

  return NextResponse.json(
    {
      scored: rows.length,
      aboveThreshold: rows.filter((row) => row.aboveThreshold).length,
      threshold: settings.matchThreshold,
      rows,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}