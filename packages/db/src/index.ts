import { Prisma, PrismaClient } from "@prisma/client";
import { redactDeep } from "@jobpilot/llm";
import { buildFactIndex, type JsonResumeProfile } from "@jobpilot/core";
import { EMBEDDING_MODEL, hashEmbedding, vectorLiteral } from "@jobpilot/core";
import {
  canonicalizeUrl,
  contentHashOf,
  type JobDraft,
} from "@jobpilot/sources";

export { hash as hashPassword, verify as verifyPassword } from "@node-rs/argon2";

export const prisma = new PrismaClient();

/**
 * Interactive transactions hold a pooled connection until they commit. Prisma's
 * default maxWait of 2s surfaces as "Unable to start a transaction in the given
 * time" when concurrent requests write the same profile row (two imports, or an
 * import racing a render), so the write paths give the pool room to queue.
 */
const TX_OPTIONS = { maxWait: 15_000, timeout: 30_000 } as const;

export interface AuditInput {
  actor: "SYSTEM" | "USER" | "LLM" | "BROWSER";
  action: string;
  entityType: string;
  entityId?: string;
  payload: Record<string, unknown>;
}

/** Writes an AuditLog row; the payload passes through redaction first (I7/I8). */
export async function writeAudit(entry: AuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actor: entry.actor,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      payload: redactDeep(entry.payload) as object,
    },
  });
}

function toDate(date?: string): Date | null {
  if (!date) return null;
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface RenderedDocumentInput {
  userId: string;
  format: string;
  contentBase64: string;
  validationReport: Record<string, unknown>;
  metadata: Record<string, unknown>;
  auditPayload: Record<string, unknown>;
}

/**
 * Stores a rendered document and its audit row in one transaction (I8), so a
 * document can never exist without the record of who generated it.
 */
export async function saveRenderedDocument(
  input: RenderedDocumentInput,
): Promise<{ id: string; createdAt: Date }> {
  return prisma.$transaction(async (tx) => {
    const saved = await tx.document.create({
      data: {
        userId: input.userId,
        type: "RESUME",
        format: input.format,
        content: input.contentBase64,
        validationReport: input.validationReport as Prisma.InputJsonValue,
        metadata: input.metadata as Prisma.InputJsonValue,
      },
    });
    await tx.auditLog.create({
      data: {
        actor: "USER",
        action: "document.render",
        entityType: "Document",
        entityId: saved.id,
        payload: redactDeep(input.auditPayload) as Prisma.InputJsonValue,
      },
    });
    return { id: saved.id, createdAt: saved.createdAt };
  }, TX_OPTIONS);
}

export interface SaveProfileResult {
  profileId: string;
  version: number;
  factCount: number;
}

/**
 * Persists the master profile and rebuilds the Fact table in one transaction
 * (gate 1.10). The fact rows are replaced atomically; any failure rolls back
 * both the profile JSON and the facts.
 */
export async function saveProfileWithFacts(
  userId: string,
  profile: JsonResumeProfile,
): Promise<SaveProfileResult> {
  const factRows = buildFactRows(profile);
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.profile.findUnique({ where: { userId } });
    const version = (existing?.version ?? 0) + 1;
    const data = {
      jsonResume: profile as object,
      version,
      updatedAt: new Date(),
    };
    const saved = existing
      ? await tx.profile.update({ where: { userId }, data })
      : await tx.profile.create({ data: { ...data, userId } });

    await tx.fact.deleteMany({ where: { profileId: saved.id } });
    await tx.fact.createMany({
      data: factRows.map((f) => ({ ...f, profileId: saved.id })),
    });

    await tx.auditLog.create({
      data: {
        actor: "USER",
        action: "profile.save",
        entityType: "Profile",
        entityId: saved.id,
        payload: redactDeep({
          version,
          factCount: factRows.length,
          name: profile.basics.name,
        }) as object,
      },
    });

    return { profileId: saved.id, version, factCount: factRows.length };
  }, TX_OPTIONS);
  return result;
}

export interface SaveJobsResult {
  created: number;
  updated: number;
  total: number;
  ids: string[];
}

/**
 * Upserts normalized postings on their canonical URL, so the same role arriving
 * from a board, an email link or a manual paste updates one row instead of
 * creating duplicates (gates 3.10, 3.11). The `job.import` audit row is written
 * in the same transaction as the postings (I8).
 */
