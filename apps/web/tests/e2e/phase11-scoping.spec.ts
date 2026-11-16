import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 29 — ownership proved at the HTTP boundary.
 *
 * Phase 20 scoped `Application` by `userId` and proved it inside the db helper.
 * That is not where the risk lives: what a second account can reach is whatever the
 * route lets through, so these cases sign in as a real second tenant (seeded into
 * the e2e database by `scripts/e2e-db.mjs`) and post to the first tenant's
 * application over HTTP. The id is real, the session is real, and the answer must
 * be `404` — the same answer a nonexistent id gets, so the endpoint cannot be used
 * to probe which ids exist.
 *
 * The owner then posts the same payloads to the same id: `result` answers `200`,
 * which is what makes the 404 about ownership rather than a bad request.
 */

const MOCK = process.env.MOCK_ATS_URL ?? "http://localhost:4600";
const stamp = Date.now();
const fixturePath = path.resolve(__dirname, "../../../../fixtures/sample-resume.json");

const SECOND_EMAIL = "second@jobpilot.local";
const SECOND_PASSWORD = "jobpilot-second";

test.setTimeout(180_000);

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
  work?: Array<{ position?: string }>;
  skills?: Array<{ name?: string; keywords?: Array<string> | Array<{ keyword?: string }> }>;
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

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/profile");
}

/** The owner needs a profile before it can render a resume or score a posting. */
async function ensureProfile(page: Page): Promise<void> {
  await page.goto("/profile/import");
  await page.getByTestId("json-input").fill(fs.readFileSync(fixturePath, "utf8"));
  await page.getByRole("button", { name: "Import profile" }).click();
  await expect(page.getByTestId("import-success")).toBeVisible({ timeout: 20_000 });
}

interface Settings {
  mode: string;
  dailyCap: number;
  matchThreshold: number;
  killSwitch: boolean;
  allowSubmit: boolean;
}

/**
 * The suite shares one seeded admin, so the switches this spec needs are put back
 * afterwards and the next file starts where it expected to (as phase4-approve does).
 */
async function withSettings(
  page: Page,
  run: () => Promise<void>,
  overrides: Partial<Settings> = {},
): Promise<void> {
  const previous = (await (await page.request.get("/api/settings")).json()) as Settings;
  const saved = await page.request.put("/api/settings", {
    data: { ...previous, allowSubmit: false, killSwitch: false, matchThreshold: 50, ...overrides },
  });
  expect(saved.status(), await saved.text()).toBe(200);
  try {
    await run();
  } finally {
    const restored = await page.request.put("/api/settings", { data: previous });
    expect(restored.status(), await restored.text()).toBe(200);
  }
}

/** A queued Co-Pilot application the owner really created, over HTTP. */
async function queueApplication(page: Page, label: string): Promise<string> {
  const render = await page.request.post("/api/documents", { data: { format: "pdf" } });
  expect(render.status(), await render.text()).toBe(200);
  const documentId = ((await render.json()) as { id: string }).id;

  const job = await page.request.post("/api/jobs", {
    data: {
      title: `Scoping ${label}`,
      company: "NimbusPay",
      url: `${MOCK}/greenhouse/sample?job=${label}`,
      location: "London, UK",
      text: jobText,
    },
  });
  expect(job.status(), await job.text()).toBe(201);
  const jobId = ((await job.json()) as { job: { id: string } }).job.id;

  expect(
    (await page.request.post("/api/matches/recompute", { data: { limit: 5 } })).status(),
  ).toBe(200);
  const tailored = await page.request.post("/api/resume-versions", { data: { jobId } });
  expect(tailored.status(), await tailored.text()).toBe(201);
  const versionId = ((await tailored.json()) as { id: string }).id;
  expect(
    (await page.request.post(`/api/resume-versions/${versionId}/approve`)).status(),
  ).toBe(200);

  const queued = await page.request.post("/api/applications", {
    data: { jobId, resumeDocumentId: documentId, consent: true, resumeVersionId: versionId },
  });
  expect(queued.status(), await queued.text()).toBe(201);
  return ((await queued.json()) as { id: string }).id;
}

