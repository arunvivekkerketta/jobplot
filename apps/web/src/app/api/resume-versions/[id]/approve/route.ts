import { NextResponse } from "next/server";
import { approveResumeVersion, findResumeVersion, prisma } from "@jobpilot/db";
import { requireUserRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guarded = await requireUserRequest(req);
  if (guarded instanceof Response) return guarded;
  const { userId } = guarded;

  const { id } = await context.params;
  const version = await findResumeVersion(id);
  if (!version) {
    return NextResponse.json({ error: "Unknown resume version" }, { status: 404 });
  }

  // Scope by the caller's profile: a version id alone must never grant access.
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!profile || profile.id !== version.profileId) {
    return NextResponse.json({ error: "Unknown resume version" }, { status: 404 });
  }

  const approved = await approveResumeVersion(version.id);
  return NextResponse.json({
    id: approved.id,
    approvedAt: approved.approvedAt?.toISOString() ?? null,
  });
}