import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card space-y-3" data-testid="not-found-page">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-neutral-700">
        There is nothing at this address. It may have been renamed, or the link may
        be out of date.
      </p>
      <Link href="/profile" className="btn-primary w-fit">
        Back to profile
      </Link>
    </div>
  );
}
