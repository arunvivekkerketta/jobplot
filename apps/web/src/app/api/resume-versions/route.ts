import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  validateResumeDocument,
  type JsonResumeProfile,
  type ValidationReport,
} from "@jobpilot/core";
import {
  listResumeVersions,
  prisma,
  saveRenderedDocument,
  saveResumeVersion,
  setResumeVersionArtifacts,
  writeAudit,
} from "@jobpilot/db";
import { renderResume, tailorDocument } from "@jobpilot/render";
import { tailorWithClient, type LLMClient } from "@jobpilot/llm";
import { makeExplanationClient } from "@/lib/matcher";
import { requireUserRequest } from "@/lib/guard";

export const dynamic = "force-dynamic";

const tailorInput = z.object({ jobId: z.string().min(1) });

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!profile) {
    return NextResponse.json({ error: "Import a profile first" }, { status: 409 });
  }

  const versions = await listResumeVersions(profile.id);
  return NextResponse.json(
    {
      versions: versions.map((version) => ({
        id: version.id,
        jobId: version.jobId,
        approvedAt: version.approvedAt?.toISOString() ?? null,
        pdfPath: version.pdfPath,
        docxPath: version.docxPath,
        keywordReport: version.keywordReport,
        validationReport: version.validationReport,
      })),
    },
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

  const parsed = tailorInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) {
    return NextResponse.json({ error: "Import a profile first" }, { status: 409 });
  }

  const job = await prisma.job.findUnique({
    where: { id: parsed.data.jobId },
    select: { id: true, title: true, descriptionText: true },
  });
  if (!job) {
    return NextResponse.json({ error: "Unknown job" }, { status: 404 });
  }

  const resume = profile.jsonResume as unknown as JsonResumeProfile;
  const deterministic = tailorDocument(resume, job.descriptionText);

  let document = deterministic.document;
  // Even the deterministic selection is checked: the audit must report real
  // checked claims, not an assumed pass (I1/I8).
  let validation: ValidationReport = validateResumeDocument(resume, document);
  let source: "llm" | "deterministic" = "deterministic";

  const client: LLMClient | null = makeExplanationClient();
  if (client) {
    try {
      const tailored = await tailorWithClient({
        client,
        profile: resume,
        jobDescription: job.descriptionText,
      });
      document = tailored.document;
      validation = tailored.validation;
      source = "llm";
    } catch (error) {
      // I1: an invented claim rejects the model output, and the deterministic
      // selection is used instead rather than shipping it.
      await writeAudit({
        actor: "LLM",
        action: "resume.tailor.rejected",
        entityType: "Job",
        entityId: job.id,
        payload: {
          message: error instanceof Error ? error.message : "unknown error",
          fallback: true,
        },
      });
    }
  }

  const pdf = await renderResume({
    profile: resume,
    format: "pdf",
    document,
    jobDescription: job.descriptionText,
  });
  const docx = await renderResume({
    profile: resume,
    format: "docx",
    document,
    jobDescription: job.descriptionText,
  });

  const pdfDocument = await saveRenderedDocument({
    userId,
    format: "pdf",
    contentBase64: pdf.content.toString("base64"),
    validationReport: { ...validation, tailored: true },
    metadata: { filename: `tailored-${job.id}.pdf`, jobId: job.id },
    auditPayload: { jobId: job.id, tailored: true, atsScore: pdf.ats.score },
  });
  const docxDocument = await saveRenderedDocument({
    userId,
    format: "docx",
    contentBase64: docx.content.toString("base64"),
    validationReport: { ...validation, tailored: true },
    metadata: { filename: `tailored-${job.id}.docx`, jobId: job.id },
    auditPayload: { jobId: job.id, tailored: true, atsScore: docx.ats.score },
  });

  const version = await saveResumeVersion({
    profileId: profile.id,
    jobId: job.id,
    tailoredJson: document,
    validationReport: { ...validation, source },
    keywordReport: deterministic.keywordReport,
  });

  await setResumeVersionArtifacts(version.id, {
    pdfPath: `/api/documents/${pdfDocument.id}`,
    docxPath: `/api/documents/${docxDocument.id}`,
  });

  return NextResponse.json(
    {
      id: version.id,
      jobId: job.id,
      approvedAt: null,
      source,
      validation: { ok: validation.ok, checkedClaims: validation.checkedClaims },
      keywordReport: deterministic.keywordReport,
      ats: { score: pdf.ats.score, issues: pdf.ats.issues },
      pdfPath: `/api/documents/${pdfDocument.id}`,
      docxPath: `/api/documents/${docxDocument.id}`,
    },
    { status: 201 },
  );
}