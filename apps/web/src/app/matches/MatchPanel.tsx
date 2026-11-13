"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface RecomputeResponse {
  scored: number;
  aboveThreshold: number;
  threshold: number;
  error?: string;
}

export default function MatchPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function recompute() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/matches/recompute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await res.json()) as RecomputeResponse;
      if (!res.ok) {
        setError(payload.error ?? `Recompute failed (${res.status})`);
        return;
      }
      setResult(
        `Scored ${payload.scored} posting(s); ${payload.aboveThreshold} at or above ${payload.threshold}.`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recompute failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <button
        type="button"
        className="btn-primary"
        onClick={recompute}
        disabled={busy}
        data-testid="recompute-matches"
      >
        {busy ? "Scoring…" : "Recompute matches"}
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert" data-testid="recompute-error">
          {error}
        </p>
      )}
      {result && (
        <p className="mt-2 text-sm text-green-700" data-testid="recompute-result">
          {result}
        </p>
      )}
    </div>
  );
}