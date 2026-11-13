"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface ImportResponse {
  created: number;
  updated: number;
  job?: { title: string; company: string };
  error?: string;
}

interface FetchResponse {
  ok: boolean;
  fetched: number;
  created: number;
  updated: number;
  error?: string;
}

const PROVIDERS = [
  { value: "greenhouse", label: "Greenhouse" },
  { value: "lever", label: "Lever" },
  { value: "ashby", label: "Ashby" },
  { value: "adzuna", label: "Adzuna (needs API keys)" },
];

export default function JobsPanel() {
  const router = useRouter();

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const [provider, setProvider] = useState("greenhouse");
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function importJob(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"),
          company: form.get("company"),
          url: form.get("url"),
          location: form.get("location") || undefined,
          text: form.get("description") || undefined,
        }),
      });
      const payload = (await res.json()) as ImportResponse;
      if (!res.ok) {
        setImportError(payload.error ?? `Import failed (${res.status})`);
        return;
      }
      const title = payload.job?.title ?? "Posting";
      const company = payload.job?.company ?? "company";
      setImportResult(
        payload.created > 0
          ? `Imported “${title}” at ${company}.`
          : `Updated “${title}” at ${company} — it was already tracked.`,
      );
      formElement.reset();
      router.refresh();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function fetchBoard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setFetching(true);
    setFetchError(null);
    setFetchResult(null);
    try {
      const res = await fetch("/api/jobs/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          token: form.get("token"),
          company: form.get("company") || undefined,
        }),
      });
      const payload = (await res.json()) as FetchResponse;
      if (!res.ok) {
        setFetchError(payload.error ?? `Fetch failed (${res.status})`);
        return;
      }
      setFetchResult(
        `Fetched ${payload.fetched} posting(s) from ${provider}: ${payload.created} new, ${payload.updated} updated.`,
      );
      formElement.reset();
      router.refresh();
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Fetch failed");
    } finally {
      setFetching(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form className="card space-y-3" onSubmit={importJob} data-testid="job-form">
        <div>
          <h2 className="font-semibold">Paste a posting</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Paste the posting text or page HTML. It is stored as untrusted data,
            never as instructions, and deduped on its canonical URL.
          </p>
        </div>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-600">Title</span>
          <input className="input" name="title" required data-testid="job-title" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-600">Company</span>
          <input className="input" name="company" required data-testid="job-company" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-600">Posting URL</span>
          <input
            className="input"
            name="url"
            type="url"
            required
            placeholder="https://"
            data-testid="job-url"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-600">
            Location (optional)
          </span>
          <input className="input" name="location" data-testid="job-location" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-600">
            Description
          </span>
          <textarea
            className="input h-40"
            name="description"
            data-testid="job-description"
          />
        </label>

        <button
          type="submit"
          className="btn-primary"
          disabled={importing}
          data-testid="import-job"
        >
          {importing ? "Importing…" : "Import posting"}
        </button>

        {importError && (
          <p className="text-sm text-red-600" role="alert" data-testid="import-error">
            {importError}
          </p>
        )}
        {importResult && (
          <p className="text-sm text-green-700" data-testid="import-result">
            {importResult}
          </p>
        )}
      </form>

      <form
        className="card space-y-3"
        onSubmit={fetchBoard}
        data-testid="board-form"
      >
        <div>
          <h2 className="font-semibold">Fetch a public board</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Reads the board&apos;s public API and imports every posting it returns.
            Greenhouse, Lever and Ashby need only the board slug; Adzuna needs
            ADZUNA_APP_ID and ADZUNA_APP_KEY.
          </p>
        </div>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-600">Provider</span>
          <select
            className="input"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            data-testid="board-provider"
          >
            {PROVIDERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-600">
            Board slug or search query
          </span>
          <input
            className="input"
            name="token"
            required
            placeholder={provider === "adzuna" ? "software engineer" : "acme"}
            data-testid="board-token"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-neutral-600">
            Company name (optional)
          </span>
          <input className="input" name="company" data-testid="board-company" />
        </label>

        <button
          type="submit"
          className="btn-primary"
          disabled={fetching}
          data-testid="fetch-board"
        >
          {fetching ? "Fetching…" : "Fetch board"}
        </button>

        {fetchError && (
          <p className="text-sm text-red-600" role="alert" data-testid="fetch-error">
            {fetchError}
          </p>
        )}
        {fetchResult && (
          <p className="text-sm text-green-700" data-testid="fetch-result">
            {fetchResult}
          </p>
        )}
      </form>
    </div>
  );
}
