import { fetchAdzuna } from "./adapters/adzuna.js";
import { fetchAshby } from "./adapters/ashby.js";
import { fetchGreenhouse } from "./adapters/greenhouse.js";
import { fetchLever } from "./adapters/lever.js";
import {
  isBoardProvider,
  type BoardFetchInput,
  type JobDraft,
} from "./types.js";

export * from "./types.js";
export * from "./canonical.js";
export * from "./html.js";
export * from "./http.js";
export { parseGreenhouse, fetchGreenhouse } from "./adapters/greenhouse.js";
export { parseLever, fetchLever } from "./adapters/lever.js";
export { parseAshby, fetchAshby } from "./adapters/ashby.js";
export { parseAdzuna, fetchAdzuna } from "./adapters/adzuna.js";
export {
  parseManualPosting,
  type ManualPostingInput,
} from "./adapters/manual.js";

/** The one entry point that turns a board name plus token into normalized drafts. */
export async function fetchSourceJobs(
  input: BoardFetchInput,
): Promise<JobDraft[]> {
  const company = input.company?.trim() || input.token;
  switch (input.provider) {
    case "greenhouse":
      return fetchGreenhouse({
        token: input.token,
        company,
        fetchImpl: input.fetchImpl,
      });
    case "lever":
      return fetchLever({
        token: input.token,
        company,
        fetchImpl: input.fetchImpl,
      });
    case "ashby":
      return fetchAshby({
        token: input.token,
        company,
        fetchImpl: input.fetchImpl,
      });
    case "adzuna":
      return fetchAdzuna({
        country: process.env.ADZUNA_COUNTRY ?? "us",
        what: input.token,
        appId: process.env.ADZUNA_APP_ID,
        appKey: process.env.ADZUNA_APP_KEY,
        fetchImpl: input.fetchImpl,
      });
    default: {
      const exhaustive: never = input.provider;
      throw new Error(`Unsupported board provider: ${String(exhaustive)}`);
    }
  }
}

export interface SavedJobs {
  created: number;
  updated: number;
  total: number;
  ids: string[];
}

/** Injected so the worker stays a thin shell around testable logic. */
export interface FetchSourcesDeps {
  fetchSourceJobs: (input: BoardFetchInput) => Promise<JobDraft[]>;
  saveJobs: (drafts: JobDraft[]) => Promise<SavedJobs>;
  writeAudit: (entry: {
    actor: "SYSTEM" | "USER";
    action: string;
    entityType: string;
    payload: Record<string, unknown>;
  }) => Promise<void>;
}

export interface FetchSourcesPayload {
  provider: string;
  token: string;
  company?: string;
}

export interface FetchSourcesResult {
  ok: boolean;
  provider: string;
  created: number;
  updated: number;
  total: number;
  error?: string;
}

/**
 * The `fetch-sources` consumer. A dead board must not wedge the queue, so a
 * failed fetch is audited and returned as `ok: false` instead of thrown
 * (gate 3.14). Every attempt leaves a trail (I8).
 */
export function makeFetchSourcesHandler(deps: FetchSourcesDeps) {
  return async function handleFetchSources(
    payload: FetchSourcesPayload,
  ): Promise<FetchSourcesResult> {
    if (!isBoardProvider(payload.provider)) {
      return {
        ok: false,
        provider: String(payload.provider),
        created: 0,
        updated: 0,
        total: 0,
        error: "unknown board provider",
      };
    }

    try {
      const drafts = await deps.fetchSourceJobs({
        provider: payload.provider,
        token: payload.token,
        company: payload.company,
      });
      const saved = await deps.saveJobs(drafts);
      await deps.writeAudit({
        actor: "SYSTEM",
        action: "job.fetch",
        entityType: "Job",
        payload: {
          provider: payload.provider,
          token: payload.token,
          fetched: drafts.length,
          created: saved.created,
          updated: saved.updated,
        },
      });
      return {
        ok: true,
        provider: payload.provider,
        created: saved.created,
        updated: saved.updated,
        total: saved.total,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await deps.writeAudit({
        actor: "SYSTEM",
        action: "job.fetch.failed",
        entityType: "Job",
        payload: {
          provider: payload.provider,
          token: payload.token,
          error: message,
        },
      });
      return {
        ok: false,
        provider: payload.provider,
        created: 0,
        updated: 0,
        total: 0,
        error: message,
      };
    }
  };
}

/** Boards scheduled by the worker, as `provider:token,provider:token`. */
export const JOB_BOARDS_ENV = "JOB_BOARDS";

export function parseBoardsEnv(
  value: string | undefined,
): { provider: BoardFetchInput["provider"]; token: string; company: string }[] {
  if (!value) return [];
  const boards: {
    provider: BoardFetchInput["provider"];
    token: string;
    company: string;
  }[] = [];
  for (const entry of value.split(",")) {
    const [rawProvider, ...rest] = entry.trim().split(":");
    const token = rest.join(":").trim();
    if (!rawProvider || !token) continue;
    const provider = rawProvider.trim().toLowerCase();
    if (!isBoardProvider(provider)) continue;
    boards.push({ provider, token, company: token });
  }
  return boards;
}
