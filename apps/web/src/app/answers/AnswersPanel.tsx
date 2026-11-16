"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface AnswerEntry {
  id: string;
  key: string;
  questionPattern: string | null;
  answer: string;
  sensitive: boolean;
}

export interface AnswerPrefill {
  key?: string;
  questionPattern?: string;
}

export default function AnswersPanel({
  initial,
  prefill,
}: {
  initial: AnswerEntry[];
  /** Set by a coverage-report link: the key and pattern it explained. */
  prefill?: AnswerPrefill;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Sensitive values are hidden until the user asks for that one row (I7).
  const [revealed, setRevealed] = useState<string[]>([]);

  function toggleReveal(id: string): void {
    setRevealed((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch("/api/answers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: form.get("key"),
          answer: form.get("answer"),
          questionPattern: form.get("questionPattern") || undefined,
          sensitive: form.get("sensitive") === "on",
        }),
      });
      const payload = (await res.json()) as { key?: string; error?: string };
      if (!res.ok) {
        setError(payload.error ?? `Save failed (${res.status})`);
        return;
      }
      setSaved(payload.key ?? "entry");
      formElement.reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/answers?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const payload = (await res.json()) as { error?: string };
      setError(payload.error ?? "Delete failed");
      return;
    }
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form id="answer-form" className="card space-y-3" onSubmit={save} data-testid="answer-form">
        {prefill?.key && (
          <p className="text-sm text-neutral-700" data-testid="answer-prefill">
            Adding <span className="font-medium">{prefill.key}</span>, because a run stopped on
            it.
          </p>
        )}
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-600">Key</span>
          <input
            name="key"
            required
            placeholder="work_auth"
            className="input"
            defaultValue={prefill?.key ?? ""}
            data-testid="answer-key"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-600">Answer</span>
          <textarea
            name="answer"
            required
            className="input h-24"
            data-testid="answer-value"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-600">
            Question pattern (optional, regex)
          </span>
          <input
            name="questionPattern"
            defaultValue={prefill?.questionPattern ?? ""}
            placeholder="salary\\s+expectations"
            className="input"
            data-testid="answer-pattern"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="sensitive" data-testid="answer-sensitive" />
          <span>This is a sensitive question (I5)</span>
        </label>
        <button type="submit" className="btn-primary" disabled={busy} data-testid="save-answer">
          {busy ? "Saving…" : "Save answer"}
        </button>
        {error && (
          <p className="text-sm text-red-600" role="alert" data-testid="answers-error">
            {error}
          </p>
        )}
        {saved && (
          <p className="text-sm text-green-700" role="status" aria-live="polite" data-testid="answers-saved">
            Saved “{saved}”.
          </p>
        )}
      </form>

      <div className="card" data-testid="answers-table">
        <h2 className="font-semibold">Saved answers</h2>
        {initial.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600" data-testid="answers-empty">
            No answers yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {initial.map((entry) => (
              <li
                key={entry.id}
                className="border-t border-neutral-200 pt-3 text-sm"
                data-testid="answer-row"
                data-key={entry.key}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{entry.key}</span>
                  <span className="space-x-3">
                    {entry.sensitive && (
                      <span className="text-xs uppercase text-red-700">sensitive</span>
                    )}
                    <button
                      type="button"
                      className="text-red-700 underline"
                      onClick={() => remove(entry.id)}
                      data-testid="delete-answer"
                    >
                      Delete
                    </button>
                  </span>
                </div>
                <p className="mt-1 text-neutral-700" data-testid="answer-text">
                  {entry.sensitive && !revealed.includes(entry.id) ? "••••••" : entry.answer}
                </p>
                {entry.sensitive && (
                  <button
                    type="button"
                    className="mt-1 text-xs text-blue-700 underline"
                    onClick={() => toggleReveal(entry.id)}
                    data-testid="toggle-answer-visibility"
                  >
                    {revealed.includes(entry.id) ? "Hide" : "Show"}
                  </button>
                )}
                {entry.questionPattern && (
                  <p className="mt-1 text-xs text-neutral-500">
                    pattern: {entry.questionPattern}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}