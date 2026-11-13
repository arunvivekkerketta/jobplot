import { meetsThreshold } from "@jobpilot/core";
import { listMatches, prisma } from "@jobpilot/db";
import { requireUser } from "@/lib/session";
import MatchPanel from "./MatchPanel";

export const dynamic = "force-dynamic";

export default async function MatchesPage() {
  const { userId } = await requireUser();
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { id: true },
  });
  const settings = await prisma.settings.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
  const matches = profile ? await listMatches(profile.id, { take: 50 }) : [];

  return (
    <div className="space-y-6" data-testid="matches-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Matches</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Deterministic scores across the recent postings. Anything at or above
            your threshold of {settings.matchThreshold}% is eligible to apply.
          </p>
        </div>
        <MatchPanel />
      </div>

      {!profile && (
        <p className="card text-sm text-neutral-600" data-testid="matches-no-profile">
          Import a profile before matching.
        </p>
      )}

      {profile && matches.length === 0 && (
        <p className="card text-sm text-neutral-600" data-testid="matches-empty">
          No scores yet. Recompute to score the postings you have imported.
        </p>
      )}

      {matches.length > 0 && (
        <table className="card w-full text-sm" data-testid="matches-table">
          <thead>
            <tr className="text-left text-neutral-500">
              <th className="pb-2">Score</th>
              <th className="pb-2">Role</th>
              <th className="pb-2">Why</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((match) => {
              const eligible = meetsThreshold(match.score, settings.matchThreshold);
              const breakdown = match.breakdown as {
                skills?: number;
                seniority?: number;
                location?: number;
                freshness?: number;
              };
              return (
                <tr
                  key={match.id}
                  data-testid="match-row"
                  data-score={match.score}
                  className="border-t border-neutral-200 align-top"
                >
                  <td className="py-3 pr-4">
                    <span className={eligible ? "font-semibold text-green-700" : "font-semibold text-neutral-500"}>
                      {match.score}
                    </span>
                    <span className="ml-1 text-xs text-neutral-500">
                      {eligible ? "eligible" : "below threshold"}
                    </span>
                    <div className="mt-1 text-xs text-neutral-500">
                      skills {breakdown.skills ?? 0} · seniority {breakdown.seniority ?? 0} ·
                      location {breakdown.location ?? 0} · fresh {breakdown.freshness ?? 0}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <div className="font-medium">{match.job.title}</div>
                    <div className="text-xs text-neutral-600">
                      {match.job.company}
                      {match.job.location ? ` · ${match.job.location}` : ""}
                    </div>
                  </td>
                  <td className="py-3 text-neutral-700">{match.explanation}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}