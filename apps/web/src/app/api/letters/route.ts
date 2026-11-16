import { NextResponse } from "next/server";
import { z } from "zod";
import { LETTER_KINDS, letterWatermark, type JsonResumeProfile, type LetterKind } from "@jobpilot/core";
import { AnthropicClient, draftLetterWithClient, LetterClaimError } from "@jobpilot/llm";
import { renderLetter } from "@jobpilot/render";
import { prisma, writeAudit } from "@jobpilot/db";
import { requireUserRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

const letterInput = z.object({
  kind: z.enum(LETTER_KINDS),
  jobId: z.string().min(1),
  /** Extra direction from the user; treated as untrusted data (I2). */
  notes: z.string().trim().max(2000).optional(),
});

/**
 * Drafts one letter against one posting.
 *
 * The draft is proved against the profile before it is returned (I1), and the
 * response always carries the watermark the kind requires (I6). Nothing is
 * stored here: a letter becomes "sent" only when the user saves it into the
 * Answer Bank, which re-checks the claims at that moment.
 */
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

  const parsed = letterInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { jsonResume: true },
  });
  if (!profile) {
    return NextResponse.json(
      { error: "Import a profile before drafting a letter." },
      { status: 409 },
    );
  }

  const job = await prisma.job.findUnique({
    where: { id: parsed.data.jobId },
    select: { id: true, title: true, company: true, descriptionText: true },
  });
  if (!job) {
    return NextResponse.json({ error: "Unknown job" }, { status: 404 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Set ANTHROPIC_API_KEY to draft letters." },
      { status: 503 },
    );
  }
  const client = new AnthropicClient({
    audit: async (entry) => {
      await writeAudit(entry);
    },
  });

  try {
    const { draft, check } = await draftLetterWithClient({
      client,
      kind: parsed.data.kind as LetterKind,
      profile: profile.jsonResume as unknown as JsonResumeProfile,
      job: {
        title: job.title,
        company: job.company,
        descriptionText: job.descriptionText,
      },
      ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
    });

    const rendered = renderLetter(draft);

    await writeAudit({
      actor: "SYSTEM",
      action: "letter.draft",
      entityType: "Job",
      entityId: job.id,
      payload: {
        kind: draft.kind,
        claims: check.checkedClaims,
        watermark: rendered.watermark,
      },
    });

    return NextResponse.json(
      {
        kind: draft.kind,
        subject: draft.subject,
        paragraphs: draft.paragraphs,
        claims: draft.claims,
        checkedClaims: check.checkedClaims,
        watermark: letterWatermark(draft.kind),
        text: rendered.text,
        html: rendered.html,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof LetterClaimError) {
      // I1: a draft that invents a fact is not returned at all.
      await writeAudit({
        actor: "LLM",
        action: "letter.draft.rejected",
        entityType: "Job",
        entityId: job.id,
        payload: { kind: parsed.data.kind, issues: error.check.issues.length },
      });
      return NextResponse.json(
        {
          error: "The draft states facts your profile cannot support (I1).",
          issues: error.check.issues,
        },
        { status: 422 },
      );
    }
    await writeAudit({
      actor: "LLM",
      action: "letter.draft.failed",
      entityType: "Job",
      entityId: job.id,
      payload: { message: error instanceof Error ? error.message : "unknown error" },
    });
    return NextResponse.json({ error: "Drafting failed" }, { status: 500 });
  }
}
