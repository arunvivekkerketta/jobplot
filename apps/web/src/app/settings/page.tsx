import { prisma } from "@jobpilot/db";
import { requireUser } from "@/lib/session";
import SettingsForm from "./SettingsForm";

export const metadata = { title: "Settings" };

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { userId } = await requireUser();
  const settings = await prisma.settings.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <p className="text-sm text-neutral-600">
        Defaults from the seed: mode COPILOT, daily cap 10, match threshold 75,
        kill switch off, submissions off.
      </p>
      <SettingsForm
        initial={{
          mode: settings.mode,
          dailyCap: settings.dailyCap,
          matchThreshold: settings.matchThreshold,
          killSwitch: settings.killSwitch,
          allowSubmit: settings.allowSubmit,
        }}
      />
    </div>
  );
}
