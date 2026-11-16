"use client";

import { useState } from "react";

interface JobOption {
  id: string;
  title: string;
  company: string;
}

interface Draft {
  kind: string;
  subject: string;
  text: string;
  watermark: string;
  checkedClaims: number;
}

const KINDS = [
  { value: "COVER_LETTER", label: "Cover letter", answerKey: "cover_letter" },
  { value: "COLD_EMAIL", label: "Cold email", answerKey: "cold_email" },
  { value: "OFFER_REPLY", label: "Offer reply (sample)", answerKey: "offer_reply" },
] as const;

/**
 * Drafts a letter and lets the user copy it or save it into the Answer Bank.
 * Saving is the step that is re-checked server-side against the profile, so an
 * invented fact fails there even if it slipped past the draft (I1).
 */
export default function LettersPanel({ jobs }: { jobs: JobOption[] }) {
  const [kind, setKind] = useState<string>(KINDS[0].value);
  const [jobId, setJobId] = useState<string>(jobs[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function draftLetter(): Promise<void> {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch("/api/letters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, jobId, ...(notes.trim() ? { notes: notes.trim() } : {}) }),
      });
      const payload = (await res.json()) as Draft & {
        error?: string;
        issues?: Array<{ value: string }>;
      };
      if (!res.ok) {
        setError(
          payload.issues?.length
            ? `${payload.error ?? "Rejected"} (${payload.issues.map((i) => i.value).join(", ")})`
            : (payload.error ?? `Request failed (${res.status})`),
        );
        return;
      }
      setDraft(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveAsAnswer(): Promise<void> {
    if (!draft) return;
    const answerKey = KINDS.find((entry) => entry.value === draft.kind)?.answerKey;
    if (!answerKey) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/answers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: answerKey, answer: draft.text }),
      });
      const payload = (await res.json()) as {
        error?: string;
        issues?: Array<{ value: string }>;
      };
      if (!res.ok) {
        setError(
          payload.issues?.length
            ? `${payload.error ?? "Rejected"} (${payload.issues.map((i) => i.value).join(", ")})`
            : (payload.error ?? `Request failed (${res.status})`),
        );
        return;
      }
      setSaved(answerKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form
        className="card grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void draftLetter();
        }}
        data-testid="letter-form"
      >
        <label htmlFor="letter-kind" className="text-sm font-medium">
          Kind
          <select
            id="letter-kind"
            className="input mt-1"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            {KINDS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="letter-job" className="text-sm font-medium">
          Posting
          <select
            id="letter-job"
            className="input mt-1"
            value={jobId}
            onChange={(event) => setJobId(event.target.value)}
          >
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title} · {job.company}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="letter-notes" className="text-sm font-medium sm:col-span-2">
          Anything specific to mention (optional)
          <textarea
            id="letter-notes"
            className="input mt-1 h-20"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={2000}
          />
        </label>

        <div className="flex items-center gap-3 sm:col-span-2">
          <button type="submit" className="btn-primary" disabled={busy} aria-busy={busy}>
            {busy ? "Drafting…" : "Draft letter"}
          </button>
          {draft && (
            <span className="badge-red" data-testid="letter-watermark">
              {draft.watermark}
            </span>
          )}
        </div>
      </form>

      {error && (
        <p className="text-sm text-red-700" role="alert" data-testid="letter-error">
          {error}
        </p>
      )}

      {draft && (
        <section className="card space-y-3" data-testid="letter-draft">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{draft.subject}</h2>
            <span className="text-xs text-neutral-600">
              {draft.checkedClaims} claim(s) checked against your profile
            </span>
          </div>
          <pre className="whitespace-pre-wrap text-sm text-neutral-800">{draft.text}</pre>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-secondary" disabled={busy} onClick={saveAsAnswer}>
              Save to Answer Bank
            </button>
            {saved && (
              <p className="text-sm text-green-800" role="status" data-testid="letter-saved">
                Saved as {saved.replaceAll("_", " ")} — the claims were re-checked first.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
