import { prisma } from "@jobpilot/db";
import { requireUser } from "@/lib/session";
import LettersPanel from "./LettersPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Letters" };

export default async function LettersPage() {
  const { userId } = await requireUser();
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { id: true },
  });
  const jobs = await prisma.job.findMany({
    orderBy: { fetchedAt: "desc" },
    take: 25,
    select: { id: true, title: true, company: true },
  });

  return (
    <div className="space-y-6" data-testid="letters-page">
      <div>
        <h1 className="text-xl font-semibold">Letters</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Draft a cover letter, a cold email or a reply to an offer. Every draft is
          marked and every fact in it is checked against your profile before you
          can use it.
        </p>
      </div>

      {!profile ? (
        <p className="card text-sm text-neutral-700" data-testid="letters-needs-profile">
          Import your profile first; a letter may only state facts your profile
          already contains.
        </p>
      ) : jobs.length === 0 ? (
        <p className="card text-sm text-neutral-700" data-testid="letters-needs-job">
          Import a posting first, then draft a letter for it.
        </p>
      ) : (
        <LettersPanel jobs={jobs} />
      )}
    </div>
  );
}
