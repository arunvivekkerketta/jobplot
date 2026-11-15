"use client";

import type { AutopilotStatus } from "@/lib/autopilot";
import { useRouter } from "next/navigation";
import { useState } from "react";

type ActionResult = {
  error?: string;
  queued?: number;
  submitted?: number;
  paused?: number;
  stopReason?: string | null;
  skipped?: Array<{ jobId: string; reason: string }>;
};

export default function AutopilotPanel({ initial }: { initial: AutopilotStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/autopilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json()) as ActionResult;
      if (!res.ok) {
        setError(payload.error ?? `Request failed (${res.status})`);
        return;
      }
      setResult(payload);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
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
                </span>
                {portal.unlocked ? (
                  <span className="space-x-3">
                    <span className="text-green-700">unlocked</span>
                    <button
                      type="button"
                      className="underline"
                      disabled={busy}
                      onClick={() => post({ action: "lock", portal: portal.portal })}
                      data-testid="portal-lock"
                    >
                      Lock
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => post({ action: "unlock", portal: portal.portal })}
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
                  {entry.title}: {entry.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => post({ action: "run", limit: 3 })}
            data-testid="run-autopilot"
          >
            {busy ? "Running…" : "Run Auto-Pilot"}
          </button>
          <button
            type="button"
            className="underline text-sm text-red-700"
            disabled={busy}
            onClick={() => post({ action: "stop" })}
            data-testid="stop-autopilot"
          >
            Stop (kill switch)
          </button>
        </div>
        {error && (
          <p className="text-sm text-red-600" role="alert" data-testid="autopilot-error">
            {error}
          </p>
        )}
        {result && (
          <p className="text-sm text-green-800" data-testid="autopilot-result">
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