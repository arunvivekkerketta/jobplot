import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { deleteAnswer, listAnswers, upsertAnswer } from "@jobpilot/db";

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

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const answers = await listAnswers(userId);
  return NextResponse.json(
    { answers },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const entry = await upsertAnswer({
    userId,
    key: parsed.data.key,
    answer: parsed.data.answer,
    sensitive: parsed.data.sensitive ?? false,
    ...(parsed.data.questionPattern !== undefined
      ? { questionPattern: parsed.data.questionPattern }
      : {}),
  });

  return NextResponse.json(entry, { status: 201 });
}

export async function DELETE(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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