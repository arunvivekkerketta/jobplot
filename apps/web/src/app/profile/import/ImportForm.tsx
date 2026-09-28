"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Issue {
  path: string;
  message: string;
}

export default function ImportForm() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setIssues([]);
    setMessage(null);
    setError(null);
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      setBusy(false);
      setError("The file content is not valid JSON.");
      return;
    }
    const res = await fetch("/api/profile/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: parsedJson }),
    });
    setBusy(false);
    const body = (await res.json()) as {
      ok?: boolean;
      factCount?: number;
      issues?: Issue[];
      error?: string;
    };
    if (res.ok && body.ok) {
      setMessage(`Imported. ${body.factCount} facts indexed.`);
      router.refresh();
      return;
    }
    if (body.issues) {
      setIssues(body.issues);
    }
    setError(body.error ?? "Import failed");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" data-testid="import-form">
      <div className="card space-y-4">
        <div>
          <label htmlFor="file" className="mb-1 block text-sm font-medium">
            Upload a JSON Resume file
          </label>
          <input
            id="file"
            type="file"
            accept=".json,application/json"
            onChange={onFile}
            className="block text-sm"
          />
          {fileName && <p className="mt-1 text-xs text-neutral-500">Loaded {fileName}</p>}
        </div>
        <div>
          <label htmlFor="json" className="mb-1 block text-sm font-medium">
            …or paste JSON Resume
          </label>
          <textarea
            id="json"
            data-testid="json-input"
            rows={14}
            className="input font-mono text-xs"
            placeholder='{"basics": {"name": "...", "email": "..."}, ...}'
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Importing…" : "Import profile"}
        </button>
      </div>

      {error && (
        <div className="card border-red-300 bg-red-50" data-testid="import-error">
          <p className="font-medium text-red-700">{error}</p>
        </div>
      )}
      {message && (
        <div className="card border-green-300 bg-green-50" data-testid="import-success">
          <p className="font-medium text-green-700">{message}</p>
        </div>
      )}
      {issues.length > 0 && (
        <div className="card" data-testid="zod-issues">
          <h2 className="font-medium text-red-700">Validation errors</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">
            {issues.map((issue, i) => (
              <li key={i} data-testid="zod-issue">
                <code className="rounded bg-red-100 px-1">{issue.path || "(root)"}</code>{" "}
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
