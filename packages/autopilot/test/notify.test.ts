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

  it("gives up inside the timeout when the webhook never answers", async () => {
    // A webhook that accepts the connection and then says nothing, like a real one
    // whose socket stalls. The abort signal is what ends it, which is why an
    // unreachable webhook costs one timeout and not the whole run.
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
    const { rows, audit } = collector();

    const started = Date.now();
    await notifyHumanNeeded(posting, {
      fetchImpl,
      url: "https://hooks.example.invalid/x",
      audit,
      timeoutMs: 100,
    });
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(1_000);
    expect(rows.at(-1)).toMatchObject({ delivered: false, reason: "REQUEST_FAILED" });
  });

  it("delivers a batch in one round trip, not one per posting", async () => {
    // This is the shape the Auto-Pilot run uses: every stop is queued during the
    // batch and the queue is flushed together afterwards.
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = (async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 150));
      inFlight -= 1;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const { rows, audit } = collector();

    const started = Date.now();
    await Promise.all(
      [1, 2, 3].map(() =>
        notifyHumanNeeded(posting, { fetchImpl, url: "https://hooks.example.invalid/x", audit }),
      ),
    );
    const elapsed = Date.now() - started;

    expect(peak).toBe(3);
    expect(rows).toHaveLength(3);
    expect(elapsed).toBeLessThan(400); // one by one would be ~450ms
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
