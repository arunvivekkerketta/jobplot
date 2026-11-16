import Link from "next/link";
import { buildFactIndex, extractGap, suggestProjects } from "@jobpilot/core";
import { prisma } from "@jobpilot/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Skills" };

export default async function SkillsPage() {
  const { userId } = await requireUser();

  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { id: true, jsonResume: true },
  });

  if (!profile) {
    return (
      <div className="space-y-3" data-testid="skills-page">
        <h1 className="text-xl font-semibold">Skills</h1>
        <p className="text-sm text-neutral-700" data-testid="skills-needs-profile">
          Import your profile first, then this page compares what postings ask for
          with what you can prove.
        </p>
        <Link href="/profile/import" className="btn-primary w-fit">
          Import profile
        </Link>
      </div>
    );
  }

  const matches = await prisma.matchScore.findMany({
    where: { profileId: profile.id },
    orderBy: [{ score: "desc" }, { id: "asc" }],
    take: 20,
    include: { job: { select: { id: true, title: true, parsed: true } } },
  });

  const index = buildFactIndex(profile.jsonResume as never);
  const gap = extractGap(
    matches.map((match) => match.job),
    index,
  );
  const have = gap.filter((entry) => entry.haveIt);
  const missing = gap.filter((entry) => !entry.haveIt);
  const projects = suggestProjects(missing.map((entry) => entry.keyword));

  return (
    <div className="space-y-6" data-testid="skills-page">
      <div>
        <h1 className="text-xl font-semibold">Skills</h1>
        <p className="mt-1 text-sm text-neutral-600">
          What the {matches.length} postings closest to your profile ask for, checked
          against the facts you have supplied.
        </p>
      </div>

      {gap.length === 0 ? (
        <p className="card text-sm text-neutral-600" data-testid="skills-empty">
          No scored postings yet. Recompute matches on the Matches page first.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card" data-testid="skills-have">
            <h2 className="font-semibold">Skills you already have that jobs ask for</h2>
            {have.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-600">None of the requested skills are in your profile yet.</p>
            ) : (
              <ul className="mt-3 space-y-1 text-sm">
                {have.map((entry) => (
                  <li key={entry.keyword} className="flex justify-between gap-3">
                    <span>{entry.keyword}</span>
                    <span className="text-neutral-600">{entry.jobsMentioning} posting(s)</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card" data-testid="skills-missing">
            <h2 className="font-semibold">Skills to learn (most requested first)</h2>
            {missing.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-600">Nothing missing from the postings scored so far.</p>
            ) : (
              <ul className="mt-3 space-y-1 text-sm">
                {missing.map((entry) => (
                  <li key={entry.keyword} className="flex justify-between gap-3">
                    <span>{entry.keyword}</span>
                    <span className="text-neutral-600">{entry.jobsMentioning} posting(s)</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {projects.length > 0 && (
        <section className="card space-y-3" data-testid="project-ideas">
          <div>
            <h2 className="font-semibold">Practice project ideas</h2>
            {/* These are suggestions only: nothing here edits the profile (I1). */}
            <p className="text-sm text-neutral-600">
              Suggestions, not claims. A project counts only once you have done it and
              added it to your profile yourself.
            </p>
          </div>
          <ul className="space-y-4">
            {projects.map((idea) => (
              <li key={idea.title} className="border-t border-neutral-200 pt-3 text-sm">
                <p className="font-medium">{idea.title}</p>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-neutral-700">
                  {idea.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <p className="mt-1 text-xs text-neutral-600">Done when: {idea.doneWhen}</p>
              </li>
            ))}
          </ul>
          <Link href="/profile/import" className="text-sm text-blue-700 underline">
            I completed one — update my profile myself
          </Link>
        </section>
      )}
    </div>
  );
}
