import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const stamp = Date.now();
const fixturePath = path.resolve(__dirname, "../../../../fixtures/sample-resume.json");

// Scoring persists a row and an embedding per posting, so the spec needs more
// than the default 60s budget to recompute twice.
test.setTimeout(180_000);

// The jobs created here are the newest, so the newest five always include both.
const RECOMPUTE_LIMIT = 5;

interface Fixture {
  basics: { name: string; email: string; location?: { city?: string; region?: string; country?: string } };
  work?: Array<{ position?: string }>;
  skills?: Array<{ name?: string; keywords?: Array<string | { keyword?: string }> }>;
}

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Fixture;

function keywordList(): string[] {
  const skills = fixture.skills ?? [];
  const keywords: string[] = [];
  for (const skill of skills) {
    if (skill.name) keywords.push(skill.name);
    for (const keyword of skill.keywords ?? []) {
      keywords.push(typeof keyword === "string" ? keyword : (keyword.keyword ?? ""));
    }
  }
  return keywords.filter(Boolean);
}

const city = fixture.basics.location?.city ?? "London";
const position = fixture.work?.[0]?.position ?? "Software Engineer";
const keywords = keywordList();

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

async function createJob(page: Page, title: string, description: string, location: string) {
  const res = await page.request.post("/api/jobs", {
    data: {
      title,
      company: "NimbusPay",
      url: `https://nimbuspay.example/match/${stamp}/${title.replace(/\W+/g, "-").toLowerCase()}`,
      location,
      text: description,
    },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { job: { id: string } }).job.id;
}

test("gate 5.9/5.10: scoring, threshold filtering and explanations end to end", async ({
  page,
}) => {
  await login(page);
  await ensureProfile(page);

  // A posting built from the profile's own vocabulary, and one that shares
  // nothing with it. The score must separate them.
  const strongDescription =
    `${position} needed. ${keywords.slice(0, 12).join(", ")}. 3+ years experience.`;
  const strongJobId = await createJob(page, `Match strong ${stamp}`, strongDescription, city);
  const weakJobId = await createJob(
    page,
    `Match weak ${stamp}`,
    "Registered nurse for clinical ward rotations and patient triage.",
    "Reykjavik, Iceland",
  );

  const settings = await page.request.put("/api/settings", {
    data: { matchThreshold: 75 },
  });
  expect(settings.status()).toBe(200);

  const recompute = await page.request.post("/api/matches/recompute", {
    data: { limit: RECOMPUTE_LIMIT },
  });
  expect(recompute.status()).toBe(200);
  const body = (await recompute.json()) as {
    scored: number;
    aboveThreshold: number;
    threshold: number;
    rows: Array<{ jobId: string; score: number; aboveThreshold: boolean; explanation: string }>;
  };
  expect(body.threshold).toBe(75);
  expect(body.scored).toBeGreaterThanOrEqual(2);
  expect(body.aboveThreshold).toBeGreaterThanOrEqual(1);

  const strong = body.rows.find((row) => row.jobId === strongJobId);
  const weak = body.rows.find((row) => row.jobId === weakJobId);
  expect(strong).toBeDefined();
  expect(weak).toBeDefined();
  expect(strong!.score).toBeGreaterThan(weak!.score);
  expect(strong!.aboveThreshold).toBe(true);
  expect(weak!.aboveThreshold).toBe(false);
  expect(strong!.explanation.length).toBeGreaterThan(10);

  // Gate 5.2: the API filters at the stored threshold.
  const filtered = await page.request.get("/api/matches?aboveThreshold=1");
  expect(filtered.status()).toBe(200);
  const filteredBody = (await filtered.json()) as {
    matches: Array<{ jobId: string; score: number }>;
  };
  expect(filteredBody.matches.some((match) => match.jobId === strongJobId)).toBe(true);
  expect(filteredBody.matches.some((match) => match.jobId === weakJobId)).toBe(false);
  const scores = filteredBody.matches.map((match) => match.score);
  expect(scores).toEqual([...scores].sort((a, b) => b - a));

  // Gate 5.5: recomputing is an update, not a duplicate.
  const before = (await (await page.request.get("/api/matches")).json()) as {
    matches: unknown[];
  };
  const again = await page.request.post("/api/matches/recompute", {
    data: { limit: RECOMPUTE_LIMIT },
  });
  expect(again.status()).toBe(200);
  const after = (await (await page.request.get("/api/matches")).json()) as {
    matches: unknown[];
  };
  expect(after.matches.length).toBe(before.matches.length);

  // Gate 5.10: the page lists scores best first and offers a recompute button.
  await page.goto("/matches");
  await expect(page.getByTestId("matches-page")).toBeVisible();
  await expect(page.getByTestId("matches-table")).toBeVisible();
  const rows = page.getByTestId("match-row");
  await expect(rows.first()).toBeVisible();
  const firstScore = Number(await rows.first().getAttribute("data-score"));
  expect(firstScore).toBeGreaterThanOrEqual(strong!.score);
  await expect(page.getByText(strong!.explanation.slice(0, 20), { exact: false }).first()).toBeVisible();

  await page.getByTestId("recompute-matches").click();
  await expect(page.getByTestId("recompute-result")).toContainText(/Scored \d+ posting/, {
    timeout: 30_000,
  });

  // I8: the recompute and the explanation decision are both audited.
  await page.goto("/audit");
  await expect(page.getByTestId("audit-table")).toContainText("match.recompute");
});

test("gate 5.9b: matches and recompute are behind the auth wall", async ({ request }) => {
  const list = await request.get("/api/matches", { maxRedirects: 0 });
  expect(list.status()).toBe(307);
  const recompute = await request.post("/api/matches/recompute", {
    data: {},
    maxRedirects: 0,
  });
  expect(recompute.status()).toBe(307);
});