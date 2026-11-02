import type { ResumeDocument } from "@jobpilot/core";
import { formatDateRange as dateRange } from "./dates.js";

export interface HtmlRenderOptions {
  /**
   * Baked into the markup (I6). Passing "SAMPLE" produces a fixed overlay the
   * renderer never removes; there is no runtime flag to hide it again.
   */
  watermark?: string;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}


/**
 * Single-column, semantic HTML with no tables, images, columns or external
 * assets, so ATS parsers see the same order a human does.
 */
export function renderResumeHtml(
  doc: ResumeDocument,
  options: HtmlRenderOptions = {},
): string {
  const contactBits = [
    doc.contact.email,
    doc.contact.phone,
    doc.contact.location,
    doc.contact.url,
  ].filter((v): v is string => Boolean(v));

  const roles = doc.roles
    .map(
      (r) => `      <article class="entry">
        <h3>${escapeHtml(r.title)} — ${escapeHtml(r.company)}</h3>
        <p class="meta">${escapeHtml(dateRange(r.startDate, r.endDate))}</p>
        ${r.summary ? `<p>${escapeHtml(r.summary)}</p>` : ""}
        ${
          r.highlights.length > 0
            ? `<ul>\n${r.highlights
                .map((h) => `          <li>${escapeHtml(h)}</li>`)
                .join("\n")}\n        </ul>`
            : ""
        }
      </article>`,
    )
    .join("\n");

  const education = doc.education
    .map((e) => {
      const degree = [e.studyType, e.area].filter(Boolean).join(" ");
      return `      <article class="entry">
        <h3>${escapeHtml(degree || e.institution)}</h3>
        <p class="meta">${escapeHtml(e.institution)}${
          e.startDate || e.endDate ? ` · ${escapeHtml(dateRange(e.startDate, e.endDate))}` : ""
        }</p>
        ${e.score ? `<p class="meta">${escapeHtml(e.score)}</p>` : ""}
      </article>`;
    })
    .join("\n");

  const skills = doc.skills
    .map(
      (s) =>
        `      <p><strong>${escapeHtml(s.name)}</strong>${
          s.level ? ` (${escapeHtml(s.level)})` : ""
        }: ${escapeHtml(s.keywords.join(", "))}</p>`,
    )
    .join("\n");

  const projects = doc.projects
    .map(
      (p) => `      <article class="entry">
        <h3>${escapeHtml(p.name)}</h3>
        <p class="meta">${escapeHtml(dateRange(p.startDate, p.endDate))}</p>
        ${p.description ? `<p>${escapeHtml(p.description)}</p>` : ""}
        ${
          p.highlights.length > 0
            ? `<ul>\n${p.highlights
                .map((h) => `          <li>${escapeHtml(h)}</li>`)
                .join("\n")}\n        </ul>`
            : ""
        }
      </article>`,
    )
    .join("\n");

  const certificates = doc.certificates
    .map(
      (c) =>
        `      <li>${escapeHtml(c.name)}${
          c.issuer ? ` — ${escapeHtml(c.issuer)}` : ""
        }${c.date ? ` (${escapeHtml(c.date)})` : ""}</li>`,
    )
    .join("\n");

  const watermark = options.watermark
    ? `\n    <div class="watermark" aria-hidden="false">${escapeHtml(options.watermark)}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(doc.contact.name)} — Resume</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 32px 40px;
        background: #ffffff;
        color: #111111;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 11.5pt;
        line-height: 1.45;
      }
      header { border-bottom: 1px solid #d4d4d4; padding-bottom: 12px; margin-bottom: 18px; }
      h1 { margin: 0; font-size: 22pt; letter-spacing: 0.01em; }
      h2 {
        margin: 22px 0 8px;
        font-size: 12pt;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        border-bottom: 1px solid #d4d4d4;
        padding-bottom: 3px;
      }
      h3 { margin: 0; font-size: 11.5pt; }
      p { margin: 3px 0; }
      .contact { color: #333333; font-size: 10.5pt; }
      .meta { color: #555555; font-size: 10pt; }
      .entry { margin-bottom: 12px; page-break-inside: avoid; }
      ul { margin: 4px 0 0 18px; padding: 0; }
      li { margin-bottom: 3px; }
      .watermark {
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        transform: rotate(-32deg);
        font-family: Arial, Helvetica, sans-serif;
        font-size: 96pt;
        font-weight: 700;
        letter-spacing: 0.12em;
        color: rgba(200, 30, 30, 0.18);
        pointer-events: none;
        z-index: 9999;
      }
      @media print {
        body { padding: 0; }
        .watermark { position: fixed; }
      }
    </style>
  </head>
  <body>${watermark}
    <header>
      <h1>${escapeHtml(doc.contact.name)}</h1>
      <p class="contact">${escapeHtml(contactBits.join(" · "))}</p>
      ${doc.contact.summary ? `<p>${escapeHtml(doc.contact.summary)}</p>` : ""}
    </header>
${roles ? `    <section>\n      <h2>Experience</h2>\n${roles}\n    </section>\n` : ""}${
    education
      ? `    <section>\n      <h2>Education</h2>\n${education}\n    </section>\n`
      : ""
  }${
    skills
      ? `    <section>\n      <h2>Skills</h2>\n${skills}\n    </section>\n`
      : ""
  }${
    projects
      ? `    <section>\n      <h2>Projects</h2>\n${projects}\n    </section>\n`
      : ""
  }${
    certificates
      ? `    <section>\n      <h2>Certificates</h2>\n      <ul>\n${certificates}\n      </ul>\n    </section>\n`
      : ""
  }  </body>
</html>
`;
}
