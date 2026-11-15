import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { approveResumeVersion, findResumeVersion, prisma } from "@jobpilot/db";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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