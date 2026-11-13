import { afterAll, describe, expect, it, vi } from "vitest";
import { assignMissingFids } from "@jobpilot/core";
import {
  getJobEmbedding,
  listMatches,
  prisma,
  rankJobsBySimilarity,
  saveGapReport,
  saveJobEmbedding,
  saveMatchScore,
  saveProjectPlans,
} from "../src/index.js";

const stamp = `match-${Date.now()}`;
const email = `${stamp}@jobpilot.test`;

// Each case creates a user, a profile and postings over a local Postgres, which
// routinely takes longer than the 5s default on this machine.
vi.setConfig({ testTimeout: 30_000 });

const resume = assignMissingFids({
  basics: { name: "Test Candidate", email: "candidate@example.com" },
  work: [
    { company: "Acme", position: "Backend Engineer", startDate: "2020-01" },
  ],
  skills: [{ name: "TypeScript", keywords: [{ keyword: "postgresql" }] }],
});

async function createJob(suffix: string, title: string, descriptionText: string) {
  return prisma.job.create({
    data: {
      source: "manual",
      url: `https://jobs.example/${stamp}/${suffix}`,
      canonicalUrl: `https://jobs.example/${stamp}/${suffix}`,
      company: "Acme",
      title,
      descriptionText,
      contentHash: `${stamp}-${suffix}`,
    },
    select: { id: true },
  });
}

afterAll(async () => {
  await prisma.job.deleteMany({ where: { canonicalUrl: { contains: stamp } } });
  await prisma.gapReport.deleteMany({ where: { userId: { in: [userId] } } });
  // Profile → MatchScore cascades, but Profile has no onDelete on its user.
  await prisma.profile.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
});

let userId = "";
let profileId = "";

describe("gate 5.5: one score per job, profile and algorithm version", () => {
  it("updates in place, then versions when the algorithm changes", async () => {
    const user = await prisma.user.create({
      data: { email, passwordHash: "not-a-real-hash" },
      select: { id: true },
    });
    userId = user.id;
    const profile = await prisma.profile.create({
      data: { userId, jsonResume: resume as unknown as object },
      select: { id: true },
    });
    profileId = profile.id;

    const job = await createJob("one", "Backend Engineer", "TypeScript and PostgreSQL");
    const first = await saveMatchScore({
      jobId: job.id,
      profileId,
      score: 61,
      breakdown: { skills: 50 },
      explanation: "first",
      algoVersion: 1,
    });
    const second = await saveMatchScore({
      jobId: job.id,
      profileId,
      score: 78,
      breakdown: { skills: 80 },
      explanation: "second",
      algoVersion: 1,
    });

    expect(second.id).toBe(first.id);
    expect(second.score).toBe(78);
    expect(await prisma.matchScore.count({ where: { profileId } })).toBe(1);

    await saveMatchScore({
      jobId: job.id,
      profileId,
      score: 70,
      breakdown: { skills: 70 },
      explanation: "v2",
      algoVersion: 2,
    });
    expect(await prisma.matchScore.count({ where: { profileId } })).toBe(2);
  });

  it("lists best first and filters at the threshold", async () => {
    const low = await createJob("low", "Nurse", "patient care");
    await saveMatchScore({
      jobId: low.id,
      profileId,
      score: 40,
      breakdown: { skills: 20 },
      explanation: "low",
      algoVersion: 1,
    });

    const all = await listMatches(profileId);
    // v1 for both jobs plus the v2 row saved above.
    expect(all.map((match) => match.score)).toEqual([78, 70, 40]);
    expect(all[0]?.job.title).toBe("Backend Engineer");

    const above = await listMatches(profileId, { threshold: 75 });
    expect(above).toHaveLength(1);
    expect(above[0]?.score).toBe(78);
  });
});

describe("gate 5.6: the posting embedding is stored in pgvector", () => {
  it("writes 384 dimensions with the model name and reads them back", async () => {
    const job = await createJob(
      "embed",
      "Senior TypeScript Engineer",
      "Build payment services in TypeScript with PostgreSQL",
    );
    await createJob("embed-other", "Registered Nurse", "clinical ward patient care");

    const vector = await saveJobEmbedding(job.id, "Senior TypeScript Engineer payment services");
    expect(vector).toHaveLength(384);

    const stored = await getJobEmbedding(job.id);
    expect(stored?.dims).toBe(384);
    expect(stored?.model).toBe("hash-bow-v1");
    expect(stored?.vector).toHaveLength(384);

    const ranked = await rankJobsBySimilarity("TypeScript payment services", 5);
    const top = ranked[0];
    expect(top?.title).toBe("Senior TypeScript Engineer");
    expect(top?.similarity).toBeGreaterThan(0);
  });
});

describe("gate 5.7/5.8: gap reports and unproven project plans", () => {
  it("stores the gaps and creates SUGGESTED plans with nothing fabricated", async () => {
    const job = await createJob("gap", "Staff Engineer", "Kubernetes and Terraform");
    const report = await saveGapReport({
      userId,
      inputJobIds: [job.id],
      gaps: [{ keyword: "kubernetes", jobs: [job.id], severity: "high" }],
    });

    const created = await saveProjectPlans(report.id, [
      { title: "Kubernetes operator", steps: ["design", "build", "measure"] },
    ]);
    expect(created).toBe(1);

    const plans = await prisma.projectPlan.findMany({ where: { gapReportId: report.id } });
    expect(plans).toHaveLength(1);
    expect(plans[0]?.status).toBe("SUGGESTED");
    expect(plans[0]?.repoUrl).toBeNull();
    expect(plans[0]?.measuredMetrics).toBeNull();
  });
});