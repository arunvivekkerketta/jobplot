import { wrapUntrusted } from "@jobpilot/llm";
import { htmlToText } from "../html.js";
import { toJobDraft, type JobDraft } from "../types.js";

export interface ManualPostingInput {
  title: string;
  company: string;
  url: string;
  /** Already plain text, e.g. copied out of a posting. */
  text?: string;
  /** Raw HTML, e.g. copied page source. Converted with htmlToText. */
  html?: string;
  location?: string;
  postedAt?: string;
  keywords?: string[];
}

const REMOTE_RE = /\b(remote|anywhere|distributed)\b/i;

/**
 * Normalizes a posting the user pasted instead of one fetched from a board.
 * The description is untrusted text, so a delimiter-wrapped copy is stored
 * alongside it for anything that later feeds an LLM (invariant I2, gate 3.8).
 */
export function parseManualPosting(input: ManualPostingInput): JobDraft {
  const location = input.location?.trim() || null;
  const descriptionText =
    input.text?.trim() ||
    htmlToText(input.html ?? "") ||
    "(no description provided)";

  return toJobDraft({
    source: "manual",
    url: input.url,
    company: input.company,
    title: input.title,
    location,
    remote: Boolean(location && REMOTE_RE.test(location)),
    descriptionText,
    keywords: input.keywords ?? [],
    postedAt: input.postedAt ? new Date(input.postedAt).toISOString() : null,
    parsed: {
      provider: "manual",
      untrustedDescription: wrapUntrusted("job-description", descriptionText),
    },
  });
}
