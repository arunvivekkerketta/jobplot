import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "./index.js";

// The workspace keeps one .env at the repo root; tsx runs this file from packages/db.
try {
  process.loadEnvFile(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"),
  );
} catch {
  // No root .env: ADMIN_EMAIL, ADMIN_PASSWORD and DATABASE_URL must be exported.
}

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "ADMIN_EMAIL and ADMIN_PASSWORD must be set (see .env.example).",
    );
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash },
  });

  await prisma.settings.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      mode: "COPILOT",
      dailyCap: 10,
      matchThreshold: 75,
      killSwitch: false,
      allowSubmit: false,
      perPortalMode: {},
      quietHours: {},
    },
  });

  console.log(
    `Seeded admin ${email} with default Settings: mode COPILOT, dailyCap 10, matchThreshold 75, killSwitch false, allowSubmit false`,
  );

  // The e2e suite needs a second tenant to prove that ownership is enforced at the
  // HTTP boundary, not only inside the db helper. The account is seeded only when
  // the environment names it, so a normal `db:seed` still leaves one account.
  const secondEmail = process.env.E2E_SECOND_EMAIL?.trim().toLowerCase();
  const secondPassword = process.env.E2E_SECOND_PASSWORD;
  if (!secondEmail || !secondPassword) return;

  const second = await prisma.user.upsert({
    where: { email: secondEmail },
    update: { passwordHash: await hashPassword(secondPassword) },
    create: { email: secondEmail, passwordHash: await hashPassword(secondPassword) },
  });
  await prisma.settings.upsert({
    where: { userId: second.id },
    update: {},
    create: {
      userId: second.id,
      mode: "COPILOT",
      dailyCap: 10,
      matchThreshold: 75,
      killSwitch: false,
      allowSubmit: false,
      perPortalMode: {},
      quietHours: {},
    },
  });
  console.log(`Seeded second account ${secondEmail} for the cross-account gates`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
