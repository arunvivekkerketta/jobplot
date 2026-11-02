import Link from "next/link";
import { prisma } from "@jobpilot/db";
import { requireUser } from "@/lib/session";
import RenderPanel from "./RenderPanel";

export const dynamic = "force-dynamic";

interface DocumentMetadata {
  filename?: string;
  ats?: { score?: number; ok?: boolean };
}

export default async function DocumentsPage() {
  const { userId } = await requireUser();
  const [profile, documents] = await Promise.all([
    prisma.profile.findUnique({ where: { userId }, select: { id: true } }),
    prisma.document.findMany({
      where: { userId, type: "RESUME" },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return (
    <div className="space-y-6" data-testid="documents-page">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Documents</h1>
        <Link href="/profile" className="btn-secondary">
          View profile
        </Link>
      </div>

      <RenderPanel hasProfile={Boolean(profile)} />

      <div className="card">
        <h2 className="font-semibold">Recent documents</h2>
        {documents.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600" data-testid="documents-empty">
            No documents yet.
          </p>
        ) : (
          <table className="mt-3 w-full text-sm" data-testid="documents-table">
            <thead>
              <tr className="text-left text-neutral-500">
                <th className="pb-2 font-medium">File</th>
                <th className="pb-2 font-medium">Format</th>
                <th className="pb-2 font-medium">ATS</th>
                <th className="pb-2 font-medium">Created</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => {
                const metadata = (doc.metadata ?? {}) as DocumentMetadata;
                return (
                  <tr key={doc.id} className="border-t border-neutral-100">
                    <td className="py-2">
                      {metadata.filename ?? `resume.${doc.format}`}
                    </td>
                    <td className="py-2 uppercase text-neutral-600">{doc.format}</td>
                    <td className="py-2">
                      <span
                        className={
                          metadata.ats?.ok ? "badge-green" : "badge-red"
                        }
                      >
                        {metadata.ats?.score ?? "–"}/100
                      </span>
                    </td>
                    <td className="py-2 text-neutral-600">
                      {doc.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="py-2 text-right">
                      <a className="text-blue-700 hover:underline" href={`/api/documents/${doc.id}`}>
                        Download
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
