import { prisma } from "@jobpilot/db";
import { requireUser } from "@/lib/session";
import ApplicationsPanel from "./ApplicationsPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Applications" };

const STATUSES = [
  "QUEUED",
  "RUNNING",
  "PAUSED_NEEDS_HUMAN",
  "BLOCKED",
  "SUBMITTED",
  "ERROR",
] as const;

const REASON_FOR_ANSWERS = new Set([
  "NEEDS_HUMAN_FIELDS",
  "CAPTCHA",
  "SESSION_EXPIRED",
  "LOGIN_WALL",
  "TWO_FACTOR",
]);

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireUser();
  const { status } = await searchParams;
  const filter = STATUSES.includes(status as (typeof STATUSES)[number])
    ? (status as (typeof STATUSES)[number])
    : undefined;

  const applications = await prisma.application.findMany({
    where: filter ? { status: filter } : {},
    orderBy: { id: "desc" },
    take: 50,
    include: {
      job: { select: { title: true, company: true, url: true } },
      events: { orderBy: { at: "desc" }, take: 20, select: { type: true, payload: true, at: true } },
    },
  });

  const counts = await prisma.application.groupBy({ by: ["status"], _count: { _all: true } });
  const countFor = (wanted: string): number =>
    counts.find((entry) => entry.status === wanted)?._count._all ?? 0;

  return (
    <div className="space-y-6" data-testid="applications-page">
      <div>
        <h1 className="text-xl font-semibold">Applications</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Every application JobPilot has queued, run or submitted, with the reason a
          stopped one is waiting for you.
        </p>
      </div>

      <div className="card grid gap-2 text-sm sm:grid-cols-5" data-testid="application-counts">
        <p>
          Queued <strong data-testid="count-queued">{countFor("QUEUED")}</strong>
        </p>
        <p>
          Running <strong data-testid="count-running">{countFor("RUNNING")}</strong>
        </p>
        <p>
          Paused{" "}
          <strong data-testid="count-paused">{countFor("PAUSED_NEEDS_HUMAN")}</strong>
        </p>
        <p>
          Submitted <strong data-testid="count-submitted">{countFor("SUBMITTED")}</strong>
        </p>
        <p>
          Error <strong data-testid="count-error">{countFor("ERROR")}</strong>
        </p>
      </div>

      <ApplicationsPanel
        filter={filter ?? ""}
        applications={applications.map((application) => ({
          id: application.id,
          status: application.status,
          mode: application.mode,
          portal: application.portal,
          notes: application.notes,
          submittedAt: application.submittedAt?.toISOString() ?? null,
          needsAnswers:
            application.status === "PAUSED_NEEDS_HUMAN" &&
            REASON_FOR_ANSWERS.has(application.notes ?? ""),
          job: application.job,
          actions: application.events.map((event) => ({
            type: event.type,
            at: event.at.toISOString(),
            detail:
              typeof (event.payload as { detail?: unknown }).detail === "string"
                ? (event.payload as { detail: string }).detail
                : null,
          })),
        }))}
      />
    </div>
  );
}
