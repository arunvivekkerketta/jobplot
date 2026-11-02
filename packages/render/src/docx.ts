import {
  AlignmentType,
  Document,
  Header,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import type { ResumeDocument } from "@jobpilot/core";
import { formatDateRange } from "./dates.js";

export interface DocxRenderOptions {
  watermark?: string;
}

const MUTED = "555555";

function heading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 80 },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 21 })],
  });
}

/**
 * Real OOXML (not an HTML file renamed .docx). Paragraphs only — no text
 * boxes or tables — so Word and ATS importers read it linearly.
 */
export async function renderResumeDocx(
  doc: ResumeDocument,
  options: DocxRenderOptions = {},
): Promise<Buffer> {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: doc.contact.name, bold: true, size: 42 })],
    }),
  );

  const contact = [
    doc.contact.email,
    doc.contact.phone,
    doc.contact.location,
    doc.contact.url,
  ].filter((v): v is string => Boolean(v));
  children.push(
    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: contact.join("  ·  "), color: MUTED, size: 19 })],
    }),
  );

  if (doc.contact.summary) {
    children.push(new Paragraph({ children: [new TextRun({ text: doc.contact.summary, size: 21 })] }));
  }

  if (doc.roles.length > 0) {
    children.push(heading("Experience"));
    for (const role of doc.roles) {
      children.push(
        new Paragraph({
          spacing: { before: 120 },
          children: [
            new TextRun({ text: role.title, bold: true, size: 22 }),
            new TextRun({ text: ` — ${role.company}`, size: 22 }),
          ],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: formatDateRange(role.startDate, role.endDate),
              color: MUTED,
              size: 19,
            }),
          ],
        }),
      );
      if (role.summary) {
        children.push(new Paragraph({ children: [new TextRun({ text: role.summary, size: 20 })] }));
      }
      for (const bullet of role.highlights) {
        children.push(new Paragraph({ text: bullet, bullet: { level: 0 } }));
      }
    }
  }

  if (doc.education.length > 0) {
    children.push(heading("Education"));
    for (const edu of doc.education) {
      const degree = [edu.studyType, edu.area].filter(Boolean).join(" ");
      children.push(
        new Paragraph({
          spacing: { before: 120 },
          children: [new TextRun({ text: degree || edu.institution, bold: true, size: 21 })],
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: `${edu.institution}${
                edu.startDate || edu.endDate
                  ? `  ·  ${formatDateRange(edu.startDate, edu.endDate)}`
                  : ""
              }`,
              color: MUTED,
              size: 19,
            }),
          ],
        }),
      );
      if (edu.score) {
        children.push(new Paragraph({ children: [new TextRun({ text: edu.score, size: 19 })] }));
      }
    }
  }

  if (doc.skills.length > 0) {
    children.push(heading("Skills"));
    for (const group of doc.skills) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${group.name}${group.level ? ` (${group.level})` : ""}: `,
              bold: true,
              size: 20,
            }),
            new TextRun({ text: group.keywords.join(", "), size: 20 }),
          ],
        }),
      );
    }
  }

  if (doc.projects.length > 0) {
    children.push(heading("Projects"));
    for (const project of doc.projects) {
      children.push(
        new Paragraph({
          spacing: { before: 120 },
          children: [new TextRun({ text: project.name, bold: true, size: 21 })],
        }),
      );
      const range = formatDateRange(project.startDate, project.endDate);
      if (range) {
        children.push(
          new Paragraph({ children: [new TextRun({ text: range, color: MUTED, size: 19 })] }),
        );
      }
      if (project.description) {
        children.push(
          new Paragraph({ children: [new TextRun({ text: project.description, size: 20 })] }),
        );
      }
      for (const bullet of project.highlights) {
        children.push(new Paragraph({ text: bullet, bullet: { level: 0 } }));
      }
    }
  }

  if (doc.certificates.length > 0) {
    children.push(heading("Certificates"));
    for (const cert of doc.certificates) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${cert.name}${cert.issuer ? ` — ${cert.issuer}` : ""}${
                cert.date ? ` (${cert.date})` : ""
              }`,
              size: 20,
            }),
          ],
        }),
      );
    }
  }

  const watermarkHeader = options.watermark
    ? new Header({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: options.watermark,
                bold: true,
                color: "C81E1E",
                size: 60,
              }),
            ],
          }),
        ],
      })
    : undefined;

  const file = new Document({
    creator: "JobPilot",
    title: `${doc.contact.name} — Resume`,
    sections: [
      {
        headers: watermarkHeader ? { default: watermarkHeader } : undefined,
        children,
      },
    ],
  });

  return Packer.toBuffer(file);
}
