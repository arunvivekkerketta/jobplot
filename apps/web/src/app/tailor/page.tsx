import { listResumeVersions, prisma } from "@jobpilot/db";
import { requireUser } from "@/lib/session";
import TailorPanel from "./TailorPanel";

export const dynamic = "force-dynamic";

export default async function TailorPage() {
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

  const versions = profile ? await listResumeVersions(profile.id, 10) : [];

  return (
    <div className="space-y-6" data-testid="tailor-page">
      <div>
        <h1 className="text-xl font-semibold">Tailor a resume</h1>
        <p className="mt-1 text-sm text-neutral-600">
          The tailored resume may only reorder and omit facts from your profile —
          every claim is checked against the Fact Index before it is rendered.
        </p>
      </div>

      {!profile ? (
        <p className="card text-sm text-neutral-600" data-testid="tailor-no-profile">
          Import a profile before tailoring.
        </p>
      ) : (
        <TailorPanel
          jobs={jobs}
          versions={versions.map((version) => ({
            id: version.id,
            jobId: version.jobId,
            approvedAt: version.approvedAt?.toISOString() ?? null,
            pdfPath: version.pdfPath,
            docxPath: version.docxPath,
            keywordReport: version.keywordReport as {
              initialCoverage?: number;
              finalCoverage?: number;
            } | null,
          }))}
        />
      )}
    </div>
  );
}