import { expect, type Page } from "@playwright/test";

const MOCK = process.env.MOCK_ATS_URL ?? "http://localhost:4600";

/**
 * Gate 4.2 helper: earns Co-Pilot approvals the way a user does -- queue an
 * application, then approve and send it -- and returns how many were earned.
 *
 * Nothing here fakes a trust count: each approval is a real browser run against
 * the mock ATS, recorded as a SUBMITTED application with mode COPILOT, which is
 * the only thing the portal unlock reads.
 */
export async function approveCoPilotApplications(
  page: Page,
  count: number,
  stamp: string,
): Promise<number> {
  // The resume the application will attach; the route only accepts a user PDF.
  const render = await page.request.post("/api/documents", { data: { format: "pdf" } });
  expect(render.status()).toBe(200);
  const documentId = ((await render.json()) as { id: string }).id;

  let approved = 0;
  for (let index = 0; index < count; index += 1) {
    const label = `${stamp}-trust-${index}`;
    const job = await page.request.post("/api/jobs", {
      data: {
        title: `Co-Pilot ${label}`,
        company: "NimbusPay",
        // A unique URL keeps the canonical-URL dedupe from merging these postings.
        url: `${MOCK}/greenhouse/sample?job=${label}`,
        location: "London, UK",
        text: "Backend Engineer. Python, PostgreSQL, Kubernetes, Docker. 5+ years experience.",
      },
    });
    expect(job.status(), await job.text()).toBe(201);
    const jobId = ((await job.json()) as { job: { id: string } }).job.id;

    // The tailored version needs a scored posting first, and only an approved
    // version may be attached (I3).
    expect(
      (await page.request.post("/api/matches/recompute", { data: { limit: 5 } })).status(),
    ).toBe(200);
    const tailored = await page.request.post("/api/resume-versions", { data: { jobId } });
    expect(tailored.status()).toBe(201);
    const versionId = ((await tailored.json()) as { id: string }).id;
    expect(
      (await page.request.post(`/api/resume-versions/${versionId}/approve`)).status(),
    ).toBe(200);

    const queued = await page.request.post("/api/applications", {
      data: { jobId, resumeDocumentId: documentId, consent: true, resumeVersionId: versionId },
    });
    expect(queued.status(), await queued.text()).toBe(201);
    const applicationId = ((await queued.json()) as { id: string }).id;

    const sent = await page.request.post(`/api/applications/${applicationId}/approve`, {
      data: { consent: true },
    });
    expect(sent.status(), await sent.text()).toBe(200);
    const body = (await sent.json()) as { status: string; mode: string };
    expect(body.status).toBe("SUBMITTED");
    expect(body.mode).toBe("COPILOT");
    approved += 1;
  }

  return approved;
}
