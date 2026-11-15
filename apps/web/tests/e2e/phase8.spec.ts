import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const MOCK = process.env.MOCK_ATS_URL ?? "http://localhost:4600";
const stamp = Date.now();
const fixturePath = path.resolve(__dirname, "../../../../fixtures/sample-resume.json");

test.setTimeout(240_000);

interface MockLogEntry {
  at: string;
  method: string;
  path: string;
  body: string;
}

interface SchedulingReport {
  considered: number;
  due: number;
  submitted: number;
  users: Array<{ userId: string; submitted: number; stopReason: string | null; error?: string }>;
}

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
  basics?: { location?: { city?: string; country?: string } };
  work?: Array<{ position?: string }>;
  skills?: Array<{ name?: string; keywords?: Array<string | { keyword?: string }> }>;
};

/** Matching the profile's city makes this posting the highest-scored candidate. */
const city = [fixture.basics?.location?.city, fixture.basics?.location?.country]
  .filter(Boolean)
  .join(", ") || "London, UK";

const keywords: string[] = [];
for (const skill of fixture.skills ?? []) {
  if (skill.name) keywords.push(skill.name);
  for (const keyword of skill.keywords ?? []) {
    keywords.push(typeof keyword === "string" ? keyword : (keyword.keyword ?? ""));
  }
}
const jobText = `${fixture.work?.[0]?.position ?? "Engineer"} needed. ${keywords
  .filter(Boolean)
  .slice(0, 15)
  .join(", ")}. 5+ years experience.`;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@jobpilot.local");
  await page.getByLabel("Password").fill("jobpilot-admin");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/profile");
}

async function ensureProfile(page: Page) {
  await page.goto("/profile/import");
  await page.getByTestId("json-input").fill(fs.readFileSync(fixturePath, "utf8"));
  await page.getByRole("button", { name: "Import profile" }).click();
  await expect(page.getByTestId("import-success")).toBeVisible({ timeout: 20_000 });
}

