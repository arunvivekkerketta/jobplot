import { NextResponse } from "next/server";
import { z } from "zod";
import { looksSensitive } from "@jobpilot/apply";
import {
  isLetterAnswerKey,
  recheckLetterClaims,
  type JsonResumeProfile,
} from "@jobpilot/core";
import { deleteAnswer, listAnswers, prisma, upsertAnswer } from "@jobpilot/db";
import { requireUserRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

const answerInput = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[A-Za-z0-9 _-]+$/, "key may contain letters, numbers, spaces, - and _"),
  answer: z.string().trim().min(1).max(2000),
  questionPattern: z.string().max(200).optional(),
  sensitive: z.boolean().optional(),
});

export async function GET(req: Request) {
  const guarded = await requireUserRequest(req);
  if (guarded instanceof Response) return guarded;
  const { userId } = guarded;

  const answers = await listAnswers(userId);
  return NextResponse.json(
    { answers },
    { headers: { "Cache-Control": "private, no-store" } },
  );
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

  const parsed = answerInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  // 4.4: a letter becomes text the runner types into an employer's form the
  // moment it lands in the Answer Bank, so the claims are checked here, right
  // before anything can be sent (I1).
  if (isLetterAnswerKey(parsed.data.key)) {
    const profile = await prisma.profile.findUnique({
      where: { userId },
      select: { jsonResume: true },
    });
    if (!profile) {
      return NextResponse.json(
        { error: "Import a profile before saving a letter." },
        { status: 409 },
      );
    }
    const check = recheckLetterClaims(
      profile.jsonResume as unknown as JsonResumeProfile,
      { paragraphs: [parsed.data.answer], claims: [] },
    );
    if (!check.ok) {
      return NextResponse.json(
        {
          error: "This letter states facts your profile cannot support (I1).",
          issues: check.issues,
        },
        { status: 422 },
      );
    }
  }

  const entry = await upsertAnswer({
    userId,
    key: parsed.data.key,
          answer: parsed.data.answer,
    // A sensitive-looking key is always treated as sensitive, whatever the client
    // sent, so a value cannot be stored in the clear by leaving a box unticked (I5/I7).
    sensitive: parsed.data.sensitive === true || looksSensitive(parsed.data.key),
    ...(parsed.data.questionPattern !== undefined
      ? { questionPattern: parsed.data.questionPattern }
      : {}),
  });

  return NextResponse.json(entry, { status: 201 });
}

export async function DELETE(req: Request) {
  const guarded = await requireUserRequest(req);
  if (guarded instanceof Response) return guarded;
  const { userId } = guarded;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 422 });
  }

  const removed = await deleteAnswer({ userId, id });
  if (!removed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}