export async function saveJobs(
  drafts: JobDraft[],
  options: { actor?: "SYSTEM" | "USER" } = {},
): Promise<SaveJobsResult> {
  if (drafts.length === 0) {
    return { created: 0, updated: 0, total: 0, ids: [] };
  }

  return prisma.$transaction(async (tx) => {
    let created = 0;
    let updated = 0;
    const ids: string[] = [];
    const fetchedAt = new Date();

    for (const draft of drafts) {
      const canonicalUrl = canonicalizeUrl(draft.url);
      const parsed = {
        ...draft.parsed,
        ...(draft.keywords.length > 0 ? { keywords: draft.keywords } : {}),
      };
      const data = {
        source: draft.source,
        externalId: draft.externalId ?? null,
        url: draft.url,
        canonicalUrl,
        company: draft.company,
        title: draft.title,
        location: draft.location ?? null,
        remote: draft.remote,
        salaryMin: draft.salaryMin ?? null,
        salaryMax: draft.salaryMax ?? null,
        currency: draft.currency ?? null,
        descriptionText: draft.descriptionText,
        parsed: parsed as Prisma.InputJsonValue,
        postedAt: draft.postedAt ? new Date(draft.postedAt) : null,
        contentHash: contentHashOf(draft),
        fetchedAt,
      };

      const existing = await tx.job.findUnique({
        where: { canonicalUrl },
        select: { id: true },
      });

      if (existing) {
        const saved = await tx.job.update({
          where: { id: existing.id },
          data,
          select: { id: true },
        });
        updated += 1;
        ids.push(saved.id);
      } else {
        const saved = await tx.job.create({ data, select: { id: true } });
        created += 1;
        ids.push(saved.id);
      }
    }

    await tx.auditLog.create({
      data: {
        actor: options.actor ?? "USER",
        action: "job.import",
        entityType: "Job",
        payload: redactDeep({
          created,
          updated,
          total: drafts.length,
          sources: [...new Set(drafts.map((draft) => draft.source))],
        }) as Prisma.InputJsonValue,
      },
    });

    return { created, updated, total: drafts.length, ids };
  }, TX_OPTIONS);
}

interface FactRow {
  fid: string;
  path: string;
  kind: string;
  text: string;
  entities: string[];
  numbers: string[];
  startDate: Date | null;
  endDate: Date | null;
}

/** Builds Fact table rows from the canonical Fact Index so counts never drift. */
export function buildFactRows(profile: JsonResumeProfile): FactRow[] {
  return buildFactIndex(profile).facts.map((f) => ({
    fid: f.fid,
    path: f.path,
    kind: f.kind,
    text: f.text,
    entities: f.entities,
    numbers: f.numbers,
    startDate: toDate(f.startDate),
    endDate: toDate(f.endDate),
  }));
}

/** One browser action the executor performed; audited individually (I8). */
export interface ApplicationAction {
  kind: string;
  detail: string;
  field?: string;
}

/**
 * Queues an application for a job. `Application.jobId` is unique, so a second
 * call returns the existing row instead of creating a duplicate (gate 4.6).
 */
export async function createApplication(input: {
  jobId: string;
  portal: string;
}): Promise<{ id: string; status: string }> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.application.findUnique({
      where: { jobId: input.jobId },
      select: { id: true, status: true },
    });
    if (existing) return existing;

    const created = await tx.application.create({
      data: {
        jobId: input.jobId,
        portal: input.portal,
        status: "QUEUED",
        mode: "COPILOT",
        events: { create: { type: "CREATED", payload: { portal: input.portal } } },
      },
      select: { id: true, status: true },
    });

    await tx.auditLog.create({
      data: {
        actor: "USER",
        action: "application.create",
        entityType: "Application",
        entityId: created.id,
        payload: redactDeep({ jobId: input.jobId, portal: input.portal }) as object,
      },
    });

    return created;
  }, TX_OPTIONS);
}

export interface RecordResultInput {
  applicationId: string;
  status: string;
  actions: ApplicationAction[];
  reason?: string;
  submissionText?: string;
}

/**
 * Stores the outcome of one executor run: the status, one ApplicationEvent per
 * browser action and its own AuditLog row, plus a summary audit row, all in one
 * transaction (gate 4.9).
 */
export async function recordApplicationResult(
  input: RecordResultInput,
): Promise<{ id: string; status: string; events: number }> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.application.update({
      where: { id: input.applicationId },
      data: {
        status: input.status,
        ...(input.status === "SUBMITTED" ? { submittedAt: new Date() } : {}),
        ...(input.reason ? { notes: input.reason } : {}),
        ...(input.submissionText
          ? { answers: { confirmation: input.submissionText } as Prisma.InputJsonValue }
          : {}),
        events: {
          create: [
            {
              type: "STATUS",
              payload: { status: input.status, reason: input.reason ?? null },
            },
            ...input.actions.map((action) => ({
              type: action.kind,
              payload: { detail: action.detail, field: action.field ?? null },
            })),
          ],
        },
      },
      select: { id: true, status: true, _count: { select: { events: true } } },
    });

    if (input.actions.length > 0) {
      await tx.auditLog.createMany({
        data: input.actions.map((action) => ({
          actor: "BROWSER" as const,
          action: `browser.${action.kind.toLowerCase()}`,
          entityType: "Application",
          entityId: input.applicationId,
          payload: redactDeep({
            detail: action.detail,
            field: action.field ?? null,
          }) as Prisma.InputJsonValue,
        })),
      });
    }

    await tx.auditLog.create({
      data: {
        actor: "BROWSER",
        action: "application.result",
        entityType: "Application",
        entityId: input.applicationId,
        payload: redactDeep({
          status: input.status,
          reason: input.reason ?? null,
          actions: input.actions.length,
        }) as object,
      },
    });

    return { id: updated.id, status: updated.status, events: updated._count.events };
  }, TX_OPTIONS);
}

