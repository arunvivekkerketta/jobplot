"use client";

import { useState } from "react";

type ResumeFormat = "html" | "pdf" | "docx";

interface RenderResponse {
  id: string;
  filename: string;
  validation: { ok: boolean; checkedClaims: number };
  ats: {
    ok: boolean;
    score: number;
    issues: Array<{ id: string; severity: string; message: string }>;
  };
}

export default function RenderPanel({ hasProfile }: { hasProfile: boolean }) {
  const [format, setFormat] = useState<ResumeFormat>("html");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RenderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format }),
      });
      const payload = (await res.json()) as RenderResponse & { error?: string };
      if (!res.ok) {
        setError(payload.error ?? `Render failed (${res.status})`);
        return;
      }
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Render failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-4" data-testid="render-panel">
      <div>
        <h2 className="font-semibold">Generate a document</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Rendered from the master profile only: every employer, date, bullet
          and skill is checked against the Fact Index before a file is written.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-600">Format</span>
          <select
            className="input"
            value={format}
            data-testid="render-format"
            onChange={(e) => setFormat(e.target.value as ResumeFormat)}
            disabled={!hasProfile || busy}
          >
            <option value="html">HTML</option>
            <option value="pdf">PDF</option>
            <option value="docx">DOCX</option>
          </select>
        </label>
        <button
          type="button"
          className="btn-primary"
          onClick={generate}
          disabled={!hasProfile || busy}
          data-testid="generate-document"
        >
          {busy ? "Rendering…" : "Generate resume"}
        </button>
        {!hasProfile && (
          <p className="text-sm text-neutral-600" data-testid="documents-no-profile">
            Import your JSON Resume first.
          </p>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert" data-testid="render-error">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-3" data-testid="render-result">
          <p className="text-sm font-medium text-green-700" data-testid="claims-validated">
            All {result.validation.checkedClaims} claims validated against the profile.
          </p>
          <p className="text-sm" data-testid="ats-score">
            ATS score {result.ats.score}/100
            {result.ats.issues.length > 0
              ? ` — ${result.ats.issues.length} advisory item(s)`
              : " — no issues"}
          </p>
          {format === "html" && (
            <iframe
              title="Resume preview"
              data-testid="document-preview"
              src={`/api/documents/${result.id}?inline=1`}
              sandbox=""
              className="h-[520px] w-full rounded-md border border-neutral-200 bg-white"
            />
          )}
          <a
            className="btn-secondary"
            data-testid="download-link"
            href={`/api/documents/${result.id}`}
          >
            Download {result.filename}
          </a>
        </div>
      )}
    </div>
  );
}
