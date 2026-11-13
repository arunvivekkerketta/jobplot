import { describe, expect, it, vi } from "vitest";
import { fetchJson } from "../src/http.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("gate 3.9: fetching boards over HTTP", () => {
  it("retries a 503 and succeeds on the next attempt", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "busy" }, 503))
      .mockResolvedValueOnce(jsonResponse({ jobs: [] }, 200));
    const sleepImpl = vi.fn(async () => undefined);

    const body = await fetchJson("https://board.example/jobs", {
      provider: "greenhouse",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl,
      attempts: 3,
    });

    expect(body).toEqual({ jobs: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledWith(250);
  });

  it("does not retry a 404", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    const sleepImpl = vi.fn(async () => undefined);

    await expect(
      fetchJson("https://board.example/missing", {
        provider: "lever",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleepImpl,
      }),
    ).rejects.toMatchObject({ name: "SourceFetchError", kind: "http", status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("gives up after the attempt budget and reports the status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 502));
    const sleepImpl = vi.fn(async () => undefined);

    await expect(
      fetchJson("https://board.example/", {
        provider: "ashby",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleepImpl,
        attempts: 3,
        retryDelayMs: 10,
      }),
    ).rejects.toMatchObject({ status: 502 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenNthCalledWith(2, 20);
  });

  it("aborts a stalled board at the timeout instead of hanging", async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      })) as unknown as typeof fetch;

    await expect(
      fetchJson("https://board.example/slow", {
        provider: "adzuna",
        fetchImpl,
        timeoutMs: 5,
        attempts: 1,
      }),
    ).rejects.toMatchObject({ kind: "network" });
  });

  it("reports a non-JSON body as a parse failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected token <");
      },
    } as unknown as Response);

    await expect(
      fetchJson("https://board.example/html", {
        provider: "lever",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        attempts: 1,
      }),
    ).rejects.toMatchObject({ kind: "parse" });
  });
});
