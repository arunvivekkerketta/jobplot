import {
  buildResumeDocument,
  ClaimValidationError,
  validateResumeDocument,
  type JsonResumeProfile,
  type ResumeDocument,
  type ResumeDocumentKind,
  type ValidationReport,
} from "@jobpilot/core";
import { lintResumeDocument, type AtsReport } from "./ats.js";
import { renderResumeDocx } from "./docx.js";
import { renderResumeHtml } from "./html.js";
import { renderResumePdf } from "./pdf.js";

export { lintResumeDocument } from "./ats.js";
export type { AtsIssue, AtsReport, KeywordCoverage } from "./ats.js";
export { renderResumeHtml, escapeHtml } from "./html.js";
export { renderResumePdf } from "./pdf.js";
export { renderResumeDocx } from "./docx.js";

export type ResumeFormat = "html" | "pdf" | "docx";

export interface RenderRequest {
  profile: JsonResumeProfile;
  format: ResumeFormat;
  /** Defaults to a verbatim projection of the profile. */
  document?: ResumeDocument;
  kind?: ResumeDocumentKind;
  watermark?: string;
  jobDescription?: string;
}

export interface RenderResult {
  document: ResumeDocument;
  validation: ValidationReport;
  ats: AtsReport;
  watermark?: string;
  format: ResumeFormat;
  contentType: string;
  extension: string;
  content: Buffer;
}

const CONTENT_TYPES: Record<ResumeFormat, { contentType: string; extension: string }> = {
  html: { contentType: "text/html; charset=utf-8", extension: "html" },
  pdf: { contentType: "application/pdf", extension: "pdf" },
  docx: {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx",
  },
};

/**
 * Validates every claim against the profile (I1) before rendering. A
 * MOCK_OFFER document always carries the SAMPLE watermark (I6) and callers
 * cannot opt out of it.
 */
export async function renderResume(request: RenderRequest): Promise<RenderResult> {
  const document = request.document ?? buildResumeDocument(request.profile);
  const validation = validateResumeDocument(request.profile, document);
  if (!validation.ok) throw new ClaimValidationError(validation);

  const kind = request.kind ?? "RESUME";
  const watermark = kind === "MOCK_OFFER" ? "SAMPLE" : request.watermark;
  const ats = lintResumeDocument(document, {
    jobDescription: request.jobDescription,
  });

  let content: Buffer;
  switch (request.format) {
    case "html":
      content = Buffer.from(
        renderResumeHtml(document, { watermark }),
        "utf8",
      );
      break;
    case "pdf":
      content = await renderResumePdf(document, { watermark });
      break;
    case "docx":
      content = await renderResumeDocx(document, { watermark });
      break;
    default: {
      const exhaustive: never = request.format;
      throw new Error(`Unsupported format: ${String(exhaustive)}`);
    }
  }

  return {
    document,
    validation,
    ats,
    watermark,
    format: request.format,
    ...CONTENT_TYPES[request.format],
    content,
  };
}
