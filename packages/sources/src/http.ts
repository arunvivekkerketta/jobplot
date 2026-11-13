import { SourceFetchError, type SourceErrorKind } from "./types.js";

export interface FetchJsonOptions {
  provider: string;
  fetchImpl?: typeof fetch;
  /** Per-attempt timeout. A board that stalls must not stall the queue. */
  timeoutMs?: number;
  /** Total attempts, including the first. */
  attempts?: number;
  /** Base backoff; doubles per retry. */
  retryDelayMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
  headers?: Record<string, string>;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const USER_AGENT = "JobPilotBot/0.1 (+https://github.com/jobpilot)";

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches and parses JSON with a bounded timeout, retrying only what is safe to
 * retry: network failures, timeouts, 429 and 5xx. A 4xx is a real answer and is
 * thrown immediately (gate 3.9).
 */
export async function fetchJson(
  url: string,
  options: FetchJsonOptions,
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelay = options.retryDelayMs ?? 250;
  const sleep = options.sleepImpl ?? defaultSleep;

  let lastError: SourceFetchError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "user-agent": USER_AGENT,
          ...options.headers,
        },
      });

      if (!response.ok) {
        const kind: SourceErrorKind = "http";
        const error = new SourceFetchError(
          kind,
          options.provider,
          `${options.provider} returned HTTP ${response.status} for ${url}`,
          response.status,
        );
        if (RETRYABLE_STATUS.has(response.status) && attempt < attempts) {
          lastError = error;
          await sleep(baseDelay * 2 ** (attempt - 1));
          continue;
        }
        throw error;
      }

      try {
        return (await response.json()) as unknown;
      } catch {
        throw new SourceFetchError(
          "parse",
          options.provider,
          `${options.provider} returned a body that is not JSON`,
          response.status,
        );
      }
    } catch (error) {
      if (error instanceof SourceFetchError) throw error;
      const aborted =
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError");
      const wrapped = new SourceFetchError(
        "network",
        options.provider,
        aborted
          ? `${options.provider} timed out after ${timeoutMs}ms`
          : `${options.provider} request failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
      );
      if (attempt < attempts) {
        lastError = wrapped;
        await sleep(baseDelay * 2 ** (attempt - 1));
        continue;
      }
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }
  }

  throw (
    lastError ??
    new SourceFetchError("network", options.provider, `${options.provider} fetch failed`)
  );
}
