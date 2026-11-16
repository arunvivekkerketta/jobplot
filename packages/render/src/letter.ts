import {
  formatLetter,
  letterTitle,
  letterWatermark,
  type LetterDraft,
} from "@jobpilot/core";
import { escapeHtml } from "./html.js";

export interface LetterRender {
  text: string;
  html: string;
  /** Derived from the kind alone; there is no parameter to change it (I6). */
  watermark: "DRAFT" | "SAMPLE";
}

/**
 * Renders one letter as plain text and as HTML.
 *
 * The watermark is fixed, repeated in the markup and repeated in the text, so a
 * "draft" screenshot or a copy-paste still says what it is. A MOCK_OFFER reply is
 * always marked SAMPLE, whatever the caller intended (I6).
 */
export function renderLetter(draft: LetterDraft): LetterRender {
  const watermark = letterWatermark(draft.kind);
  const title = letterTitle(draft.kind);

  const html = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8"/>',
    `<title>${escapeHtml(watermark)} · ${escapeHtml(title)}</title>`,
    "<style>",
    ".letter-watermark{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;",
    "transform:rotate(-30deg);font-size:96px;font-weight:700;letter-spacing:12px;",
    "color:rgba(0,0,0,.10);pointer-events:none;z-index:10}",
    ".letter-mark{font-weight:700;letter-spacing:2px}",
    "main{font-family:Georgia,serif;line-height:1.5;max-width:38rem;margin:2rem auto;padding:0 1.5rem}",
    "</style>",
    "</head>",
    "<body>",
    `<div class="letter-watermark" aria-hidden="true">${escapeHtml(watermark)}</div>`,
    "<main>",
    `<p class="letter-mark">[${escapeHtml(watermark)}] ${escapeHtml(title)}</p>`,
    `<p class="letter-mark">Subject: ${escapeHtml(draft.subject)}</p>`,
    ...draft.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`),
    `<p class="letter-mark">[${escapeHtml(watermark)}] Review every claim before sending.</p>`,
    "</main>",
    "</body>",
    "</html>",
  ].join("\n");

  return { text: formatLetter(draft), html, watermark };
}
