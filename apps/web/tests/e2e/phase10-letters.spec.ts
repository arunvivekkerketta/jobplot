import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const fixturePath = path.resolve(__dirname, "../../../../fixtures/sample-resume.json");
const stamp = Date.now();

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

test("gate 4.4d/4.4g: every kind drafts in the workspace, marked, and saves behind the claim re-check", async ({
  page,
}) => {
  await login(page);
  await ensureProfile(page);

  const created = await page.request.post("/api/jobs", {
    data: {
      title: `Letters ${stamp}`,
      company: "NimbusPay",
      url: `https://nimbuspay.example/jobs/letters-${stamp}`,
      text: "Backend Engineer. Python, PostgreSQL, Kubernetes.",
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const jobId = ((await created.json()) as { job: { id: string } }).job.id;

  const kinds = [
    { kind: "COVER_LETTER", mark: "DRAFT" },
    { kind: "COLD_EMAIL", mark: "DRAFT" },
    { kind: "OFFER_REPLY", mark: "SAMPLE" },
  ] as const;

  // No ANTHROPIC_API_KEY here, so this is the deterministic path: the prose comes
  // from the profile, and the mark is still decided by the kind alone (I6).
  for (const entry of kinds) {
    const res = await page.request.post("/api/letters", { data: { kind: entry.kind, jobId } });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as {
      kind: string;
      paragraphs: string[];
      text: string;
      html: string;
      watermark: string;
      checkedClaims: number;
      source: string;
    };
    expect(body.kind).toBe(entry.kind);
    expect(body.watermark).toBe(entry.mark);
    expect(body.source).toBe("deterministic");
    expect(body.checkedClaims).toBeGreaterThan(0);
    // Marked at the top and at the bottom, in the text and in the markup.
    expect(body.text.startsWith(`[${entry.mark}]`)).toBe(true);
    expect(body.text).toContain(
      `[${entry.mark}] This is a ${entry.mark === "SAMPLE" ? "sample" : "draft"}`,
    );
    expect(body.html).toContain('class="letter-watermark"');
    expect(body.html).toContain(`[${entry.mark}]`);
    // The posting's own numbers never reach the body, which is what a form receives.
    expect(body.paragraphs.join(" ")).not.toContain(String(stamp));
  }

  // The browser path a user actually takes.
  await page.goto("/letters");
  await page.getByTestId("letter-form").waitFor();
  await page.getByLabel("Kind").selectOption("OFFER_REPLY");
  await page.getByLabel("Posting").selectOption(jobId);
  await page.getByRole("button", { name: "Draft letter" }).click();

  await expect(page.getByTestId("letter-draft")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("letter-watermark")).toHaveText("SAMPLE");
  await expect(page.getByTestId("letter-draft")).toContainText("[SAMPLE]");
  await expect(page.getByTestId("letter-source")).toContainText("drafted from your profile");

  await page.getByRole("button", { name: "Save to Answer Bank" }).click();
  await expect(page.getByTestId("letter-saved")).toContainText("offer reply");

  // And the re-check still fires at saving time for a hand-written letter (I1).
  const invented = await page.request.post("/api/answers", {
    data: { key: "offer_reply", answer: "I will accept 987654 pounds and start in March." },
  });
  expect(invented.status()).toBe(422);
  const issues = ((await invented.json()) as { issues: Array<{ code: string; value: string }> })
    .issues;
  expect(issues.some((issue) => issue.code === "UNKNOWN_NUMBER" && issue.value === "987654")).toBe(
    true,
  );
});
