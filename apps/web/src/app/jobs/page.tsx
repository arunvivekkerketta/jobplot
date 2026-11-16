import { prisma } from "@jobpilot/db";
import { requireUser } from "@/lib/session";
import { exactTime, relativeTime } from "@/lib/time";
import JobsPanel from "./JobsPanel";

export const metadata = { title: "Jobs" };

export const dynamic = "force-dynamic";

function salaryRange(min: number | null, max: number | null): string {
  if (min == null && max == null) return "–";
  const format = (value: number) => value.toLocaleString("en-US");
  if (min != null && max != null && min !== max) {
    return `${format(min)} – ${format(max)}`;
  }
  return format((min ?? max) as number);
}

export default async function JobsPage() {
  await requireUser();

  const jobs = await prisma.job.findMany({
    orderBy: { fetchedAt: "desc" },
    take: 50,
    select: {
      id: true,
      source: true,
      title: true,
      company: true,
      location: true,
      remote: true,
      url: true,
      salaryMin: true,
      salaryMax: true,
      postedAt: true,
      fetchedAt: true,
    },
  });

  return (
    <div className="space-y-6" data-testid="jobs-page">
      <div>
        <h1 className="text-xl font-semibold">Jobs</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Postings land here from a board fetch or a manual paste. Duplicates are
          merged on their canonical URL, so re-importing a board updates rather
          than repeats.
        </p>
      </div>

      <JobsPanel />

      <div className="card">
        <h2 className="font-semibold">Tracked postings</h2>
        {jobs.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600" data-testid="jobs-empty">
            No postings yet. Fetch a board or paste one above.
          </p>
        ) : (
          <table className="mt-3 w-full text-sm" data-testid="jobs-table">
            <thead>
              <tr className="text-left text-neutral-500">
                <th scope="col" className="pb-2 font-medium">Role</th>
                <th scope="col" className="pb-2 font-medium">Company</th>
                <th scope="col" className="pb-2 font-medium">Source</th>
                <th scope="col" className="pb-2 font-medium">Location</th>
                <th scope="col" className="pb-2 font-medium">Salary</th>
                <th scope="col" className="pb-2 font-medium">Posted</th>
                <th scope="col" className="pb-2 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-t border-neutral-100">
                  <td className="py-2">{job.title}</td>
                  <td className="py-2">{job.company}</td>
                  <td className="py-2 text-neutral-600">{job.source}</td>
                  <td className="py-2 text-neutral-600">
                    {job.location ?? "–"}
                    {job.remote && (
                      <span className="badge-green ml-2">remote</span>
                    )}
                  </td>
                  <td className="py-2 text-neutral-600">
                    {salaryRange(job.salaryMin, job.salaryMax)}
                  </td>
                  <td className="py-2 text-neutral-600">
                    <span
                      title={exactTime(job.postedAt ?? job.fetchedAt)}
                      data-testid="job-posted"
                    >
                      {relativeTime(job.postedAt ?? job.fetchedAt)}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <a
                      className="text-blue-700 hover:underline"
                      href={job.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Open
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
