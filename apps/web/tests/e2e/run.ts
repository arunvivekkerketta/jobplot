import { expect, type Page } from "@playwright/test";

export interface RunReport {
  queued: number;
  submitted: number;
  paused: number;
  stopReason: string | null;
  skipped: Array<{ jobId: string; reason: string; message?: string }>;
}

/**
 * 4.6: Run is queued, not executed, so every spec that wants a report has to wait
 * for the worker to finish the row it was given. The wait is on the run record
 * itself, which is what the page polls too.
 */
export async function queueAutopilotRun(
  page: Page,
  body: Record<string, unknown> = {},
): Promise<RunReport> {
  const queued = await page.request.post("/api/autopilot", {
    data: { action: "run", ...body },
  });
  expect(queued.status(), await queued.text()).toBe(202);
  const { runId } = (await queued.json()) as { runId: string };
  expect(runId).toBeTruthy();

  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const res = await page.request.get(`/api/autopilot/runs/${runId}`);
    expect(res.status(), await res.text()).toBe(200);
    const run = (await res.json()) as {
      status: string;
      result: RunReport | null;
      error: string | null;
    };
    if (run.status === "FAILED") {
      throw new Error(`run ${runId} failed: ${run.error ?? "no reason recorded"}`);
    }
    if (run.status === "DONE" && run.result) return run.result;
  }
  throw new Error(`run ${runId} did not finish within 150s`);
}
