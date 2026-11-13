import { test, expect, type Page } from "@playwright/test";

const ADMIN_EMAIL = "admin@jobpilot.local";
const ADMIN_PASSWORD = "jobpilot-admin";

const stamp = Date.now();
const jobTitle = `Backend Engineer ${stamp}`;
const baseUrl = `https://nimbuspay.example/careers/backend-${stamp}`;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/profile");
}

async function pastePosting(
  page: Page,
  options: { url: string; title?: string },
) {
  await page.getByTestId("job-title").fill(options.title ?? jobTitle);
  await page.getByTestId("job-company").fill("NimbusPay");
  await page.getByTestId("job-url").fill(options.url);
  await page.getByTestId("job-description").fill(
    `Build payment services in Python and Go. Ticket ${stamp}.`,
  );
  await page.getByTestId("import-job").click();
}

test("gate 3.12: the jobs page and APIs sit behind the auth wall", async ({
  request,
}) => {
  const page = await request.get("/jobs", { maxRedirects: 0 });
  expect(page.status()).toBe(307);
  expect(
    new URL(page.headers()["location"] ?? "", "http://localhost:3000").pathname,
  ).toBe("/login");

  // The middleware intercepts before the route handler, so anonymous callers
  // get the redirect rather than the handler's 401.
  const list = await request.get("/api/jobs", { maxRedirects: 0 });
  expect(list.status()).toBe(307);
  const create = await request.post("/api/jobs", {
    data: { title: "x", company: "y", url: "https://example.com" },
    maxRedirects: 0,
  });
  expect(create.status()).toBe(307);
  const fetchBoard = await request.post("/api/jobs/fetch", {
    data: { provider: "greenhouse", token: "acme" },
    maxRedirects: 0,
  });
  expect(fetchBoard.status()).toBe(307);
});

test("gate 3.13: a malformed board request is rejected with 422 before any fetch", async ({
  page,
}) => {
  await login(page);

  const unknownProvider = await page.request.post("/api/jobs/fetch", {
    data: { provider: "monster", token: "acme" },
  });
  expect(unknownProvider.status()).toBe(422);
  const issues = (await unknownProvider.json()) as { issues?: unknown[] };
  expect(Array.isArray(issues.issues)).toBe(true);

  const emptyToken = await page.request.post("/api/jobs/fetch", {
    data: { provider: "greenhouse", token: "" },
  });
  expect(emptyToken.status()).toBe(422);

  // Adzuna needs credentials; without them the failure is reported as a
  // configuration error, never as a silent empty import.
  const adzuna = await page.request.post("/api/jobs/fetch", {
    data: { provider: "adzuna", token: "software engineer" },
  });
  expect(adzuna.status()).toBe(400);
  const adzunaBody = (await adzuna.json()) as { error?: string };
  expect(adzunaBody.error).toMatch(/ADZUNA_APP_ID/);
});

test("gate 3.13b: an unreachable board is reported as 502 and audited", async ({
  page,
}) => {
  await login(page);
  const res = await page.request.post("/api/jobs/fetch", {
    data: { provider: "lever", token: `missing-board-${stamp}` },
  });
  expect(res.status()).toBe(502);
  const body = (await res.json()) as { error?: string };
  expect(body.error).toBeTruthy();

  await page.goto("/audit");
  await expect(page.getByTestId("audit-table")).toContainText("job.fetch.failed");
});

test("gate 3.14: a pasted posting imports once, then updates in place", async ({
  page,
}) => {
  await login(page);
  await page.goto("/jobs");
  await expect(page.getByTestId("jobs-page")).toBeVisible();

  // First import, with the tracking parameters a real email link carries.
  await pastePosting(page, {
    url: `${baseUrl}?utm_source=linkedin&utm_medium=email&gh_src=abc`,
  });
  await expect(page.getByTestId("import-result")).toContainText("Imported", {
    timeout: 20_000,
  });

  await page.reload();
  await expect(page.getByTestId("jobs-table")).toContainText(jobTitle);

  // Second import: same posting, different URL surface. Dedupe is on the
  // canonical URL, so this updates instead of creating a second row.
  await pastePosting(page, { url: `${baseUrl}/` });
  await expect(page.getByTestId("import-result")).toContainText(
    "already tracked",
    { timeout: 20_000 },
  );

  await page.reload();
  await expect(
    page.getByTestId("jobs-table").locator("tr", { hasText: jobTitle }),
  ).toHaveCount(1);

  // I8: every import wrote its audit row.
  await page.goto("/audit");
  await expect(page.getByTestId("audit-table")).toContainText("job.import");
});

test("gate 3.14b: the import API validates its input (422) and rejects other schemes", async ({
  page,
}) => {
  await login(page);

  const missingCompany = await page.request.post("/api/jobs", {
    data: { title: "Engineer", url: "https://example.com/job" },
  });
  expect(missingCompany.status()).toBe(422);

  const notHttp = await page.request.post("/api/jobs", {
    data: {
      title: "Engineer",
      company: "Acme",
      url: "javascript:alert(1)",
    },
  });
  expect(notHttp.status()).toBe(422);

  const created = await page.request.post("/api/jobs", {
    data: {
      title: `SRE ${stamp}`,
      company: "DataForge",
      url: `https://dataforge.example/jobs/sre-${stamp}`,
      text: "Keep the platform up. #3.14b",
    },
  });
  expect(created.status()).toBe(201);
  const body = (await created.json()) as {
    created: number;
    updated: number;
    job: { source: string; id: string };
  };
  expect(body.created).toBe(1);
  expect(body.job.source).toBe("manual");

  // Re-posting the identical payload updates that same row.
  const again = await page.request.post("/api/jobs", {
    data: {
      title: `SRE ${stamp}`,
      company: "DataForge",
      url: `https://dataforge.example/jobs/sre-${stamp}`,
      text: "Keep the platform up. #3.14b",
    },
  });
  const againBody = (await again.json()) as {
    created: number;
    updated: number;
    job: { id: string };
  };
  expect(againBody.updated).toBe(1);
  expect(againBody.job.id).toBe(body.job.id);
});
