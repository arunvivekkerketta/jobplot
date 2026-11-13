import { z } from "zod";
import { htmlToText } from "../html.js";
import { fetchJson } from "../http.js";
import { toJobDraft, type JobDraft } from "../types.js";

/** Subset of the Ashby public job-board API we depend on. */
const ashbyJobSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    location: z.string().optional(),
    department: z.string().optional(),
    employmentType: z.string().optional(),
    publishedAt: z.string().optional(),
    isRemote: z.boolean().optional(),
    descriptionHtml: z.string().optional(),
    descriptionPlain: z.string().optional(),
    jobUrl: z.string().min(1),
    applyUrl: z.string().optional(),
    compensation: z.object({ compensationTierSummary: z.string().optional() }).passthrough().nullish(),
  })
  .passthrough();

const ashbyPayloadSchema = z
  .object({ jobs: z.array(ashbyJobSchema) })
  .passthrough();

const REMOTE_RE = /\b(remote|anywhere|distributed)\b/i;

function isoOrNull(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Extracts trailing integers out of a compensation summary like "$120K – $160K". */
function salaryRangeFrom(summary: string | undefined): {
  salaryMin: number | null;
  salaryMax: number | null;
} {
  if (!summary) return { salaryMin: null, salaryMax: null };
  const matches = [...summary.matchAll(/(\d+(?:\.\d+)?)\s*([kK])?/g)]
    .map((match) => {
      const value = Number(match[1]);
      if (!Number.isFinite(value)) return null;
      return Math.round(value * (match[2] ? 1000 : 1));
    })
    .filter((value): value is number => value !== null && value >= 1000);
  if (matches.length === 0) return { salaryMin: null, salaryMax: null };
  return {
    salaryMin: Math.min(...matches),
    salaryMax: Math.max(...matches),
  };
}

/** Parses an Ashby job-board payload into normalized drafts (gate 3.6). */
export function parseAshby(
  payload: unknown,
  context: { company: string },
): JobDraft[] {
  const parsed = ashbyPayloadSchema.parse(payload);
  return parsed.jobs.map((job) => {
    const location = job.location?.trim() ?? null;
    const descriptionText =
      job.descriptionPlain?.trim() ||
      htmlToText(job.descriptionHtml ?? "") ||
      "(no description provided)";
    const salary = salaryRangeFrom(
      job.compensation?.compensationTierSummary ?? undefined,
    );
    return toJobDraft({
      source: "ashby",
      externalId: job.id,
      url: job.jobUrl,
      company: context.company,
      title: job.title,
      location,
      remote:
        job.isRemote === true || Boolean(location && REMOTE_RE.test(location)),
      salaryMin: salary.salaryMin,
      salaryMax: salary.salaryMax,
      descriptionText,
      postedAt: isoOrNull(job.publishedAt),
      parsed: {
        provider: "ashby",
        company: context.company,
        department: job.department ?? null,
        employmentType: job.employmentType ?? null,
        applyUrl: job.applyUrl ?? null,
      },
    });
  });
}

export async function fetchAshby(input: {
  token: string;
  company: string;
  fetchImpl?: typeof fetch;
}): Promise<JobDraft[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(
    input.token,
  )}?includeCompensation=true`;
  const payload = await fetchJson(url, {
    provider: "ashby",
    fetchImpl: input.fetchImpl,
  });
  return parseAshby(payload, { company: input.company });
}