export interface SaveMatchScoreInput {
  jobId: string;
  profileId: string;
  score: number;
  breakdown: Record<string, unknown>;
  explanation: string;
  algoVersion: number;
}

/**
 * One MatchScore per (job, profile, algoVersion): recomputing overwrites the row
 * in place, and changing the algorithm creates a new version instead of
 * silently rewriting history (gate 5.5).
 */
export async function saveMatchScore(
  input: SaveMatchScoreInput,
): Promise<{ id: string; score: number }> {
  return prisma.matchScore.upsert({
    where: {
      jobId_profileId_algoVersion: {
        jobId: input.jobId,
        profileId: input.profileId,
        algoVersion: input.algoVersion,
      },
    },
    update: {
      score: input.score,
      breakdown: input.breakdown as Prisma.InputJsonValue,
      explanation: input.explanation,
    },
    create: {
      jobId: input.jobId,
      profileId: input.profileId,
      score: input.score,
      breakdown: input.breakdown as Prisma.InputJsonValue,
      explanation: input.explanation,
      algoVersion: input.algoVersion,
    },
    select: { id: true, score: true },
  });
}

/** Matches for one profile, best first, optionally above a threshold (gate 5.2). */
export async function listMatches(
  profileId: string,
  options: { threshold?: number; take?: number } = {},
) {
  return prisma.matchScore.findMany({
    where: {
      profileId,
      ...(options.threshold !== undefined ? { score: { gte: options.threshold } } : {}),
    },
    orderBy: [{ score: "desc" }, { id: "asc" }],
    take: options.take ?? 50,
    include: {
      job: {
        select: {
          id: true,
          title: true,
          company: true,
          location: true,
          remote: true,
          url: true,
          postedAt: true,
        },
      },
    },
  });
}

/** Stores a deterministic embedding for a posting, plus the model that made it. */
export async function saveJobEmbedding(
  jobId: string,
  text: string,
  model: string = EMBEDDING_MODEL,
): Promise<number[]> {
  const vector = hashEmbedding(text);
  await prisma.$executeRaw`
    UPDATE "Job"
       SET embedding = ${vectorLiteral(vector)}::vector,
           "embeddingModel" = ${model}
     WHERE id = ${jobId}
  `;
  return vector;
}

/** Reads a stored embedding back, with its dimensionality, for verification. */
export async function getJobEmbedding(
  jobId: string,
): Promise<{ vector: number[]; dims: number; model: string | null } | null> {
  const rows = await prisma.$queryRaw<
    Array<{ embedding: string | null; dims: number | null; model: string | null }>
  >`
    SELECT embedding::text AS embedding,
           vector_dims(embedding) AS dims,
           "embeddingModel" AS model
      FROM "Job"
     WHERE id = ${jobId}
  `;
  const row = rows[0];
  if (!row?.embedding) return null;
  return {
    vector: JSON.parse(row.embedding) as number[],
    dims: row.dims ?? 0,
    model: row.model,
  };
}

/** Nearest postings to a text, by cosine distance in pgvector (gate 5.6). */
export async function rankJobsBySimilarity(
  text: string,
  limit = 5,
): Promise<Array<{ id: string; title: string; similarity: number }>> {
  const literal = vectorLiteral(hashEmbedding(text));
  const rows = await prisma.$queryRaw<
    Array<{ id: string; title: string; similarity: number }>
  >`
    SELECT id, title, 1 - (embedding <=> ${literal}::vector) AS similarity
      FROM "Job"
     WHERE embedding IS NOT NULL
     ORDER BY embedding <=> ${literal}::vector
     LIMIT ${limit}
  `;
  return rows.map((row) => ({ ...row, similarity: Number(row.similarity) }));
}

export interface GapReportInput {
  userId: string;
  inputJobIds: string[];
  gaps: Array<{ keyword: string; jobs: string[]; severity: "high" | "medium" | "low" }>;
}

/** Stores the skill gaps found across the postings the user picked (gate 5.7). */
export async function saveGapReport(input: GapReportInput): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const report = await tx.gapReport.create({
      data: {
        userId: input.userId,
        inputJobIds: input.inputJobIds,
        gaps: input.gaps as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        actor: "SYSTEM",
        action: "match.gap",
        entityType: "GapReport",
        entityId: report.id,
        payload: redactDeep({
          jobs: input.inputJobIds.length,
          gaps: input.gaps.length,
        }) as object,
      },
    });
    return report;
  }, TX_OPTIONS);
}

/**
 * Project plans start as SUGGESTED with no repository and no measured metrics,
 * so nothing can claim a result that was never built (gate 5.8).
 */
export async function saveProjectPlans(
  gapReportId: string,
  blueprints: Array<{ title: string; steps: string[] }>,
): Promise<number> {
  if (blueprints.length === 0) return 0;
  const result = await prisma.projectPlan.createMany({
    data: blueprints.map((blueprint) => ({
      gapReportId,
      blueprint: blueprint as unknown as Prisma.InputJsonValue,
      status: "SUGGESTED",
    })),
  });
  return result.count;
}
