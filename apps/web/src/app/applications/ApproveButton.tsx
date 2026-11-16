"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * "Approve and send" for one paused Co-Pilot application. The confirmation states
 * what will happen, because the click is the consent that lets JobPilot submit
 * (I3); the route re-checks the kill switch and the claim on its own.
 */
export default function ApproveButton({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve(): Promise<void> {
    if (
      !window.confirm(
        "Approve and send this application?\n\n" +
          "JobPilot will open the posting, fill it from your profile and Answer Bank, " +
          "attach your approved resume and submit it. Nothing is sent if the kill " +
          "switch is on or another run already owns this application.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/applications/${applicationId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: true }),
      });
      const payload = (await res.json()) as { error?: string; status?: string };
      if (!res.ok) {
        setError(payload.error ?? `Request failed (${res.status})`);
        return;
      }
      if (payload.status !== "SUBMITTED") {
        // A pause is a result too: the row and its reason are refreshed below.
        setError(`Not sent: ${payload.status ?? "PAUSED_NEEDS_HUMAN"}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        className="btn-primary w-fit"
        disabled={busy}
        aria-busy={busy}
        onClick={approve}
        data-testid="approve-send"
      >
        {busy ? "Sending…" : "Approve and send"}
      </button>
      {error && (
        <span className="text-xs text-red-700" role="alert" data-testid="approve-error">
          {error}
        </span>
      )}
    </span>
  );
}