async function createMockJob(page: Page): Promise<string> {
  const res = await page.request.post("/api/jobs", {
    data: {
      title: `${fixture.work?.[0]?.position ?? "Engineer"} (scheduled ${stamp})`,
      company: "NimbusPay",
      url: `${MOCK}/greenhouse/sample?job=${stamp}-scheduled`,
      location: city,
      text: jobText,
    },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { job: { id: string } }).job.id;
}

async function approvedVersion(page: Page, jobId: string) {
  const tailored = await page.request.post("/api/resume-versions", { data: { jobId } });
  expect(tailored.status()).toBe(201);
  const id = ((await tailored.json()) as { id: string }).id;
  expect((await page.request.post(`/api/resume-versions/${id}/approve`)).status()).toBe(200);
}

async function submissions(page: Page): Promise<MockLogEntry[]> {
  const res = await page.request.get(`${MOCK}/__log`);
  expect(res.ok()).toBeTruthy();
  const log = (await res.json()) as MockLogEntry[];
  return log.filter((entry) => entry.method === "POST" && entry.path.startsWith("/submit/"));
}

async function tick(page: Page): Promise<SchedulingReport> {
  const res = await page.request.post("/api/autopilot", { data: { action: "tick" } });
  expect(res.status()).toBe(200);
  return (await res.json()) as SchedulingReport;
}

test.beforeAll(async ({ request }) => {
  const res = await request.get(`${MOCK}/`).catch(() => null);
  if (!res || !res.ok()) {
    throw new Error(
      `mock-ats is not reachable at ${MOCK}. Start it with \`pnpm --filter @jobpilot/mock-ats dev\`.`,
    );
  }
});

test("gate 8.1-8.4: the scheduled tick submits for opted-in users only", async ({ page }) => {
  await login(page);
  await ensureProfile(page);

  const jobId = await createMockJob(page);
  const recompute = await page.request.post("/api/matches/recompute", { data: { limit: 5 } });
  expect(recompute.status()).toBe(200);
  await approvedVersion(page, jobId);
  await page.request.post("/api/answers", {
    data: { key: "cover_letter", answer: `Scheduled run ${stamp}` },
  });

  const base = await page.request.put("/api/settings", {
    data: {
      mode: "COPILOT",
      allowSubmit: true,
      killSwitch: false,
      dailyCap: 25,
      matchThreshold: 50,
    },
  });
  expect(base.status()).toBe(200);
  expect(
    (
      await page.request.post("/api/autopilot", {
        data: { action: "unlock", portal: "manual" },
      })
    ).status(),
  ).toBe(200);

  // Gate 8.2: a COPILOT user is never picked up by the schedule.
  const copilot = await tick(page);
  expect(copilot.considered).toBeGreaterThanOrEqual(1);
  expect(copilot.due).toBe(0);
  expect(copilot.submitted).toBe(0);

  await page.request.post(`${MOCK}/__reset`);

  const auto = await page.request.put("/api/settings", { data: { mode: "AUTOPILOT" } });
  expect(auto.status()).toBe(200);

  // Gate 8.4: the kill switch removes the user from the schedule entirely, so
  // nothing opens even with Auto-Pilot mode on and a portal unlocked.
  await page.request.put("/api/settings", { data: { killSwitch: true } });
  const stopped = await tick(page);
  expect(stopped.due, JSON.stringify(stopped)).toBe(0);
  expect(stopped.submitted, JSON.stringify(stopped)).toBe(0);
  expect(await submissions(page)).toHaveLength(0);
  await page.request.put("/api/settings", { data: { killSwitch: false } });

  // The daily cap is a real budget shared by the earlier specs in this suite; on
  // a database where it is already spent the scheduled submission cannot happen,
  // so the submit leg is skipped rather than asserted against a saturated cap.
  const capacity = (await (await page.request.get("/api/autopilot")).json()) as {
    submissionsToday: number;
    dailyCap: number;
  };
  test.skip(
    capacity.submissionsToday >= capacity.dailyCap,
    `daily cap already spent by earlier specs (${capacity.submissionsToday}/${capacity.dailyCap})`,
  );

  // The stop gate spaces actions on one host by 30s, and the earlier specs in
  // this suite just submitted there; a scheduled tick has to wait like any run.
  await page.waitForTimeout(31_000);

  // Gate 8.3: the tick runs the same service the on-demand button does.
  const firstTick = await tick(page);
  expect(firstTick.due, JSON.stringify(firstTick)).toBeGreaterThanOrEqual(1);
  expect(firstTick.submitted, JSON.stringify(firstTick)).toBeGreaterThanOrEqual(1);
  expect(firstTick.users.every((user) => user.error === undefined)).toBe(true);
  const firstSubmissions = await submissions(page);
  expect(firstSubmissions.length, JSON.stringify(firstTick)).toBe(firstTick.submitted);
  expect(firstSubmissions[0]?.body).toContain("first_name=Priya");

  // A tick is audited even when nobody is due.
  await page.goto("/audit");
  await expect(page.getByTestId("audit-table")).toContainText("autopilot.tick");
});

test("gate 8.5: mode and allowSubmit are editable from Settings", async ({ page }) => {
  await login(page);
  await page.goto("/settings");

  const mode = page.getByTestId("mode-select");
  await expect(mode).toBeEnabled();
  await mode.selectOption("AUTOPILOT");

  const allowSubmit = page.getByTestId("allow-submit");
  if (!(await allowSubmit.isChecked())) await allowSubmit.check();
  await page.getByTestId("kill-switch").uncheck();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByTestId("settings-saved")).toBeVisible({ timeout: 20_000 });

  const saved = (await (await page.request.get("/api/settings")).json()) as {
    mode: string;
    allowSubmit: boolean;
    killSwitch: boolean;
  };
  expect(saved.mode).toBe("AUTOPILOT");
  expect(saved.allowSubmit).toBe(true);
  expect(saved.killSwitch).toBe(false);
});

test("gate 8.6: the tick endpoint is behind the auth wall", async ({ request }) => {
  expect(
    (await request.post("/api/autopilot", { data: { action: "tick" }, maxRedirects: 0 })).status(),
  ).toBe(307);
});