import Link from "next/link";
import { prisma } from "@jobpilot/db";
import { requireUser } from "@/lib/session";
import { summarizeProfile } from "@/lib/factsSummary";

export const metadata = { title: "Profile" };

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { userId } = await requireUser();
  const profile = await prisma.profile.findUnique({ where: { userId } });
  const factCount = await prisma.fact.count();

  if (!profile) {
    return (
      <div className="card" data-testid="profile-empty">
        <h1 className="text-xl font-semibold">Master profile</h1>
        <p className="mt-2 text-sm text-neutral-600">
          No profile yet. Import your JSON Resume to build the Fact Index.
        </p>
        <Link href="/profile/import" className="btn-primary mt-4">
          Import JSON Resume
        </Link>
      </div>
    );
  }

  const summary = summarizeProfile(profile.jsonResume);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div className="card" data-testid="profile-card">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold">Master profile</h1>
            <Link href="/profile/import" className="btn-secondary">
              Re-import / edit JSON
            </Link>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="font-medium text-neutral-500">Name</dt>
              <dd data-testid="profile-name">{String((profile.jsonResume as { basics?: { name?: string } }).basics?.name ?? "")}</dd>
            </div>
            <div>
              <dt className="font-medium text-neutral-500">Version</dt>
              <dd data-testid="profile-version">{profile.version}</dd>
            </div>
          </dl>
        </div>

        <div className="card">
          <h2 className="font-semibold">Fact Index</h2>
          <p className="mt-1 text-sm text-neutral-600">
            {summary.totalFacts} facts indexed
            {factCount !== summary.totalFacts
              ? ` (table holds ${factCount})`
              : ""}
            . Every generated claim must trace back to these.
          </p>
        </div>
      </div>

      <aside className="space-y-6">
        <div className="card" data-testid="fact-summary">
          <h2 className="font-semibold">Facts by kind</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {Object.entries(summary.countsByKind).map(([kind, count]) => (
              <li key={kind} className="flex justify-between">
                <span className="text-neutral-600">{kind}</span>
                <span className="font-medium">{count}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card" data-testid="skill-years">
          <h2 className="font-semibold">Years of experience — top skills</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {summary.topSkills.map((s) => (
              <li key={s.skill} className="flex justify-between">
                <span className="text-neutral-600">{s.skill}</span>
                <span className="font-medium">{s.years.toFixed(1)} yr</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
