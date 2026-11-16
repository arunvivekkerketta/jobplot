import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const MOCK = process.env.MOCK_ATS_URL ?? "http://localhost:4600";
const stamp = Date.now();
const fixturePath = path.resolve(__dirname, "../../../../fixtures/sample-resume.json");

test.setTimeout(180_000);

interface MockLogEntry {
  at: string;
  method: string;
  path: string;
  body: string;
}

/**
 * The posting reuses the profile's own vocabulary so it scores above the
 * threshold this test sets; the gap between "queued" and "queued and sendable"
 * is not what this case is about.
 */
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
  work?: Array<{ position?: string }>;
  skills?: Array<{ name?: string; keywords?: Array<string | { keyword?: string }> }>;
};

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

async function submissions(page: Page): Promise<MockLogEntry[]> {
  const res = await page.request.get(`${MOCK}/__log`);
  expect(res.ok()).toBeTruthy();
  const log = (await res.json()) as MockLogEntry[];
  return log.filter((entry) => entry.method === "POST" && entry.path.startsWith("/submit/"));
}

test.beforeAll(async ({ request }) => {
  const res = await request.get(`${MOCK}/`).catch(() => null);
  if (!res || !res.ok()) {
    throw new Error(
      `mock-ats is not reachable at ${MOCK}. Start it with \`pnpm --filter @jobpilot/mock-ats dev\`.`,
    );
  }
});

test("gate 4.2: pressing Approve and send on /applications sends a paused Co-Pilot row", async ({
  page,
}) => {
  await login(page);
  await ensureProfile(page);

  // The suite shares one seeded user, so the switches this case needs are put back
  // afterwards and the next spec starts where it expected to.
  const previous = (await (await page.request.get("/api/settings")).json()) as {
    mode: string;
    dailyCap: number;
    matchThreshold: number;
    killSwitch: boolean;
    allowSubmit: boolean;
  };

  try {
    const configured = await page.request.put("/api/settings", {
      data: {
        mode: "COPILOT",
        allowSubmit: true,
        killSwitch: false,
        dailyCap: 10,
        matchThreshold: 50,
      },
    });
    expect(configured.status()).toBe(200);

    const title = `Approve button ${stamp}`;
    const createdJob = await page.request.post("/api/jobs", {
      data: {
        title,
        company: "NimbusPay",
        // The mock ATS form the approve run will actually fill.
        url: `${MOCK}/greenhouse/sample?job=${stamp}-approve-button`,
        location: "London, UK",
        text: jobText,
      },
    });
    expect(createdJob.status(), await createdJob.text()).toBe(201);
    const jobId = ((await createdJob.json()) as { job: { id: string } }).job.id;

    // The Greenhouse fixture asks for a cover letter, and only the Answer Bank may
    // answer it (I5). The text carries no digits, which the letter claim gate would
    // otherwise refuse (I1). A pre-existing entry from an earlier spec is fine.
    const answer = await page.request.post("/api/answers", {
      data: {
        key: "cover_letter",
        answer: "I like building payment systems carefully and I keep the details straight.",
      },
    });
    expect([200, 201, 409]).toContain(answer.status());

    expect(
      (await page.request.post("/api/matches/recompute", { data: { limit: 5 } })).status(),
    ).toBe(200);

    const tailored = await page.request.post("/api/resume-versions", { data: { jobId } });
    expect(tailored.status(), await tailored.text()).toBe(201);
    const versionId = ((await tailored.json()) as { id: string }).id;
    expect(
      (await page.request.post(`/api/resume-versions/${versionId}/approve`)).status(),
    ).toBe(200);

    const render = await page.request.post("/api/documents", { data: { format: "pdf" } });
    expect(render.status()).toBe(200);
    const resumeDocumentId = ((await render.json()) as { id: string }).id;

    const queued = await page.request.post("/api/applications", {
      data: { jobId, resumeDocumentId, consent: true, resumeVersionId: versionId },
    });
    expect(queued.status(), await queued.text()).toBe(201);
    const application = (await queued.json()) as { id: string; status: string };
    expect(application.status).toBe("QUEUED");

    // A paused row, reported through the same route a run reports to: the case is
    // about the button, not about making the browser pause first.
    const paused = await page.request.post(`/api/applications/${application.id}/result`, {
      data: {
        status: "PAUSED_NEEDS_HUMAN",
        actions: [{ kind: "PAUSE", detail: "waiting on a human for the cover letter" }],
        reason: "NEEDS_HUMAN",
      },
    });
    expect(paused.status(), await paused.text()).toBe(200);

    const before = await submissions(page);

    await page.goto("/applications");
    const row = page.locator('[data-testid="application-row"]', { hasText: title });
    await expect(row).toHaveAttribute("data-status", "PAUSED_NEEDS_HUMAN");
    // Co-Pilot is the mode whose row carries the button at all.
    await expect(row).toContainText("COPILOT");
    // The row states what it waits for, so the click is informed consent.
    await expect(row.getByTestId("application-reason")).toContainText("needs human");

    const dialogs: string[] = [];
    page.once("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.accept();
    });

    await row.getByTestId("approve-send").click();

    // The badge is read back from the database after router.refresh(), so this is the
    // stored status, not the button's own optimistic state.
    await expect(row).toHaveAttribute("data-status", "SUBMITTED", { timeout: 90_000 });
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toContain("Approve and send this application?");

    // And the send was real: the mock ATS logged exactly one new submission.
    const after = await submissions(page);
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)?.path).toBe("/submit/greenhouse");
    expect(after.at(-1)?.body).toContain("first_name=Priya");

    // I8: the approval that sent it is in the audit trail, attributed to the user.
    await page.goto("/audit");
    await expect(page.getByTestId("audit-table")).toContainText("application.approve");
  } finally {
    await page.request.put("/api/settings", {
      data: {
        mode: previous.mode,
        dailyCap: previous.dailyCap,
        matchThreshold: previous.matchThreshold,
        killSwitch: previous.killSwitch,
        allowSubmit: previous.allowSubmit,
      },
    });
  }
});
