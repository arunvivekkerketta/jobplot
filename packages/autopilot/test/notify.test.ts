import { describe, expect, it, vi } from "vitest";
import { notifyHumanNeeded } from "../src/notify.js";

const posting = {
  title: "Backend Engineer",
  company: "NimbusPay",
  portal: "greenhouse",
  reason: "CAPTCHA",
};

function collector() {
  const rows: Record<string, unknown>[] = [];
  return { rows, audit: async (payload: Record<string, unknown>) => void rows.push(payload) };
}

describe("gate 4.5: a human-needed stop is announced once, with codes only (M6)", () => {
  it("posts the reason and never personal data", async () => {
    const bodies: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const { rows, audit } = collector();

    await notifyHumanNeeded(posting, {
      fetchImpl,
      url: "https://hooks.example.invalid/jobpilot",
      audit,
    });

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("CAPTCHA");
    expect(bodies[0]).toContain("Backend Engineer");
    expect(bodies[0]).not.toContain("priya@example.com");
    expect(bodies[0]).not.toContain("answer");
    expect(rows.at(-1)).toMatchObject({ delivered: true, status: 204 });
  });

  it("refuses an http endpoint instead of sending in clear text", async () => {
    const fetchImpl = vi.fn();
    const { rows, audit } = collector();

    await notifyHumanNeeded(posting, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      url: "http://hooks.example.invalid/jobpilot",
      audit,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(rows.at(-1)).toMatchObject({ delivered: false, reason: "INSECURE_URL" });
  });

  it("records the row when no webhook is configured", async () => {
    const { rows, audit } = collector();
    await notifyHumanNeeded(posting, { url: "", audit });
    expect(rows.at(-1)).toMatchObject({ delivered: false, reason: "NOT_CONFIGURED" });
  });

  it("records a failed delivery without throwing", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const { rows, audit } = collector();

    await expect(
      notifyHumanNeeded(posting, { fetchImpl, url: "https://hooks.example.invalid/x", audit }),
    ).resolves.toBeUndefined();
    expect(rows.at(-1)).toMatchObject({ delivered: false, reason: "REQUEST_FAILED" });
  });
});
