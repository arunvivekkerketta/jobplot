import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const fixturePath = path.resolve(__dirname, "../../../../fixtures/sample-resume.json");

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

test("gate 4.4: a letter's claims are re-checked before it can be used", async ({ page }) => {
  await login(page);
  await ensureProfile(page);

  // The Answer Bank is what the runner types into an employer's form, so an
  // invented number must be refused here, before anything could be sent (I1).
  const invented = await page.request.post("/api/answers", {
    data: {
      key: "cover_letter",
      answer: "I led a team of 4321 engineers at Google for 98765 years.",
    },
  });
  expect(invented.status()).toBe(422);
  const issues = ((await invented.json()) as {
    issues: Array<{ code: string; value: string }>;
  }).issues;
  expect(issues.some((issue) => issue.code === "UNKNOWN_NUMBER")).toBe(true);

  // A letter whose facts the profile can support is accepted.
  const truthful = await page.request.post("/api/answers", {
    data: {
      key: "cover_letter",
      answer: "I build payment systems with Python, PostgreSQL and Kubernetes.",
    },
  });
  expect(truthful.status()).toBe(201);

  // A key that is not a letter is left alone by the letter check.
  const plain = await page.request.post("/api/answers", {
    data: { key: "notice_period", answer: "4321 days" },
  });
  expect(plain.status()).toBe(201);

  await page.goto("/letters");
  await expect(page.getByTestId("letters-page")).toBeVisible();
  await expect(
    page
      .getByTestId("letter-form")
      .or(page.getByTestId("letters-needs-profile"))
      .or(page.getByTestId("letters-needs-job")),
  ).toBeVisible();
});
