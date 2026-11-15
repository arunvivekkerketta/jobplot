import { loadAutopilotStatus } from "@jobpilot/autopilot";
import { requireUser } from "@/lib/session";
import AutopilotPanel from "./AutopilotPanel";

export const dynamic = "force-dynamic";

export default async function AutopilotPage() {
  const { userId } = await requireUser();
  const status = await loadAutopilotStatus(userId);

  return (
    <div className="space-y-6" data-testid="autopilot-page">
      <div>
        <h1 className="text-xl font-semibold">Auto-Pilot</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Auto-Pilot submits only to portals you unlock, only above the match
          threshold, only with an approved resume, and only while the kill switch
          is off and the daily cap has room. Every action is audited.
        </p>
      </div>
      <AutopilotPanel initial={status} />
    </div>
  );
}