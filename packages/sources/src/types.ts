import { z } from "zod";

/** Providers that can produce a JobDraft. `manual` is the paste-a-posting path. */
export const SOURCE_PROVIDERS = [
  "greenhouse",
  "lever",
  "ashby",
  "adzuna",
  "manual",
] as const;
export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];

/** Providers that can be fetched over the network. */
export const BOARD_PROVIDERS = ["greenhouse", "lever", "ashby", "adzuna"] as const;
export type BoardProvider = (typeof BOARD_PROVIDERS)[number];

export function isBoardProvider(value: unknown): value is BoardProvider {
  return (
    typeof value === "string" &&
    (BOARD_PROVIDERS as readonly string[]).includes(value)
  );
}

/** Postings come from the open web, so the URL is validated, never trusted. */
const httpUrl = z
  .string()
  .min(1)
  .max(2000)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "must be an http(s) URL" },
  );

/**
 * The single normalized shape every adapter must produce. Everything the rest of
 * the system sees about a posting goes through this schema, so a malformed board
 * payload fails at the adapter boundary instead of becoming a half-filled Job row
 * (gate 3.1).
 */
export const jobDraftSchema = z
  .object({
    source: z.enum(SOURCE_PROVIDERS),
    externalId: z.string().min(1).max(200).nullish(),
    url: httpUrl,
    company: z.string().min(1).max(200),
    title: z.string().min(1).max(300),
    location: z.string().max(200).nullish(),
    remote: z.boolean().default(false),
    salaryMin: z.number().int().nonnegative().max(100_000_000).nullish(),
    salaryMax: z.number().int().nonnegative().max(100_000_000).nullish(),
    currency: z.string().length(3).nullish(),
    descriptionText: z.string().min(1).max(200_000),
    keywords: z.array(z.string().min(1).max(80)).max(100).default([]),
    postedAt: z.string().datetime().nullish(),
    parsed: z.record(z.unknown()).default({}),
  })
  .superRefine((draft, ctx) => {
    if (
      draft.salaryMin != null &&
      draft.salaryMax != null &&
      draft.salaryMin > draft.salaryMax
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["salaryMin"],
        message: "salaryMin must not exceed salaryMax",
      });
    }
  });

export type JobDraft = z.output<typeof jobDraftSchema>;
export type JobDraftInput = z.input<typeof jobDraftSchema>;

/** Validates an adapter's output at the boundary; adapters never emit raw shapes. */
export function toJobDraft(input: JobDraftInput): JobDraft {
  return jobDraftSchema.parse(input);
}

/** A resolved board to fetch: `token` is the board slug or an Adzuna query. */
export interface BoardFetchInput {
  provider: BoardProvider;
  token: string;
  company?: string;
  fetchImpl?: typeof fetch;
}

export type SourceErrorKind = "network" | "http" | "parse" | "config";

/** Typed failure so callers can map provider problems to the right HTTP status. */
export class SourceFetchError extends Error {
  readonly kind: SourceErrorKind;
  readonly provider: string;
  readonly status?: number;

  constructor(
    init: SourceErrorKind,
    provider: string,
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "SourceFetchError";
    this.kind = init;
    this.provider = provider;
    this.status = status;
  }
}
