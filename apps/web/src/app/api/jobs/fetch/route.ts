import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { saveJobs, writeAudit } from "@jobpilot/db";
import {
  BOARD_PROVIDERS,
  SourceFetchError,
  fetchSourceJobs,
} from "@jobpilot/sources";

export const dynamic = "force-dynamic";

const boardInput = z.object({
  provider: z.enum(BOARD_PROVIDERS),
  token: z.string().trim().min(1).max(200),
  company: z.string().trim().min(1).max(200).optional(),
});

/**
 * Fetches a public board on demand. A board that is down or misconfigured is a
 * reported failure, never a silent empty import (gate 3.13).
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = boardInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid board", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { provider, token, company } = parsed.data;

  try {
    const drafts = await fetchSourceJobs({ provider, token, company });
    const saved = await saveJobs(drafts, { actor: "USER" });
    await writeAudit({
      actor: "USER",
      action: "job.fetch",
      entityType: "Job",
      payload: {
        provider,
        token,
        company: company ?? token,
        fetched: drafts.length,
        created: saved.created,
        updated: saved.updated,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        provider,
        company: company ?? token,
        fetched: drafts.length,
        created: saved.created,
        updated: saved.updated,
        total: saved.total,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SourceFetchError) {
      await writeAudit({
        actor: "USER",
        action: "job.fetch.failed",
        entityType: "Job",
        payload: {
          provider,
          token,
          company: company ?? token,
          kind: error.kind,
          status: error.status ?? null,
          error: error.message,
        },
      });
      return NextResponse.json(
        { error: error.message, kind: error.kind },
        { status: error.kind === "config" ? 400 : 502 },
      );
    }
    if (error instanceof z.ZodError) {
      await writeAudit({
        actor: "USER",
        action: "job.fetch.failed",
        entityType: "Job",
        payload: {
          provider,
          token,
          company: company ?? token,
          kind: "schema",
          error: error.message,
        },
      });
      return NextResponse.json(
        {
          error: "Board payload did not match the expected shape",
          issues: error.issues.slice(0, 5),
        },
        { status: 502 },
      );
    }
    throw error;
  }
}
