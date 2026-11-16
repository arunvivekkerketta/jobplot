import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  playwrightPage,
  runApplication,
  type RunResult,
} from "@jobpilot/apply";
import type { PageLike } from "@jobpilot/apply";

const MOCK = process.env.MOCK_ATS_URL ?? "http://localhost:4600";
const stamp = Date.now();

const fixturePath = path.resolve(
  __dirname,
  "../../../../fixtures/sample-resume.json",
);

type Basics = {
  name: string;
  email: string;
  phone?: string;
  url?: string;
  location?: { city?: string; region?: string; country?: string };
};

/** The runner wants the profile shape it plans from: `{ basics }`. */
const profile = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
  basics: Basics;
};

interface MockLogEntry {
  at: string;
  method: string;
  path: string;
  body: string;
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@jobpilot.local");
  await page.getByLabel("Password").fill("jobpilot-admin");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/profile");
}

async function ensureProfile(page: Page) {
  const resume = fs.readFileSync(fixturePath, "utf8");
  await page.goto("/profile/import");
  await page.getByTestId("json-input").fill(resume);
  await page.getByRole("button", { name: "Import profile" }).click();
  await expect(page.getByTestId("import-success")).toBeVisible({ timeout: 20_000 });
}

async function createJob(page: Page, title: string): Promise<string> {
  const res = await page.request.post("/api/jobs", {
    data: {
      title,
      company: "NimbusPay",
      url: `https://nimbuspay.example/jobs/apply-${stamp}-${title.replace(/\W+/g, "-").toLowerCase()}`,
      text: "Own the payments platform.",
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { job: { id: string } };
  return body.job.id;
}

/** Renders a real PDF and writes it to disk, which is what gets attached. */
async function approvedResume(page: Page): Promise<{ id: string; file: string }> {
  const render = await page.request.post("/api/documents", { data: { format: "pdf" } });
  expect(render.status()).toBe(200);
  const { id } = (await render.json()) as { id: string };

  const download = await page.request.get(`/api/documents/${id}`);
  expect(download.status()).toBe(200);
  const bytes = await download.body();
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");

  const file = path.join(os.tmpdir(), `jobpilot-resume-${stamp}.pdf`);
  fs.writeFileSync(file, bytes);
  return { id, file };
}

async function mockLog(page: Page): Promise<MockLogEntry[]> {
  const res = await page.request.get(`${MOCK}/__log`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as MockLogEntry[];
}

function submissions(log: MockLogEntry[]): MockLogEntry[] {
  return log.filter(
    (entry) => entry.method === "POST" && entry.path.startsWith("/submit/"),
  );
}

test.beforeAll(async ({ request }) => {
  const res = await request.get(`${MOCK}/`).catch(() => null);
  if (!res || !res.ok()) {
    throw new Error(
      `mock-ats is not reachable at ${MOCK}. Start it with \`pnpm --filter @jobpilot/mock-ats dev\`.`,
    );
  }
});

test("gate 4.6: an application needs explicit consent and an approved PDF resume (I3)", async ({
  page,
}) => {
  await login(page);
  await ensureProfile(page);
  const jobId = await createJob(page, `Consent gate ${stamp}`);

  const noConsent = await page.request.post("/api/applications", {
    data: { jobId, resumeDocumentId: "doc_missing" },
  });
  expect(noConsent.status()).toBe(422);

  const noResume = await page.request.post("/api/applications", {
    data: { jobId, resumeDocumentId: "doc_missing", consent: true },
  });
  expect(noResume.status()).toBe(409);

  const resume = await approvedResume(page);
  const created = await page.request.post("/api/applications", {
    data: { jobId, resumeDocumentId: resume.id, consent: true },
  });
  expect(created.status()).toBe(201);
  const application = (await created.json()) as { id: string; status: string };
  expect(application.status).toBe("QUEUED");

  // Application.jobId is unique, so a retry returns the same row.
  const again = await page.request.post("/api/applications", {
    data: { jobId, resumeDocumentId: resume.id, consent: true },
  });
  expect(again.status()).toBe(201);
  expect(((await again.json()) as { id: string }).id).toBe(application.id);
});

test("gate 4.7/4.9: the runner fills the form, attaches the resume and the run is audited", async ({
  page,
  context,
}) => {
  await login(page);
  await ensureProfile(page);
  const jobId = await createJob(page, `Greenhouse run ${stamp}`);
  const resume = await approvedResume(page);
  const created = await page.request.post("/api/applications", {
    data: { jobId, resumeDocumentId: resume.id, consent: true },
  });
  const applicationId = ((await created.json()) as { id: string }).id;

  await page.request.post(`${MOCK}/__reset`);
  const mockPage = await context.newPage();
  const result: RunResult = await runApplication({
    page: playwrightPage(mockPage as unknown as PageLike),
    url: `${MOCK}/greenhouse/sample`,
    profile,
    resumePath: resume.file,
    answers: [{ key: "cover_letter", answer: `I build reliable systems. ${stamp}` }],
  });

  expect(result.status).toBe("SUBMITTED");
  expect(result.submissionText).toContain("Application received");

  const log = await mockLog(page);
  const posted = submissions(log);
  expect(posted).toHaveLength(1);
  expect(posted[0]?.path).toBe("/submit/greenhouse");
  // The form posts url-encoded, so the file input arrives as its filename.
  expect(posted[0]?.body).toContain("resume=");
  expect(posted[0]?.body).toContain(path.basename(resume.file));
  expect(posted[0]?.body).toContain("first_name=Priya");

  const saved = await page.request.post(`/api/applications/${applicationId}/result`, {
    data: {
      status: result.status,
      actions: result.actions,
      submissionText: result.submissionText,
    },
  });
  expect(saved.status()).toBe(200);
  const savedBody = (await saved.json()) as { status: string; events: number };
  expect(savedBody.status).toBe("SUBMITTED");
  expect(savedBody.events).toBeGreaterThan(4);

  await page.goto("/audit");
  await expect(page.getByTestId("audit-table")).toContainText("browser.submit");
  await expect(page.getByTestId("audit-table")).toContainText("application.result");

  // Gate 4.1: the dashboard shows the submission this flow just recorded.
  await page.goto("/applications");
  await expect(page.getByTestId("applications-page")).toBeVisible();
  await expect(
    page.locator('[data-testid="application-row"][data-status="SUBMITTED"]').first(),
  ).toBeVisible();
  await expect(page.getByTestId("count-submitted")).not.toHaveText("0");

  await mockPage.close();
});

test("gate 4.8: CAPTCHA and expired sessions pause instead of submitting (I4)", async ({
  page,
  context,
}) => {
  await login(page);
  await page.request.post(`${MOCK}/__reset`);
  const mockPage = await context.newPage();
  const runtime = playwrightPage(mockPage as unknown as PageLike);

  const captcha = await runApplication({
    page: runtime,
    url: `${MOCK}/edge/captcha`,
    profile,
  });
  expect(captcha.status).toBe("PAUSED_NEEDS_HUMAN");
  expect(captcha.reason).toBe("CAPTCHA");

  const expired = await runApplication({
    page: runtime,
    url: `${MOCK}/edge/session-expired`,
    profile,
  });
  expect(expired.reason).toBe("SESSION_EXPIRED");

  expect(submissions(await mockLog(page))).toHaveLength(0);
  await mockPage.close();
});

test("gate 4.10: a multi-section form is not submitted until every field resolves", async ({
  page,
  context,
}) => {
  await login(page);
  await page.request.post(`${MOCK}/__reset`);
  const mockPage = await context.newPage();
  const runtime = playwrightPage(mockPage as unknown as PageLike);

  const paused = await runApplication({
    page: runtime,
    url: `${MOCK}/edge/multi-step`,
    profile,
  });
  expect(paused.status).toBe("PAUSED_NEEDS_HUMAN");
  expect(paused.needsHuman.map((field) => field.key)).toEqual(["years_experience"]);
  expect(submissions(await mockLog(page))).toHaveLength(0);

  const completed = await runApplication({
    page: runtime,
    url: `${MOCK}/edge/multi-step`,
    profile,
    answers: [{ key: "years_experience", answer: "8" }],
  });
  expect(completed.status).toBe("SUBMITTED");

  const posted = submissions(await mockLog(page));
  expect(posted).toHaveLength(1);
  expect(posted[0]?.body).toContain("years=8");
  expect(posted[0]?.body).toContain("email=");

  await mockPage.close();
});