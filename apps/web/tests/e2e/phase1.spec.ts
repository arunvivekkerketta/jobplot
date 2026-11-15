import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const fixturePath = path.resolve(
  __dirname,
  "../../../../fixtures/sample-resume.json",
);

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@jobpilot.local");
  await page.getByLabel("Password").fill("jobpilot-admin");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/profile");
}

test("gate 1.4: unauthenticated /profile redirects to /login (307)", async ({
  request,
}) => {
  const res = await request.get("/profile", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  // Next 15 may serialize a same-origin redirect as a relative Location.
  const location = res.headers()["location"] ?? "";
  expect(new URL(location, "http://localhost:3000").pathname).toBe("/login");
});

test("gate 1.4b: unauthenticated page navigation lands on /login", async ({
  page,
}) => {
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login$/);
});

test("gate 1.9: valid JSON Resume imports and shows fact count", async ({
  page,
}) => {
  await login(page);
  await page.goto("/profile/import");
  const resume = fs.readFileSync(fixturePath, "utf8");
  await page.getByTestId("json-input").fill(resume);
  await page.getByRole("button", { name: "Import profile" }).click();
  const success = page.getByTestId("import-success");
  await expect(success).toBeVisible({ timeout: 20_000 });
  await expect(success).toContainText(/facts indexed/i);

  // Fact Index right rail renders on the profile page
  await page.goto("/profile");
  await expect(page.getByTestId("fact-summary")).toBeVisible();
  await expect(page.getByTestId("skill-years")).toContainText(/python/i);
});

test("gate 1.9b: invalid JSON shows inline zod errors", async ({ page }) => {
  await login(page);
  await page.goto("/profile/import");
  const resume = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
    basics: Record<string, unknown>;
  };
  delete resume.basics.email;
  await page
    .getByTestId("json-input")
    .fill(JSON.stringify(resume, null, 2));
  await page.getByRole("button", { name: "Import profile" }).click();
  await expect(page.getByTestId("zod-issues")).toBeVisible();
  await expect(page.getByTestId("zod-issue").first()).toBeVisible();
  await expect(page.getByTestId("import-error")).toContainText(
    /validation failed/i,
  );
});

test("gate 1.14: audit page lists the profile.save row after import", async ({
  page,
}) => {
  await login(page);
  await page.goto("/profile/import");
  const resume = fs.readFileSync(fixturePath, "utf8");
  await page.getByTestId("json-input").fill(resume);
  await page.getByRole("button", { name: "Import profile" }).click();
  await expect(page.getByTestId("import-success")).toBeVisible();

  await page.goto("/audit");
  await expect(page.getByTestId("audit-table")).toContainText("profile.save");
});

test("gate 1.15: the AUTOPILOT and allowSubmit controls are editable and persisted", async ({
  page,
}) => {
  await login(page);
  await page.goto("/settings");

  // Auto-Pilot exists now, so these controls are no longer placeholders: the
  // gate checks they are operable and that saving them reaches the API.
  const mode = page.getByTestId("mode-select");
  await expect(mode).toBeEnabled();
  await expect(page.getByTestId("allow-submit")).toBeEnabled();
  await mode.selectOption("COPILOT");
  const allowSubmit = page.getByTestId("allow-submit");
  if (await allowSubmit.isChecked()) await allowSubmit.uncheck();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByTestId("settings-saved")).toBeVisible({ timeout: 20_000 });

  const saved = (await (await page.request.get("/api/settings")).json()) as {
    mode: string;
    allowSubmit: boolean;
  };
  expect(saved.mode).toBe("COPILOT");
  expect(saved.allowSubmit).toBe(false);
});
