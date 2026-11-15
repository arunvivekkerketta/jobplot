import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const stamp = Date.now();
const fixturePath = path.resolve(__dirname, "../../../../fixtures/sample-resume.json");

test.setTimeout(180_000);

interface Fixture {
  basics: { name: string; email: string };
  work?: Array<{ position?: string; company?: string; highlights?: Array<{ text?: string } | string> }>;
  skills?: Array<{ name?: string; keywords?: Array<string | { keyword?: string }> }>;
}

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Fixture;

const position = fixture.work?.[0]?.position ?? "Software Engineer";
const company = fixture.work?.[0]?.company ?? "NimbusPay";
const keywords: string[] = [];
for (const skill of fixture.skills ?? []) {
  if (skill.name) keywords.push(skill.name);
  for (const keyword of skill.keywords ?? []) {
    keywords.push(typeof keyword === "string" ? keyword : (keyword.keyword ?? ""));
  }
}
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

async function createJob(page: Page, title: string, description: string) {
  const res = await page.request.post("/api/jobs", {
    data: {
      title,
      company,
      url: `https://nimbuspay.example/tailor/${stamp}/${title.replace(/\W+/g, "-").toLowerCase()}`,
      location: "London, UK",
      text: description,
    },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { job: { id: string } }).job.id;
}

test("gate 6.1-6.5: tailoring, the approval gate and the Answer Bank end to end", async ({
  page,
}) => {
  await login(page);
  await ensureProfile(page);

  const jobId = await createJob(
    page,
    `${position} (tailored) ${stamp}`,
    `${position} needed. ${keywords.slice(0, 12).join(", ")} required.`,
  );

  // Gate 6.1/6.3: tailoring a real posting produces a checked, persisted version.
  const tailored = await page.request.post("/api/resume-versions", { data: { jobId } });
  expect(tailored.status()).toBe(201);
  const version = (await tailored.json()) as {
    id: string;
    jobId: string;
    approvedAt: string | null;
    source: string;
    validation: { ok: boolean; checkedClaims: number };
    keywordReport: { initialCoverage: number; finalCoverage: number; trimmedHighlights: number };
    pdfPath: string;
    docxPath: string;
  };
  expect(version.jobId).toBe(jobId);
  expect(version.approvedAt).toBeNull();
  expect(version.validation.ok).toBe(true);
  expect(version.validation.checkedClaims).toBeGreaterThan(0);
  expect(version.keywordReport.finalCoverage).toBeGreaterThan(0);
  expect(version.pdfPath).toContain("/api/documents/");

  const pdf = await page.request.get(version.pdfPath);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // Gate 6.4: an unapproved version cannot be attached to an application.
  const documentId = version.pdfPath.split("/").pop()!;
  const blocked = await page.request.post("/api/applications", {
    data: { jobId, resumeDocumentId: documentId, resumeVersionId: version.id, consent: true },
  });
  expect(blocked.status()).toBe(409);

  const approved = await page.request.post(`/api/resume-versions/${version.id}/approve`);
  expect(approved.status()).toBe(200);
  expect(((await approved.json()) as { approvedAt: string | null }).approvedAt).not.toBeNull();

  const applied = await page.request.post("/api/applications", {
    data: { jobId, resumeDocumentId: documentId, resumeVersionId: version.id, consent: true },
  });
  expect(applied.status()).toBe(201);

  // Gate 6.5: Answer Bank CRUD over the API, one row per key.
  const key = `work_auth_${stamp}`;
  const first = await page.request.post("/api/answers", {
    data: { key, answer: "Yes, no sponsorship needed", sensitive: true },
  });
  expect(first.status()).toBe(201);
  const firstId = ((await first.json()) as { id: string }).id;

  const second = await page.request.post("/api/answers", {
    data: { key, answer: "Yes", sensitive: true },
  });
  expect(second.status()).toBe(201);
  expect(((await second.json()) as { id: string }).id).toBe(firstId);

  const listed = (await (await page.request.get("/api/answers")).json()) as {
    answers: Array<{ id: string; key: string; answer: string; sensitive: boolean }>;
  };
  const rows = listed.answers.filter((entry) => entry.key === key);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.answer).toBe("Yes");
  expect(rows[0]!.sensitive).toBe(true);

  // Gate 6.7: the pages expose the same behaviour to the user.
  await page.goto("/tailor");
  await expect(page.getByTestId("tailor-page")).toBeVisible();
  await page.getByTestId("tailor-job").selectOption(jobId);
  await page.getByTestId("tailor-run").click();
  await expect(page.getByTestId("tailor-result")).toContainText(/claims checked/, {
    timeout: 60_000,
  });
  const rowsOnPage = page.getByTestId("version-row");
  await expect(rowsOnPage.first()).toBeVisible();
  await expect(page.getByTestId("version-approved").first()).toBeVisible();

  await page.goto("/answers");
  await expect(page.getByTestId("answers-page")).toBeVisible();
  await page.getByTestId("answer-key").fill(`notice_${stamp}`);
  await page.getByTestId("answer-value").fill("One month");
  await page.getByTestId("answer-sensitive").check();
  await page.getByTestId("save-answer").click();
  await expect(page.getByTestId("answers-saved")).toBeVisible({ timeout: 20_000 });
  const answerRow = page.getByTestId("answer-row").filter({ hasText: `notice_${stamp}` });
  await expect(answerRow).toBeVisible();
  await answerRow.getByTestId("delete-answer").click();
  await expect(answerRow).toHaveCount(0, { timeout: 20_000 });

  // I1: the tailored document only contains profile bullets.
  const detail = (await (await page.request.get("/api/resume-versions")).json()) as {
    versions: Array<{ id: string; jobId: string | null; keywordReport: unknown }>;
  };
  expect(detail.versions.some((entry) => entry.id === version.id)).toBe(true);

  // I8: tailoring, approval and answer writes are all audited.
  await page.goto("/audit");
  await expect(page.getByTestId("audit-table")).toContainText("resume.tailor");
  await expect(page.getByTestId("audit-table")).toContainText("resume.approve");
  await expect(page.getByTestId("audit-table")).toContainText("answer.save");
});

test("gate 6.8: tailoring and answers are behind the auth wall", async ({ request }) => {
  expect((await request.get("/api/resume-versions", { maxRedirects: 0 })).status()).toBe(307);
  expect((await request.post("/api/resume-versions", { data: {}, maxRedirects: 0 })).status()).toBe(
    307,
  );
  expect((await request.get("/api/answers", { maxRedirects: 0 })).status()).toBe(307);
});