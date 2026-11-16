"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface TailorJob {
  id: string;
  title: string;
  company: string;
}

export interface TailorVersion {
  id: string;
  jobId: string | null;
  approvedAt: string | null;
  pdfPath: string | null;
  docxPath: string | null;
  keywordReport: { initialCoverage?: number; finalCoverage?: number } | null;
}

interface TailorResponse {
  id?: string;
  error?: string;
  source?: string;
  validation?: { ok: boolean; checkedClaims: number };
  keywordReport?: { initialCoverage: number; finalCoverage: number; trimmedHighlights: number };
  pdfPath?: string;
  docxPath?: string;
}

export default function TailorPanel({
  jobs,
  versions,
}: {
  jobs: TailorJob[];
  versions: TailorVersion[];
}) {
  const router = useRouter();
  const [jobId, setJobId] = useState(jobs[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TailorResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function tailor() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/resume-versions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const payload = (await res.json()) as TailorResponse;
      if (!res.ok) {
        setError(payload.error ?? `Tailoring failed (${res.status})`);
        return;
      }
      setResult(payload);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tailoring failed");
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: string) {
    const res = await fetch(`/api/resume-versions/${id}/approve`, { method: "POST" });
    if (!res.ok) {
      const payload = (await res.json()) as { error?: string };
      setError(payload.error ?? "Approve failed");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="card space-y-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-600">Posting</span>
          <select
            className="input"
            value={jobId}
            onChange={(event) => setJobId(event.target.value)}
            data-testid="tailor-job"
          >
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title} — {job.company}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn-primary"
          onClick={tailor}
          disabled={busy || !jobId}
          data-testid="tailor-run"
        >
          {busy ? "Tailoring…" : "Tailor for this job"}
        </button>
        {error && (
          <p className="text-sm text-red-600" role="alert" data-testid="tailor-error">
            {error}
          </p>
        )}
        {result && (
          <div className="text-sm text-green-800" role="status" aria-live="polite" data-testid="tailor-result">
            <p>
              Tailored with {result.validation?.checkedClaims ?? 0} claims checked
              ({result.source}) — coverage {result.keywordReport?.initialCoverage}% →{
                result.keywordReport?.finalCoverage
              }%, {result.keywordReport?.trimmedHighlights} bullet(s) trimmed.
            </p>
            <p className="mt-1 space-x-3">
              {result.pdfPath && (
                <a className="underline" href={result.pdfPath}>
                  Download PDF
                </a>
              )}
              {result.docxPath && (
                <a className="underline" href={result.docxPath}>
                  Download DOCX
                </a>
              )}
            </p>
          </div>
        )}
      </div>

      <div className="card" data-testid="versions">
        <h2 className="font-semibold">Versions</h2>
        {versions.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600" data-testid="versions-empty">
            Nothing tailored yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {versions.map((version) => (
              <li
                key={version.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 pt-3"
                data-testid="version-row"
                data-approved={version.approvedAt ? "true" : "false"}
              >
                <span className="text-sm">
                  {version.jobId ?? "no posting"} · coverage{" "}
                  {version.keywordReport?.finalCoverage ?? "?"}%
                </span>
                <span className="space-x-3 text-sm">
                  {version.pdfPath && (
                    <a className="underline" href={version.pdfPath}>
                      PDF
                    </a>
                  )}
                  {version.approvedAt ? (
                    <span className="text-green-700" data-testid="version-approved">
                      Approved
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => approve(version.id)}
                      data-testid="approve-version"
                    >
                      Approve
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}