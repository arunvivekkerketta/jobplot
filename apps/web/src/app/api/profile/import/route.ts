import { NextResponse } from "next/server";
import { assignMissingFids } from "@jobpilot/core";
import { saveProfileWithFacts, writeAudit } from "@jobpilot/db";
import { ZodError } from "zod";
import { requireUserRequest } from "@/lib/guard";

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

  const payload = (body as { profile?: unknown }).profile ?? body;

  try {
    const profile = assignMissingFids(payload);
    const saved = await saveProfileWithFacts(userId, profile);
    return NextResponse.json({
      ok: true,
      profileId: saved.profileId,
      version: saved.version,
      factCount: saved.factCount,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      await writeAudit({
        actor: "USER",
        action: "profile.import.rejected",
        entityType: "Profile",
        payload: { issueCount: err.issues.length },
      });
      return NextResponse.json(
        {
          error: "Validation failed",
          issues: err.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 },
    );
  }
}
