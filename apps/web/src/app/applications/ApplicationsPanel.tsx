import Link from "next/link";

export interface ApplicationAction {
  type: string;
  at: string;
  detail: string | null;
}

export interface ApplicationRow {
  id: string;
  status: string;
  mode: string;
  portal: string;
  notes: string | null;
  submittedAt: string | null;
  needsAnswers: boolean;
  job: { title: string; company: string; url: string };
  actions: ApplicationAction[];
}

const STATUSES = [
  "QUEUED",
  "RUNNING",
  "PAUSED_NEEDS_HUMAN",
  "BLOCKED",
  "SUBMITTED",
  "ERROR",
] as const;

function badgeClass(status: string): string {
  if (status === "SUBMITTED") return "badge-green";
  if (status === "ERROR" || status === "BLOCKED" || status === "PAUSED_NEEDS_HUMAN") {
    return "badge-red";
  }
  return "badge-gray";
}

/**
 * Status filter and per-application action log. The filter is a plain GET form,
 * so it works without JavaScript and the URL keeps the choice.
 */
export default function ApplicationsPanel({
  applications,
  filter,
}: {
  applications: ApplicationRow[];
  filter: string;
}) {
  return (
    <div className="card space-y-4">
      <form method="get" className="flex flex-wrap items-end gap-3" data-testid="application-filter">
        <label htmlFor="status" className="text-sm font-medium">
          Status
          <select id="status" name="status" defaultValue={filter} className="input mt-1">
            <option value="">All</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-secondary">
          Filter
        </button>
        {filter && (
          <Link href="/applications" className="text-sm text-blue-700 underline">
            Clear
          </Link>
        )}
      </form>

      {applications.length === 0 ? (
        <p className="text-sm text-neutral-600" data-testid="applications-empty">
          No applications yet. Tailor a resume and apply, or let Auto-Pilot submit one.
        </p>
      ) : (
        <table className="w-full text-sm" data-testid="applications-table">
          <thead>
            <tr className="text-left text-neutral-600">
              <th scope="col" className="pb-2 font-medium">
                Role
              </th>
              <th scope="col" className="pb-2 font-medium">
                Status
              </th>
              <th scope="col" className="pb-2 font-medium">
                Mode
              </th>
              <th scope="col" className="pb-2 font-medium">
                Portal
              </th>
              <th scope="col" className="pb-2 font-medium">
                Submitted
              </th>
              <th scope="col" className="pb-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {applications.map((application) => (
              <tr
                key={application.id}
                className="border-t border-neutral-200 align-top"
                data-testid="application-row"
                data-status={application.status}
              >
                <td className="py-3 pr-4">
                  <div className="font-medium">{application.job.title}</div>
                  <div className="text-xs text-neutral-600">{application.job.company}</div>
                  {application.status === "PAUSED_NEEDS_HUMAN" && application.notes && (
                    <p className="mt-1 text-xs text-red-700" data-testid="application-reason">
                      Waiting on you: {application.notes.replaceAll("_", " ").toLowerCase()}
                      {application.needsAnswers && (
                        <>
                          {" · "}
                          <Link href="/answers" className="underline">
                            Add the answer
                          </Link>
                        </>
                      )}
                    </p>
                  )}
                </td>
                <td className="py-3 pr-4">
                  <span className={badgeClass(application.status)}>
                    {application.status.replaceAll("_", " ")}
                  </span>
                </td>
                <td className="py-3 pr-4 text-neutral-700">{application.mode}</td>
                <td className="py-3 pr-4 text-neutral-700">{application.portal}</td>
                <td className="py-3 pr-4 text-neutral-700">
                  {application.submittedAt ? (
                    <span title={new Date(application.submittedAt).toLocaleString()}>
                      {new Date(application.submittedAt).toLocaleDateString()}
                    </span>
                  ) : (
                    "–"
                  )}
                </td>
                <td className="py-3">
                  <a href={application.job.url} className="text-blue-700 underline" rel="noreferrer">
                    Posting
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {applications.some((application) => application.actions.length > 0) && (
        <div className="space-y-2" data-testid="application-actions">
          <h2 className="font-semibold">Actions</h2>
          {applications
            .filter((application) => application.actions.length > 0)
            .map((application) => (
              <details key={application.id} className="border-t border-neutral-200 pt-2 text-sm">
                <summary className="cursor-pointer">
                  {application.job.company} · {application.job.title} ·{" "}
                  {application.actions.length} action(s)
                </summary>
                <ul className="mt-2 space-y-1 text-xs text-neutral-700">
                  {application.actions.map((action, index) => (
                    <li key={`${application.id}-${index}`}>
                      <strong>{action.type}</strong> {action.at}
                      {action.detail ? ` — ${action.detail}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
        </div>
      )}
    </div>
  );
}
