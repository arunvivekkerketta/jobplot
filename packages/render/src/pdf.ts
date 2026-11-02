import PDFDocument from "pdfkit";
import type { ResumeDocument } from "@jobpilot/core";
import { formatDateRange } from "./dates.js";

export interface PdfRenderOptions {
  watermark?: string;
}

const INK = "#111111";
const MUTED = "#555555";
const RULE = "#d4d4d4";
const MARGIN_X = 52;
const MARGIN_BOTTOM = 50;

/**
 * Text-based PDF (real selectable text, no images), so ATS parsers can read
 * it. Watermarks are drawn onto every page, including pages pdfkit adds later.
 */
export function renderResumePdf(
  doc: ResumeDocument,
  options: PdfRenderOptions = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: "A4",
      margins: { top: 50, bottom: MARGIN_BOTTOM, left: MARGIN_X, right: MARGIN_X },
      info: {
        Title: `${doc.contact.name} — Resume`,
        Author: doc.contact.name,
        Creator: "JobPilot",
      },
    });

    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.once("end", () => resolve(Buffer.concat(chunks)));
    pdf.once("error", reject);

    const drawWatermark = (): void => {
      if (!options.watermark) return;
      const { width, height } = pdf.page;
      pdf.save();
      pdf.opacity(0.14).fillColor("#c81e1e").font("Helvetica-Bold").fontSize(78);
      pdf.rotate(-32, { origin: [width / 2, height / 2] });
      pdf.text(options.watermark, 0, height / 2 - 40, {
        width,
        align: "center",
        lineBreak: false,
      });
      pdf.restore();
    };
    pdf.on("pageAdded", drawWatermark);
    drawWatermark();

    const ensureSpace = (needed: number): void => {
      if (pdf.y + needed > pdf.page.height - MARGIN_BOTTOM) pdf.addPage();
    };

    const heading = (text: string): void => {
      ensureSpace(40);
      pdf.moveDown(0.9);
      pdf
        .fillColor(INK)
        .font("Helvetica-Bold")
        .fontSize(10.5)
        .text(text.toUpperCase(), { characterSpacing: 1.1 });
      const y = pdf.y + 2;
      pdf
        .moveTo(MARGIN_X, y)
        .lineTo(pdf.page.width - MARGIN_X, y)
        .strokeColor(RULE)
        .lineWidth(0.6)
        .stroke();
      pdf.moveDown(0.45);
    };

    const bullets = (items: string[]): void => {
      for (const item of items) {
        ensureSpace(18);
        pdf
          .fillColor(INK)
          .font("Helvetica")
          .fontSize(10)
          .text(`•  ${item}`, MARGIN_X + 8, pdf.y, {
            width: pdf.page.width - MARGIN_X * 2 - 8,
            paragraphGap: 1,
          });
      }
    };

    // Header
    pdf.fillColor(INK).font("Helvetica-Bold").fontSize(21).text(doc.contact.name);
    const contact = [
      doc.contact.email,
      doc.contact.phone,
      doc.contact.location,
      doc.contact.url,
    ].filter((v): v is string => Boolean(v));
    pdf.fillColor(MUTED).font("Helvetica").fontSize(9.5).text(contact.join("  ·  "));
    if (doc.contact.summary) {
      pdf.moveDown(0.5).fillColor(INK).fontSize(10.5).text(doc.contact.summary);
    }

    if (doc.roles.length > 0) {
      heading("Experience");
      for (const role of doc.roles) {
        ensureSpace(46);
        pdf
          .fillColor(INK)
          .font("Helvetica-Bold")
          .fontSize(11)
          .text(`${role.title} — ${role.company}`);
        pdf
          .fillColor(MUTED)
          .font("Helvetica")
          .fontSize(9.5)
          .text(formatDateRange(role.startDate, role.endDate));
        if (role.summary) pdf.fillColor(INK).fontSize(10).text(role.summary);
        if (role.highlights.length > 0) bullets(role.highlights);
        pdf.moveDown(0.6);
      }
    }

    if (doc.education.length > 0) {
      heading("Education");
      for (const edu of doc.education) {
        ensureSpace(36);
        const degree = [edu.studyType, edu.area].filter(Boolean).join(" ");
        pdf
          .fillColor(INK)
          .font("Helvetica-Bold")
          .fontSize(10.5)
          .text(degree || edu.institution);
        pdf
          .fillColor(MUTED)
          .font("Helvetica")
          .fontSize(9.5)
          .text(
            `${edu.institution}${
              edu.startDate || edu.endDate
                ? `  ·  ${formatDateRange(edu.startDate, edu.endDate)}`
                : ""
            }`,
          );
        if (edu.score) pdf.fillColor(INK).fontSize(9.5).text(edu.score);
        pdf.moveDown(0.5);
      }
    }

    if (doc.skills.length > 0) {
      heading("Skills");
      for (const group of doc.skills) {
        ensureSpace(18);
        const label = group.level ? `${group.name} (${group.level})` : group.name;
        pdf
          .fillColor(INK)
          .font("Helvetica-Bold")
          .fontSize(10)
          .text(`${label}: `, { continued: true })
          .font("Helvetica")
          .text(group.keywords.join(", "));
      }
    }

    if (doc.projects.length > 0) {
      heading("Projects");
      for (const project of doc.projects) {
        ensureSpace(40);
        pdf.fillColor(INK).font("Helvetica-Bold").fontSize(10.5).text(project.name);
        const range = formatDateRange(project.startDate, project.endDate);
        if (range) pdf.fillColor(MUTED).font("Helvetica").fontSize(9.5).text(range);
        if (project.description) {
          pdf.fillColor(INK).fontSize(10).text(project.description);
        }
        if (project.highlights.length > 0) bullets(project.highlights);
        pdf.moveDown(0.5);
      }
    }

    if (doc.certificates.length > 0) {
      heading("Certificates");
      for (const cert of doc.certificates) {
        ensureSpace(18);
        pdf
          .fillColor(INK)
          .font("Helvetica")
          .fontSize(10)
          .text(
            `${cert.name}${cert.issuer ? ` — ${cert.issuer}` : ""}${
              cert.date ? ` (${cert.date})` : ""
            }`,
          );
      }
    }

    pdf.end();
  });
}
