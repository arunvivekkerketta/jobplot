import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { JsonResumeProfile } from "@jobpilot/core";
import { prisma, saveRenderedDocument, writeAudit } from "@jobpilot/db";
import { renderResume, type ResumeFormat } from "@jobpilot/render";

const FORMATS = new Set<ResumeFormat>(["html", "pdf", "docx"]);

function isResumeFormat(value: unknown): value is ResumeFormat {
  return typeof value === "string" && FORMATS.has(value as ResumeFormat);
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "resume";
}

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const format: unknown = (body as { format?: unknown }).format ?? "html";
  if (!isResumeFormat(format)) {
    return NextResponse.json(
      { error: "format must be one of html, pdf, docx" },
      { status: 400 },
    );
  }

  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) {
    return NextResponse.json(
      { error: "Import a profile before generating a document" },
      { status: 409 },
    );
  }

  let rendered;
  try {
    rendered = await renderResume({
      profile: profile.jsonResume as unknown as JsonResumeProfile,
      format,
      jobDescription:
        typeof (body as { jobDescription?: unknown }).jobDescription === "string"
          ? (body as { jobDescription: string }).jobDescription
          : undefined,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ClaimValidationError") {
      const report = (error as Error & { report?: unknown }).report;
      await writeAudit({
        actor: "USER",
        action: "document.render.rejected",
        entityType: "Document",
        payload: { format, reason: error.message },
      });
      return NextResponse.json(
        { error: "Claim validation failed", report },
        { status: 422 },
      );
    }
    throw error;
  }

  const filename = `${slugify(rendered.document.contact.name)}-resume.${rendered.extension}`;
  const saved = await saveRenderedDocument({
    userId,
    format,
    contentBase64: rendered.content.toString("base64"),
    validationReport: {
      ok: rendered.validation.ok,
      checkedClaims: rendered.validation.checkedClaims,
      issues: rendered.validation.issues,
    },
    metadata: {
      filename,
      contentType: rendered.contentType,
      ats: rendered.ats,
      watermark: rendered.watermark ?? null,
    },
    auditPayload: {
      format,
      atsScore: rendered.ats.score,
      checkedClaims: rendered.validation.checkedClaims,
      watermark: rendered.watermark ?? null,
    },
  });

  return NextResponse.json({
    id: saved.id,
    format,
    filename,
    createdAt: saved.createdAt.toISOString(),
    validation: {
      ok: rendered.validation.ok,
      checkedClaims: rendered.validation.checkedClaims,
    },
    ats: {
      ok: rendered.ats.ok,
      score: rendered.ats.score,
      issues: rendered.ats.issues,
      keywordCoverage: rendered.ats.keywordCoverage ?? null,
    },
  });
}