test("gate 20a/20b: another account's application is 404 over HTTP for result and approve", async ({
  browser,
  page,
}) => {
  await signIn(page, "admin@jobpilot.local", "jobpilot-admin");
  await ensureProfile(page);
  let applicationId = "";
  await withSettings(page, async () => {
    applicationId = await queueApplication(page, `owner-${stamp}`);
  });

  // A separate browser context is a separate cookie jar, so this is a genuine
  // second session rather than the owner's session with a spoofed header.
  const second = await browser.newContext();
  try {
    const secondPage = await second.newPage();
    await signIn(secondPage, SECOND_EMAIL, SECOND_PASSWORD);

    // Who is signed in: the session the route will read.
    const me = await secondPage.request.get("/api/applications");
    expect(me.status()).toBe(200);
    const listed = (await me.json()) as { applications: Array<{ id: string }> };
    expect(listed.applications.map((row) => row.id)).not.toContain(applicationId);

    const result = await secondPage.request.post(`/api/applications/${applicationId}/result`, {
      data: { status: "SUBMITTED", actions: [{ kind: "SUBMIT", detail: "stolen" }] },
    });
    expect(result.status(), await result.text()).toBe(404);
    expect(await result.json()).toMatchObject({ error: "Unknown application" });

    const approve = await secondPage.request.post(`/api/applications/${applicationId}/approve`, {
      data: { consent: true },
    });
    expect(approve.status(), await approve.text()).toBe(404);

    // An id that never existed gets the identical answer, so the 404 cannot be
    // read as "this id exists but is not yours".
    const missing = await secondPage.request.post("/api/applications/nonexistent-id/result", {
      data: { status: "SUBMITTED", actions: [{ kind: "SUBMIT", detail: "nothing" }] },
    });
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "Unknown application" });

    // Nothing the second account sent changed the owner's row.
    const ownerRows = (await (await page.request.get("/api/applications")).json()) as {
      applications: Array<{ id: string; status: string }>;
    };
    expect(ownerRows.applications.find((row) => row.id === applicationId)?.status).toBe("QUEUED");
  } finally {
    await second.close();
  }

  // The owner can do what the second account could not: the same payload, accepted.
  const owned = await page.request.post(`/api/applications/${applicationId}/result`, {
    data: { status: "SUBMITTED", actions: [{ kind: "SUBMIT", detail: "by the owner" }] },
  });
  expect(owned.status(), await owned.text()).toBe(200);
  expect(await owned.json()).toMatchObject({ status: "SUBMITTED" });
});

test("gate 20c: approving another account's application never reaches the browser", async ({
  browser,
  page,
}) => {
  await signIn(page, "admin@jobpilot.local", "jobpilot-admin");
  await ensureProfile(page);
  let applicationId = "";
  await withSettings(page, async () => {
    applicationId = await queueApplication(page, `owner-approve-${stamp}`);
  });

  const before = await page.request.get(`${MOCK}/__log`);
  expect(before.ok()).toBeTruthy();
  const postsBefore = ((await before.json()) as Array<{ method: string; path: string }>).filter(
    (entry) => entry.method === "POST" && entry.path.startsWith("/submit/"),
  ).length;

  const second = await browser.newContext();
  try {
    const secondPage = await second.newPage();
    await signIn(secondPage, SECOND_EMAIL, SECOND_PASSWORD);
    const approve = await secondPage.request.post(`/api/applications/${applicationId}/approve`, {
      data: { consent: true },
    });
    expect(approve.status(), await approve.text()).toBe(404);
  } finally {
    await second.close();
  }

  // I3/I4 hold across accounts: a refused approve sent nothing to the mock ATS.
  const after = await page.request.get(`${MOCK}/__log`);
  expect(after.ok()).toBeTruthy();
  const postsAfter = ((await after.json()) as Array<{ method: string; path: string }>).filter(
    (entry) => entry.method === "POST" && entry.path.startsWith("/submit/"),
  ).length;
  expect(postsAfter).toBe(postsBefore);
});
