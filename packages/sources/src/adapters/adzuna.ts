import { z } from "zod";
import { htmlToText } from "../html.js";
import { fetchJson } from "../http.js";
import {
  SourceFetchError,
  toJobDraft,
  type JobDraft,
} from "../types.js";

/** Subset of the Adzuna search API we depend on. */
const adzunaResultSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    title: z.string().min(1),
    company: z.object({ display_name: z.string().optional() }).passthrough().nullish(),
    location: z.object({ display_name: z.string().optional() }).passthrough().nullish(),
    redirect_url: z.string().min(1),
    description: z.string().optional(),
    created: z.string().optional(),
    salary_min: z.number().optional(),
    salary_max: z.number().optional(),
    contract_time: z.string().optional(),
  })
  .passthrough();

const adzunaPayloadSchema = z
  .object({ results: z.array(adzunaResultSchema) })
  .passthrough();

const REMOTE_RE = /\b(remote|anywhere|distributed)\b/i;

function isoOrNull(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function salaryOrNull(value: number | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

/** Adzuna is a search API, so a query stands in for a board (gate 3.7). */
export function parseAdzuna(payload: unknown, context: { query: string }): JobDraft[] {
  const parsed = adzunaPayloadSchema.parse(payload);
  return parsed.results.map((result) => {
    const location = result.location?.display_name?.trim() ?? null;
    const descriptionText =
      htmlToText(result.description ?? "") || "(no description provided)";
    const salaryMin = salaryOrNull(result.salary_min);
    const salaryMax = salaryOrNull(result.salary_max);
    return toJobDraft({
      source: "adzuna",
      externalId: String(result.id),
      url: result.redirect_url,
      company: result.company?.display_name?.trim() || "Unknown company",
      title: result.title,
      location,
      remote: Boolean(location && REMOTE_RE.test(location)),
      // A single advertised figure is both bounds, so the range stays valid.
      salaryMin,
      salaryMax: salaryMax ?? salaryMin,
      descriptionText,
      postedAt: isoOrNull(result.created),
      parsed: {
        provider: "adzuna",
        query: context.query,
        contractTime: result.contract_time ?? null,
      },
    });
  });
}

export interface AdzunaQuery {
  country: string;
  what: string;
  where?: string;
  appId?: string;
  appKey?: string;
  fetchImpl?: typeof fetch;
}

export async function fetchAdzuna(input: AdzunaQuery): Promise<JobDraft[]> {
  const appId = input.appId ?? process.env.ADZUNA_APP_ID;
  const appKey = input.appKey ?? process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    throw new SourceFetchError(
      "config",
      "adzuna",
      "Adzuna needs ADZUNA_APP_ID and ADZUNA_APP_KEY; every other board works without credentials",
    );
  }
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: "50",
    what: input.what,
  });
  if (input.where) params.set("where", input.where);
  const url = `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(
    input.country,
  )}/search/1?${params.toString()}`;
  const payload = await fetchJson(url, {
    provider: "adzuna",
    fetchImpl: input.fetchImpl,
  });
  return parseAdzuna(payload, { query: input.what });
}
