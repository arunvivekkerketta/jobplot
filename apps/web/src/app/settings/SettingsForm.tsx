"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface SettingsData {
  mode: string;
  dailyCap: number;
  matchThreshold: number;
  killSwitch: boolean;
  allowSubmit: boolean;
}

interface Issue {
  path: Array<string | number>;
  message: string;
}

const FIELD_LABELS: Record<string, string> = {
  mode: "Mode",
  dailyCap: "Daily cap",
  matchThreshold: "Match threshold",
  killSwitch: "Kill switch",
  allowSubmit: "allowSubmit",
};

/** A zod issue becomes "Daily cap: must be 1 to 25"; the message comes from the schema. */
function fieldErrors(issues: Issue[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "form");
    errors[field] = `${FIELD_LABELS[field] ?? field}: ${issue.message}`;
  }
  return errors;
}

export default function SettingsForm({ initial }: { initial: SettingsData }) {
  const router = useRouter();
  const [mode, setMode] = useState(initial.mode);
  const [allowSubmit, setAllowSubmit] = useState(initial.allowSubmit);
  // Kept as text so an empty box is detected instead of becoming NaN.
  const [dailyCap, setDailyCap] = useState(String(initial.dailyCap));
  const [matchThreshold, setMatchThreshold] = useState(String(initial.matchThreshold));
  const [killSwitch, setKillSwitch] = useState(initial.killSwitch);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    setError(null);

    const localErrors: Record<string, string> = {};
    if (dailyCap.trim() === "") localErrors.dailyCap = "Daily cap: enter a number from 1 to 25.";
    if (matchThreshold.trim() === "") {
      localErrors.matchThreshold = "Match threshold: enter a number from 0 to 100.";
    }
    if (Object.keys(localErrors).length > 0) {
      setErrors(localErrors);
      return;
    }

    setErrors({});
    setBusy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          allowSubmit,
          dailyCap: Number(dailyCap),
          matchThreshold: Number(matchThreshold),
          killSwitch,
        }),
      });
      if (res.ok) {
        setSaved(true);
        router.refresh();
        return;
      }
      const body = (await res.json()) as { error?: string; issues?: Issue[] };
      if (body.issues && body.issues.length > 0) {
        setErrors(fieldErrors(body.issues));
        setError("Please correct the highlighted fields.");
        return;
      }
      setError(body.error ?? "Save failed");
    } catch (err) {
      // A failed request must not leave the button stuck on "Saving…".
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSave} className="card max-w-xl space-y-5" data-testid="settings-form">
      <div>
        <label htmlFor="mode" className="mb-1 block text-sm font-medium">
          Mode
        </label>
        <select
          id="mode"
          data-testid="mode-select"
          className="input"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="COPILOT">COPILOT</option>
          <option value="AUTOPILOT">AUTOPILOT</option>
        </select>
        <p className="mt-1 text-xs text-neutral-600">
          AUTOPILOT lets the worker submit qualifying applications on its schedule.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <label htmlFor="allowSubmit" className="text-sm font-medium">
            allowSubmit (master submit switch)
          </label>
          <p id="allowSubmit-help" className="text-xs text-neutral-600">
            Required before a portal can be unlocked for Auto-Pilot.
          </p>
        </div>
        <input
          id="allowSubmit"
          type="checkbox"
          data-testid="allow-submit"
          checked={allowSubmit}
          aria-describedby="allowSubmit-help"
          onChange={(e) => setAllowSubmit(e.target.checked)}
          className="h-6 w-6"
        />
      </div>

      <div>
        <label htmlFor="dailyCap" className="mb-1 block text-sm font-medium">
          Daily application cap
        </label>
        <input
          id="dailyCap"
          type="number"
          min={1}
          max={25}
          className="input"
          aria-describedby="dailyCap-help"
          aria-invalid={errors.dailyCap ? true : undefined}
          value={dailyCap}
          onChange={(e) => setDailyCap(e.target.value)}
        />
        <p id="dailyCap-help" className="mt-1 text-xs text-neutral-600">
          Between 1 and 25 submissions per day, counted from stored submissions.
        </p>
        {errors.dailyCap && (
          <p className="mt-1 text-sm text-red-700" role="alert" data-testid="dailyCap-error">
            {errors.dailyCap}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="matchThreshold" className="mb-1 block text-sm font-medium">
          Match threshold (%)
        </label>
        <input
          id="matchThreshold"
          type="number"
          min={0}
          max={100}
          className="input"
          aria-describedby="matchThreshold-help"
          aria-invalid={errors.matchThreshold ? true : undefined}
          value={matchThreshold}
          onChange={(e) => setMatchThreshold(e.target.value)}
        />
        <p id="matchThreshold-help" className="mt-1 text-xs text-neutral-600">
          Postings below this score are never queued for Auto-Pilot.
        </p>
        {errors.matchThreshold && (
          <p className="mt-1 text-sm text-red-700" role="alert" data-testid="matchThreshold-error">
            {errors.matchThreshold}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <label htmlFor="killSwitch" className="text-sm font-medium text-red-700">
            Kill switch
          </label>
          <p id="killSwitch-help" className="text-xs text-neutral-600">
            Stops all browser automation immediately.
          </p>
        </div>
        <input
          id="killSwitch"
          type="checkbox"
          data-testid="kill-switch"
          checked={killSwitch}
          aria-describedby="killSwitch-help"
          onChange={(e) => setKillSwitch(e.target.checked)}
          className="h-6 w-6"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="text-sm text-green-700" role="status" aria-live="polite" data-testid="settings-saved">
          Saved.
        </p>
      )}

      <button type="submit" className="btn-primary" disabled={busy} aria-busy={busy}>
        {busy ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
