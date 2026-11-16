"use client";

import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="card space-y-3" data-testid="error-page">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-neutral-700">
        The page could not be rendered. Nothing was submitted anywhere; you can try
        again or go back to your profile.
      </p>
      {error.digest && <p className="text-xs text-neutral-600">{error.digest}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-primary" onClick={() => reset()}>
          Try again
        </button>
        <Link href="/profile" className="btn-secondary">
          Back to profile
        </Link>
      </div>
    </div>
  );
}
