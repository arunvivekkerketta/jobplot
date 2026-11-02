import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const fixturePath = path.resolve(
  __dirname,
  "../../../../fixtures/sample-resume.json",
);

const ADMIN_EMAIL = "admin@jobpilot.local";
const ADMIN_PASSWORD = "jobpilot-admin";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/profile");
}

async function importFixture(page: Page) {
  await page.goto("/profile/import");
  await page.getByTestId("json-input").fill(fs.readFileSync(fixturePath, "utf8"));
  await page.getByRole("button", { name: "Import profile" }).click();
  await expect(page.getByTestId("import-success")).toBeVisible({
    timeout: 20_000,
  });
}

test("gate 2.7: unauthenticated /documents redirects to /login (307)", async ({
  request,
}) => {
  const res = await request.get("/documents", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  const location = res.headers()["location"] ?? "";
  expect(new URL(location, "http://localhost:3000").pathname).toBe("/login");
});

test("gate 2.7b: the render API rejects anonymous callers (401)", async ({
  request,
}) => {
  // The middleware auth wall intercepts before the route, so anonymous
  // callers never reach the handler; do not follow the redirect, or the
  // 307 becomes a 200 from /login.
  const res = await request.post("/api/documents", {
    data: { format: "html" },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(307);
  const location = res.headers()["location"] ?? "";
  expect(new URL(location, "http://localhost:3000").pathname).toBe("/login");
});

test("gate 2.8: generating from the UI validates every claim, persists the document and audits it", async ({
  page,
}) => {
  await login(page);
  await importFixture(page);
  await page.goto("/documents");

  await expect(page.getByTestId("render-panel")).toBeVisible();
  await page.getByTestId("render-format").selectOption("html");
  await page.getByTestId("generate-document").click();

  const result = page.getByTestId("render-result");
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("claims-validated")).toContainText(
    /claims validated against the profile/i,
  );
  await expect(page.getByTestId("ats-score")).toContainText(/ATS score \d+\/100/);
  await expect(page.getByTestId("document-preview")).toBeVisible();
  await expect(page.getByTestId("download-link")).toBeVisible();

  // The document is a first-class row, listed on the page.
  await page.reload();
  await expect(page.getByTestId("documents-table")).toContainText(/\.html/);

  // I8: the render wrote its audit row.
  await page.goto("/audit");
  await expect(page.getByTestId("audit-table")).toContainText("document.render");
});

test("gate 2.9: PDF and DOCX downloads are real binaries", async ({ page }) => {
  await login(page);
  await importFixture(page);

  for (const format of ["pdf", "docx"] as const) {
    const created = await page.request.post("/api/documents", {
      data: { format },
    });
    expect(created.status()).toBe(200);
    const body = (await created.json()) as {
      id: string;
      filename: string;
      validation: { ok: boolean; checkedClaims: number };
      ats: { score: number };
    };
    expect(body.validation.ok).toBe(true);
    expect(body.validation.checkedClaims).toBeGreaterThan(20);
    expect(body.filename.endsWith(`.${format}`)).toBe(true);

    const download = await page.request.get(`/api/documents/${body.id}`);
    expect(download.status()).toBe(200);
    const bytes = await download.body();
    if (format === "pdf") {
      expect(download.headers()["content-type"]).toBe("application/pdf");
      expect(bytes.subarray(0, 5).toString("utf8")).toBe("%PDF-");
    } else {
      expect(download.headers()["content-type"]).toContain(
        "officedocument.wordprocessingml.document",
      );
      expect(bytes.subarray(0, 2).toString("utf8")).toBe("PK");
    }
    expect(bytes.length).toBeGreaterThan(1_500);
  }
});
