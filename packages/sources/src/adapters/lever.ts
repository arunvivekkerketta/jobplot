import { z } from "zod";
import { htmlToText } from "../html.js";
import { fetchJson } from "../http.js";
import { toJobDraft, type JobDraft } from "../types.js";

/** Subset of the Lever postings API we depend on. */
const leverPostingSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    hostedUrl: z.string().min(1),
    createdAt: z.number().int().optional(),
    workplaceType: z.string().optional(),
    categories: z
      .object({
        location: z.string().optional(),
        team: z.string().optional(),
        commitment: z.string().optional(),
        allLocations: z.array(z.string()).optional(),
      })
      .passthrough()
      .nullish(),
    descriptionPlain: z.string().optional(),
    description: z.string().optional(),
    additionalPlain: z.string().optional(),
    lists: z
      .array(
        z
          .object({ text: z.string().optional(), content: z.string().optional() })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const leverPayloadSchema = z.array(leverPostingSchema);

const REMOTE_RE = /\b(remote|anywhere|distributed)\b/i;

function isoOrNull(epochMs: number | undefined): string | null {
  if (epochMs == null) return null;
  const date = new Date(epochMs);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Parses a Lever postings payload into normalized drafts (gate 3.5). */
export function parseLever(
  payload: unknown,
  context: { company: string },
): JobDraft[] {
  const postings = leverPayloadSchema.parse(payload);
  return postings.map((posting) => {
    const location = posting.categories?.location?.trim() ?? null;
    const sections = (posting.lists ?? [])
      .map((list) => {
        const title = list.text?.trim();
        const body = htmlToText(list.content ?? "");
        return [title, body].filter(Boolean).join("\n");
      })
      .filter(Boolean);
    const descriptionText =
      [
        posting.descriptionPlain?.trim() || htmlToText(posting.description ?? ""),
        posting.additionalPlain?.trim(),
        ...sections,
      ]
        .filter(Boolean)
        .join("\n\n")
        .trim() || "(no description provided)";

    return toJobDraft({
      source: "lever",
      externalId: posting.id,
      url: posting.hostedUrl,
      company: context.company,
      title: posting.text,
      location,
      remote:
        posting.workplaceType?.toLowerCase() === "remote" ||
        Boolean(location && REMOTE_RE.test(location)),
      descriptionText,
      postedAt: isoOrNull(posting.createdAt),
      parsed: {
        provider: "lever",
        company: context.company,
        team: posting.categories?.team ?? null,
        commitment: posting.categories?.commitment ?? null,
      },
    });
  });
}

export async function fetchLever(input: {
  token: string;
  company: string;
  fetchImpl?: typeof fetch;
}): Promise<JobDraft[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(
    input.token,
  )}?mode=json`;
  const payload = await fetchJson(url, {
    provider: "lever",
    fetchImpl: input.fetchImpl,
  });
  return parseLever(payload, { company: input.company });
}
