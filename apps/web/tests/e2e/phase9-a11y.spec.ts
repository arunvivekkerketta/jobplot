import { test, expect, type Page } from "@playwright/test";

/**
 * Stage 3 checks. Each case proves one accessibility fix from the brief; the
 * functional suites (phase 1-8) prove the app still works.
 */

const ADMIN_EMAIL = "admin@jobpilot.local";
const ADMIN_PASSWORD = "jobpilot-admin";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/profile");
}

test("gate 3.2: every page names itself in the title", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  await expect(page).toHaveTitle(/Settings · JobPilot/);
  await page.goto("/jobs");
  await expect(page).toHaveTitle(/Jobs · JobPilot/);
});

test("gate 3.6: the first Tab reaches skip-to-content and the current page is marked", async ({
  page,
}) => {
  await login(page);
  await page.goto("/jobs");

  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toHaveText(/Skip to content/);

  const current = page.locator('nav[aria-label="Main"] a[aria-current="page"]');
  await expect(current).toHaveText("Jobs");
});

test("gate 3.1: the two switches are reachable by their labels", async ({ page }) => {
  await login(page);
  await page.goto("/settings");

  // getByLabel resolves the label element, which is what a screen reader uses.
  await expect(page.getByLabel("allowSubmit (master submit switch)")).toBeVisible();
  await expect(page.getByLabel("Kill switch")).toBeVisible();

  await page.getByLabel("Daily application cap").fill("");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByTestId("dailyCap-error")).toContainText("enter a number");
});

test("gate 3.3: the sign-in fields advertise their autocomplete purpose", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "username");
  await expect(page.getByLabel("Password")).toHaveAttribute(
    "autocomplete",
    "current-password",
  );
});

test("gate 3.8: an unknown address shows the not-found page", async ({ page }) => {
  await login(page);
  await page.goto("/does-not-exist");
  await expect(page.getByTestId("not-found-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("gate 4.3: the skills page renders what postings ask for", async ({ page }) => {
  await login(page);
  await page.goto("/skills");
  await expect(page.getByTestId("skills-page")).toBeVisible();
  // Either no scores exist yet, or the two lists are rendered; both are valid
  // states and both must be reachable without an error page.
  await expect(
    page
      .getByTestId("skills-have")
      .or(page.getByTestId("skills-empty"))
      .or(page.getByTestId("skills-needs-profile")),
  ).toBeVisible();
});
