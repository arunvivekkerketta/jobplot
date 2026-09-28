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

export default function SettingsForm({ initial }: { initial: SettingsData }) {
  const router = useRouter();
  const [mode] = useState(initial.mode);
  const [dailyCap, setDailyCap] = useState(initial.dailyCap);
  const [matchThreshold, setMatchThreshold] = useState(initial.matchThreshold);
  const [killSwitch, setKillSwitch] = useState(initial.killSwitch);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dailyCap, matchThreshold, killSwitch }),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
    } else {
      const body = (await res.json()) as { error?: string };
      setError(body.error ?? "Save failed");
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
          disabled
        >
          <option value="COPILOT">COPILOT</option>
          <option value="AUTOPILOT">AUTOPILOT</option>
        </select>
        <p className="mt-1 text-xs text-neutral-500">Unlocked in Phase 7.</p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium">allowSubmit (master submit switch)</span>
          <p className="text-xs text-neutral-500">Unlocked in Phase 7.</p>
        </div>
        <input
          type="checkbox"
          data-testid="allow-submit"
          checked={initial.allowSubmit}
          disabled
          className="h-5 w-5"
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
          value={dailyCap}
          onChange={(e) => setDailyCap(Number(e.target.value))}
        />
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
          value={matchThreshold}
          onChange={(e) => setMatchThreshold(Number(e.target.value))}
        />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-red-700">Kill switch</span>
          <p className="text-xs text-neutral-500">
            Stops all browser automation immediately.
          </p>
        </div>
        <input
          type="checkbox"
          data-testid="kill-switch"
          checked={killSwitch}
          onChange={(e) => setKillSwitch(e.target.checked)}
          className="h-5 w-5"
        />
      </div>

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {saved && <p className="text-sm text-green-700" data-testid="settings-saved">Saved.</p>}

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
