import { z } from "zod";
import { htmlToText } from "../html.js";
import { fetchJson } from "../http.js";
import { toJobDraft, type JobDraft } from "../types.js";

/** Subset of the Greenhouse board API we depend on. */
const greenhouseJobSchema = z
  .object({
    id: z.number().int(),
    title: z.string().min(1),
    absolute_url: z.string().min(1),
    updated_at: z.string().optional(),
    location: z.object({ name: z.string().optional() }).nullish(),
    content: z.string().optional(),
    metadata: z.array(z.unknown()).optional(),
  })
  .passthrough();

const greenhousePayloadSchema = z
  .object({ jobs: z.array(greenhouseJobSchema) })
  .passthrough();

const REMOTE_RE = /\b(remote|anywhere|distributed)\b/i;

function isoOrNull(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Parses a Greenhouse board payload into normalized drafts (gate 3.4). */
export function parseGreenhouse(
  payload: unknown,
  context: { company: string },
): JobDraft[] {
  const parsed = greenhousePayloadSchema.parse(payload);
  return parsed.jobs.map((job) => {
    const location = job.location?.name?.trim() ?? null;
    const descriptionText =
      htmlToText(job.content ?? "") || "(no description provided)";
    return toJobDraft({
      source: "greenhouse",
      externalId: String(job.id),
      url: job.absolute_url,
      company: context.company,
      title: job.title,
      location,
      remote: Boolean(location && REMOTE_RE.test(location)),
      descriptionText,
      postedAt: isoOrNull(job.updated_at),
      parsed: {
        provider: "greenhouse",
        company: context.company,
        metadataCount: job.metadata?.length ?? 0,
      },
    });
  });
}

export async function fetchGreenhouse(input: {
  token: string;
  company: string;
  fetchImpl?: typeof fetch;
}): Promise<JobDraft[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
    input.token,
  )}/jobs?content=true`;
  const payload = await fetchJson(url, {
    provider: "greenhouse",
    fetchImpl: input.fetchImpl,
  });
  return parseGreenhouse(payload, { company: input.company });
}
