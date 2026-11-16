"use client";

import type { AutopilotStatus } from "@jobpilot/autopilot";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type ActionResult = {
  error?: string;
  queued?: number;
  submitted?: number;
  paused?: number;
  stopReason?: string | null;
  skipped?: Array<{ jobId: string; reason: string; message?: string }>;
};

export default function AutopilotPanel({ initial }: { initial: AutopilotStatus }) {
  const router = useRouter();
  // Two flags on purpose: the Stop button must stay usable for the whole run, so
  // it cannot share the busy state that disables Run (H1).
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  async function post(
    body: Record<string, unknown>,
    options: { confirmText?: string; signal?: AbortSignal } = {},
  ): Promise<void> {
    if (options.confirmText && !window.confirm(options.confirmText)) return;
    const controller = options.signal ? null : new AbortController();
    if (controller) inFlight.current = controller;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/autopilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        ...(controller ? { signal: controller.signal } : {}),
      });
      const payload = (await res.json()) as ActionResult;
      if (!res.ok) {
        setError(payload.error ?? `Request failed (${res.status})`);
        return;
      }
      setResult(payload);
      router.refresh();
    } catch (err) {
      // An abort means the Stop button took over; it reports the outcome itself.
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setRunning(false);
      if (controller) inFlight.current = null;
    }
  }

  /**
   * The kill switch is written first and the pending run is abandoned, so Stop
   * acts immediately instead of waiting for a browser batch to finish (H1).
   */
  async function stop(): Promise<void> {
    setStopping(true);
    inFlight.current?.abort();
    setError(null);
    try {
      const res = await fetch("/api/autopilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      const payload = (await res.json()) as ActionResult;
      if (!res.ok) {
        setError(payload.error ?? `Stop failed (${res.status})`);
        return;
      }
      setResult({ stopReason: "KILL_SWITCH" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stop failed");
    } finally {
      setStopping(false);
    }
  }

  async function turnKillSwitchOff(): Promise<void> {
    setStopping(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ killSwitch: false }),
      });
      if (!res.ok) {
        const payload = (await res.json()) as { error?: string };
        setError(payload.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setStopping(false);
    }
  }

  return (
    <div className="space-y-6">
      {initial.killSwitch && (
        <div
          className="card flex flex-wrap items-center justify-between gap-3 border-l-4 border-red-600 text-sm"
          role="status"
          data-testid="kill-switch-banner"
        >
          <strong className="text-red-700">Kill switch is ON. Nothing will be submitted.</strong>
          <button
            type="button"
            className="btn-secondary"
            disabled={stopping}
            onClick={turnKillSwitchOff}
            data-testid="kill-switch-off"
          >
            Turn off
          </button>
        </div>
      )}

      <div className="card grid gap-2 text-sm sm:grid-cols-4" data-testid="autopilot-state">
        <p>
          Mode <strong>{initial.mode}</strong>
        </p>
        <p>
          Submissions <strong>{initial.allowSubmit ? "allowed" : "off"}</strong>
        </p>
        <p>
          Kill switch <strong>{initial.killSwitch ? "on" : "off"}</strong>
        </p>
        <p>
          Today <strong data-testid="autopilot-count">
            {initial.submissionsToday}/{initial.dailyCap}
          </strong>
        </p>
      </div>

      <div className="card" data-testid="autopilot-portals">
        <h2 className="font-semibold">Portals</h2>
        {initial.portals.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600">No postings imported yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {initial.portals.map((portal) => (
              <li
                key={portal.portal}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 pt-2 text-sm"
                data-testid="portal-row"
                data-portal={portal.portal}
                data-unlocked={portal.unlocked ? "true" : "false"}
              >
                <span>
                  <strong>{portal.portal}</strong> · {portal.open} open ·{" "}
                  {portal.submissionsToday} submitted today
                  <span
                    className="ml-2 text-xs text-neutral-600"
                    data-testid="portal-trust"
                  >
                    {portal.approved} of {portal.required} approved on Co-Pilot
                  </span>
                </span>
                {portal.unlocked ? (
                  <span className="space-x-3">
                    <span className="text-green-700">unlocked</span>
                    <button
                      type="button"
                      className="underline"
                      disabled={running}
                      onClick={() => post({ action: "lock", portal: portal.portal })}
                      data-testid="portal-lock"
                    >
                      Lock
                    </button>
                  </span>
                ) : portal.remaining > 0 ? (
                  // 4.2: the portal is earned, not chosen, so the control says
                  // why it is unavailable instead of only being greyed out.
                  <span className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled
                      data-testid="portal-unlock-blocked"
                    >
                      Unlock
                    </button>
                    <span data-testid="portal-trust-hint">
                      Approve {portal.remaining} more Co-Pilot application
                      {portal.remaining === 1 ? "" : "s"} first
                    </span>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={running}
                    onClick={() =>
                      post(
                        { action: "unlock", portal: portal.portal },
                        {
                          confirmText:
                            `Unlock ${portal.portal} for Auto-Pilot?\n\n` +
                            `This lets JobPilot submit applications for you on ${portal.portal}, ` +
                            `up to ${initial.dailyCap} per day, without asking again.`,
                        },
                      )
                    }
                    data-testid="portal-unlock"
                  >
                    Unlock
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Queue</h2>
        {initial.eligible.length === 0 ? (
          <p className="text-sm text-neutral-600" data-testid="queue-empty">
            Nothing is eligible right now.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {initial.eligible.map((candidate) => (
              <li key={candidate.jobId} data-testid="queue-row" data-score={candidate.score}>
                {candidate.title} · {candidate.portal} · score {candidate.score}
              </li>
            ))}
          </ul>
        )}
        {initial.skipped.length > 0 && (
          <div className="text-sm text-neutral-600" data-testid="queue-skipped">
            <p className="font-medium">Skipped</p>
            <ul className="mt-1 space-y-1">
              {initial.skipped.map((entry) => (
                <li key={`${entry.jobId}-${entry.reason}`}>
                  {entry.title}: {entry.message || entry.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="btn-primary"
            disabled={running}
            aria-busy={running}
            onClick={() =>
              post(
                { action: "run", limit: 3 },
                {
                  confirmText:
                    `Run Auto-Pilot now?\n\nJobPilot may submit up to ${initial.dailyCap} ` +
                    `applications today on the portals you unlocked, without asking again.`,
                },
              )
            }
            data-testid="run-autopilot"
          >
            {running ? "Running…" : "Run Auto-Pilot"}
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={stopping}
            onClick={stop}
            data-testid="stop-autopilot"
          >
            {stopping ? "Stopping…" : "Stop"}
          </button>
        </div>
        {error && (
          <p className="text-sm text-red-600" role="alert" data-testid="autopilot-error">
            {error}
          </p>
        )}
        {result && (
          <p className="text-sm text-green-800" role="status" data-testid="autopilot-result">
            {result.queued === undefined
              ? `Stopped (${result.stopReason ?? "kill switch"}).`
              : `Queued ${result.queued}, submitted ${result.submitted}, paused ${
                  result.paused ?? 0
                }${result.stopReason ? `, stopped: ${result.stopReason}` : ""}.`}
          </p>
        )}
      </div>

      <div className="card text-sm" data-testid="autopilot-last-run">
        <h2 className="font-semibold">Last run</h2>
        {initial.lastRun ? (
          <p className="mt-2 text-neutral-700">
            {new Date(initial.lastRun.at).toLocaleString()} — queued {initial.lastRun.queued},
            submitted {initial.lastRun.submitted}, paused {initial.lastRun.paused}
            {initial.lastRun.stopReason ? `, stopped: ${initial.lastRun.stopReason}` : ""}
          </p>
        ) : (
          <p className="mt-2 text-neutral-600">No Auto-Pilot run yet.</p>
        )}
      </div>
    </div>
  );
}
