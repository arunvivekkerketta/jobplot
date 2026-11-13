import { describe, expect, it, vi } from "vitest";
import { parseManualPosting } from "../src/adapters/manual.js";
import { makeFetchSourcesHandler, parseBoardsEnv } from "../src/index.js";

const draft = parseManualPosting({
  title: "Backend Engineer",
  company: "NimbusPay",
  url: "https://nimbuspay.example/careers/backend",
  text: "Build payment services.",
});

describe("gate 3.15: fetch-sources consumer", () => {
  it("fetches, saves and audits a successful run", async () => {
    const fetchSourceJobs = vi.fn(async () => [draft]);
    const saveJobs = vi.fn(async () => ({
      created: 1,
      updated: 0,
      total: 1,
      ids: ["job-1"],
    }));
    const writeAudit = vi.fn(async () => undefined);
    const handler = makeFetchSourcesHandler({
      fetchSourceJobs,
      saveJobs,
      writeAudit,
    });

    const result = await handler({
      provider: "greenhouse",
      token: "acme",
      company: "Acme",
    });

    expect(result).toEqual({
      ok: true,
      provider: "greenhouse",
      created: 1,
      updated: 0,
      total: 1,
    });
    expect(fetchSourceJobs).toHaveBeenCalledWith({
      provider: "greenhouse",
      token: "acme",
      company: "Acme",
    });
    expect(saveJobs).toHaveBeenCalledWith([draft]);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "SYSTEM", action: "job.fetch" }),
    );
  });

  it("audits a dead board and returns failure instead of throwing", async () => {
    const fetchSourceJobs = vi.fn(async () => {
      throw new Error("lever returned HTTP 503");
    });
    const saveJobs = vi.fn();
    const writeAudit = vi.fn(async () => undefined);
    const handler = makeFetchSourcesHandler({
      fetchSourceJobs,
      saveJobs,
      writeAudit,
    });

    const result = await handler({ provider: "lever", token: "acme" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("HTTP 503");
    expect(saveJobs).not.toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "job.fetch.failed" }),
    );
  });

  it("rejects an unknown provider without touching the network", async () => {
    const fetchSourceJobs = vi.fn();
    const handler = makeFetchSourcesHandler({
      fetchSourceJobs,
      saveJobs: vi.fn(),
      writeAudit: vi.fn(async () => undefined),
    });

    const result = await handler({ provider: "monster", token: "acme" });

    expect(result).toMatchObject({ ok: false, error: "unknown board provider" });
    expect(fetchSourceJobs).not.toHaveBeenCalled();
  });
});

describe("gate 3.16: scheduled boards from the environment", () => {
  it("parses provider:token pairs and skips unknown or malformed entries", () => {
    expect(
      parseBoardsEnv("greenhouse:acme, monster:x, lever:acme-team, broken"),
    ).toEqual([
      { provider: "greenhouse", token: "acme", company: "acme" },
      { provider: "lever", token: "acme-team", company: "acme-team" },
    ]);
  });

  it("returns nothing when no boards are configured", () => {
    expect(parseBoardsEnv(undefined)).toEqual([]);
    expect(parseBoardsEnv("")).toEqual([]);
  });
});
