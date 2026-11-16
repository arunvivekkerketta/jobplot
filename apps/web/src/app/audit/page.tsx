import { prisma } from "@jobpilot/db";
import { exactTime, relativeTime } from "@/lib/time";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Audit" };

export const dynamic = "force-dynamic";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; action?: string }>;
}) {
  await requireUser();
  const params = await searchParams;
  const actor = params.actor?.toUpperCase();
  const action = params.action?.toLowerCase();

  const rows = await prisma.auditLog.findMany({
    where: {
      ...(actor ? { actor } : {}),
      ...(action ? { action: { contains: action } } : {}),
    },
    orderBy: { at: "desc" },
    take: 200,
  });

  const actors = ["SYSTEM", "USER", "LLM", "BROWSER"];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Audit log</h1>
      <form className="flex flex-wrap items-end gap-3" method="get">
        <div>
          <label htmlFor="actor" className="mb-1 block text-xs font-medium text-neutral-500">
            Actor
          </label>
          <select id="actor" name="actor" defaultValue={actor ?? ""} className="input w-40">
            <option value="">All</option>
            {actors.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="action" className="mb-1 block text-xs font-medium text-neutral-500">
            Action contains
          </label>
          <input id="action" name="action" defaultValue={action ?? ""} className="input w-56" />
        </div>
        <button type="submit" className="btn-secondary">Filter</button>
      </form>

      <div className="card overflow-x-auto" data-testid="audit-table">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b text-xs uppercase text-neutral-500">
              <th scope="col" className="py-2 pr-4">At</th>
              <th scope="col" className="py-2 pr-4">Actor</th>
              <th scope="col" className="py-2 pr-4">Action</th>
              <th scope="col" className="py-2 pr-4">Entity</th>
              <th scope="col" className="py-2">Payload</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-neutral-100">
                <td className="py-2 pr-4 whitespace-nowrap text-xs text-neutral-500">
                  <span title={exactTime(row.at)}>{relativeTime(row.at)}</span>
                </td>
                <td className="py-2 pr-4">
                  <span className={row.actor === "LLM" ? "badge-red" : "badge-gray"}>
                    {row.actor}
                  </span>
                </td>
                <td className="py-2 pr-4 font-mono text-xs">{row.action}</td>
                <td className="py-2 pr-4 text-xs">
                  {row.entityType}
                  {row.entityId ? `#${row.entityId.slice(0, 8)}` : ""}
                </td>
                <td className="py-2 font-mono text-xs text-neutral-600">
                  {JSON.stringify(row.payload).slice(0, 120)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-neutral-500">
                  No audit rows match the filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
