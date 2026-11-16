import { Prisma, PrismaClient } from "@prisma/client";
import { redactDeep } from "@jobpilot/llm";
import {
  DecryptionError,
  LOGIN_ATTEMPT_RETENTION_DAYS,
  buildFactIndex,
  decrypt,
  encrypt,
  type JsonResumeProfile,
} from "@jobpilot/core";
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
  mode?: "COPILOT" | "AUTOPILOT";
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
        mode: input.mode ?? "COPILOT",
        events: {
          create: { type: "CREATED", payload: { portal: input.portal, mode: input.mode ?? "COPILOT" } },
        },
      },
      select: { id: true, status: true },
    });

    await tx.auditLog.create({
      data: {
        actor: input.mode === "AUTOPILOT" ? "SYSTEM" : "USER",
        action: "application.create",
        entityType: "Application",
        entityId: created.id,
        payload: redactDeep({
          jobId: input.jobId,
          portal: input.portal,
          mode: input.mode ?? "COPILOT",
        }) as object,
      },
    });

    return created;
  }, TX_OPTIONS);
}

const CLAIM_STALE_MS = 30 * 60_000;
/** Statuses a run may pick up: anything waiting for another attempt. */
const CLAIMABLE_STATUSES = ["QUEUED", "PAUSED_NEEDS_HUMAN", "BLOCKED"];

/**
 * Takes ownership of one application for one run (H5). A single conditional
 * UPDATE decides the winner, so two processes racing on the same row cannot both
 * be told they may open the browser.
 */
export async function claimApplication(
  applicationId: string,
  now = new Date(),
): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS);
  const claimed = await prisma.application.updateMany({
    where: {
      id: applicationId,
      OR: [
        // Waiting for another attempt, and nobody holds it (or the holder died
        // long enough ago that its claim is stale).
        {
          AND: [
            { status: { in: CLAIMABLE_STATUSES } },
            { OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }] },
          ],
        },
        // A crashed run leaves the row RUNNING; a stale one must be recoverable,
        // otherwise the posting is locked out for ever (H5).
        { AND: [{ status: "RUNNING" }, { claimedAt: { lt: staleBefore } }] },
      ],
    },
    data: { status: "RUNNING", claimedAt: now },
  });
  return claimed.count === 1;
}

/** Gives a claim back without recording a result: the browser never opened. */
export async function releaseApplication(applicationId: string): Promise<void> {
  await prisma.application.updateMany({
    where: { id: applicationId, status: "RUNNING" },
    data: { status: "QUEUED", claimedAt: null },
  });
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
        // The run that owned this row is finished with it, whatever the outcome.
        claimedAt: null,
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

export interface SaveResumeVersionInput {
  profileId: string;
  jobId?: string | null;
  tailoredJson: unknown;
  validationReport: unknown;
  keywordReport: unknown;
}

/**
 * Stores a tailored version with its claim-check and keyword reports, plus the
 * `resume.tailor` audit row in the same transaction (I8, gate 6.3).
 */
export async function saveResumeVersion(
  input: SaveResumeVersionInput,
): Promise<{ id: string; approvedAt: Date | null }> {
  return prisma.$transaction(async (tx) => {
    const version = await tx.resumeVersion.create({
      data: {
        profileId: input.profileId,
        jobId: input.jobId ?? null,
        tailoredJson: input.tailoredJson as Prisma.InputJsonValue,
        validationReport: input.validationReport as Prisma.InputJsonValue,
        keywordReport: input.keywordReport as Prisma.InputJsonValue,
      },
      select: { id: true, approvedAt: true },
    });

    const keywordReport = input.keywordReport as { finalCoverage?: number } | null;
    await tx.auditLog.create({
      data: {
        actor: "SYSTEM",
        action: "resume.tailor",
        entityType: "ResumeVersion",
        entityId: version.id,
        payload: redactDeep({
          jobId: input.jobId ?? null,
          finalCoverage: keywordReport?.finalCoverage ?? null,
        }) as object,
      },
    });

    return version;
  }, TX_OPTIONS);
}

/** Attaches the rendered files; `pdfPath`/`docxPath` are download URLs. */
export async function setResumeVersionArtifacts(
  id: string,
  artifacts: { pdfPath?: string | null; docxPath?: string | null },
): Promise<void> {
  await prisma.resumeVersion.update({
    where: { id },
    data: {
      ...(artifacts.pdfPath !== undefined ? { pdfPath: artifacts.pdfPath } : {}),
      ...(artifacts.docxPath !== undefined ? { docxPath: artifacts.docxPath } : {}),
    },
  });
}

/** Approval is explicit and audited; it is what the submit path checks (gate 6.4). */
export async function approveResumeVersion(
  id: string,
): Promise<{ id: string; approvedAt: Date | null }> {
  return prisma.$transaction(async (tx) => {
    const version = await tx.resumeVersion.update({
      where: { id },
      data: { approvedAt: new Date() },
      select: { id: true, approvedAt: true },
    });
    await tx.auditLog.create({
      data: {
        actor: "USER",
        action: "resume.approve",
        entityType: "ResumeVersion",
        entityId: version.id,
        payload: { approvedAt: version.approvedAt?.toISOString() ?? null },
      },
    });
    return version;
  }, TX_OPTIONS);
}

export async function listResumeVersions(profileId: string, take = 25) {
  return prisma.resumeVersion.findMany({
    where: { profileId },
    orderBy: { id: "desc" },
    take,
  });
}

export async function findResumeVersion(id: string) {
  return prisma.resumeVersion.findUnique({
    where: { id },
    select: {
      id: true,
      profileId: true,
      approvedAt: true,
      jobId: true,
      pdfPath: true,
      docxPath: true,
      keywordReport: true,
    },
  });
}

export interface AnswerInput {
  userId: string;
  key: string;
  questionPattern?: string | null;
  answer: string;
  sensitive: boolean;
}

/** User-scoped Answer Bank write; the unique key makes editing an upsert (gate 6.5). */
export async function upsertAnswer(
  input: AnswerInput,
): Promise<{ id: string; key: string }> {
  return prisma.$transaction(async (tx) => {
    const entry = await tx.answerBankEntry.upsert({
      where: { userId_key: { userId: input.userId, key: input.key } },
      update: {
        // Sensitive answers are encrypted at rest (I7); the column only ever holds
        // plaintext for non-sensitive entries.
        answer: input.sensitive ? encrypt(input.answer) : input.answer,
        sensitive: input.sensitive,
        ...(input.questionPattern !== undefined
          ? { questionPattern: input.questionPattern }
          : {}),
      },
      create: {
        userId: input.userId,
        key: input.key,
        questionPattern: input.questionPattern ?? null,
        answer: input.sensitive ? encrypt(input.answer) : input.answer,
        sensitive: input.sensitive,
        source: "USER",
      },
      select: { id: true, key: true },
    });
    await tx.auditLog.create({
      data: {
        actor: "USER",
        action: "answer.save",
        entityType: "AnswerBankEntry",
        entityId: entry.id,
        // The answer text itself is never logged (I5/I7).
        payload: { key: entry.key, sensitive: input.sensitive },
      },
    });
    return entry;
  }, TX_OPTIONS);
}

/**
 * Records one password attempt (M7). The address is normalized so a differently
 * cased sign-in counts against the same account, and rows older than the
 * retention window are removed on the way through.
 */
export async function recordLoginAttempt(email: string, ok: boolean): Promise<void> {
  const normalized = email.trim().toLowerCase();
  await prisma.loginAttempt.create({ data: { email: normalized, ok } });
  const cutoff = new Date(Date.now() - LOGIN_ATTEMPT_RETENTION_DAYS * 24 * 60 * 60_000);
  await prisma.loginAttempt.deleteMany({ where: { at: { lt: cutoff } } });
}

/** Failed attempts for one address inside the throttling window. */
export async function recentFailedLogins(email: string, minutes: number): Promise<number> {
  const since = new Date(Date.now() - minutes * 60_000);
  return prisma.loginAttempt.count({
    where: { email: email.trim().toLowerCase(), ok: false, at: { gte: since } },
  });
}

export async function listAnswers(userId: string) {
  const rows = await prisma.answerBankEntry.findMany({
    where: { userId },
    orderBy: { key: "asc" },
    select: { id: true, key: true, questionPattern: true, answer: true, sensitive: true },
  });

  return rows.map((row) => {
    if (!row.sensitive) return row;
    try {
      return { ...row, answer: decrypt(row.answer) };
    } catch (error) {
      if (!(error instanceof DecryptionError)) throw error;
      // A tampered or re-keyed value must not break the whole page, and the
      // warning carries the row id only, never the value (I7).
      console.warn(`answer.decrypt_failed id=${row.id}`);
      return { ...row, answer: "" };
    }
  });
}

export async function deleteAnswer(input: { userId: string; id: string }): Promise<boolean> {
  const existing = await prisma.answerBankEntry.findFirst({
    where: { id: input.id, userId: input.userId },
    select: { id: true },
  });
  if (!existing) return false;
  await prisma.$transaction(async (tx) => {
    await tx.answerBankEntry.delete({ where: { id: existing.id } });
    await tx.auditLog.create({
      data: {
        actor: "USER",
        action: "answer.delete",
        entityType: "AnswerBankEntry",
        entityId: existing.id,
        payload: {},
      },
    });
  }, TX_OPTIONS);
  return true;
}

export interface SubmissionCounts {
  total: number;
  byPortal: Record<string, number>;
  lastByPortal: Record<string, Date | undefined>;
}

/**
 * Caps are counted from stored submissions, not from memory, so a restart or a
 * second process cannot reset the budget (gate 7.3).
 */
export async function submissionCounts(input: {
  since: Date;
}): Promise<SubmissionCounts> {
  const rows = await prisma.application.findMany({
    where: { status: "SUBMITTED", submittedAt: { gte: input.since } },
    select: { portal: true, submittedAt: true },
  });

  const byPortal: Record<string, number> = {};
  const lastByPortal: Record<string, Date | undefined> = {};
  let total = 0;

  for (const row of rows) {
    total += 1;
    byPortal[row.portal] = (byPortal[row.portal] ?? 0) + 1;
    const at = row.submittedAt ?? undefined;
    if (at) {
      const previous = lastByPortal[row.portal];
      if (!previous || at > previous) lastByPortal[row.portal] = at;
    }
  }

  return { total, byPortal, lastByPortal };
}

/**
 * Lifetime Co-Pilot approvals per portal: the trust ladder's only input (4.2).
 *
 * `submissionCounts` is scoped to today and to every mode, so it cannot answer
 * this; a portal earned last month must stay earned, and an Auto-Pilot submission
 * must never count as the user's own approval.
 */
export async function approvedCoPilotByPortal(): Promise<Record<string, number>> {
  const rows = await prisma.application.groupBy({
    by: ["portal"],
    where: { mode: "COPILOT", status: "SUBMITTED" },
    _count: { _all: true },
  });

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.portal] = row._count._all;
  return counts;
}

/** Bytes of a stored document, scoped to its owner, for attaching to a form. */
export async function readDocumentBytes(input: {
  id: string;
  userId: string;
}): Promise<{ bytes: Buffer; format: string } | null> {
  const document = await prisma.document.findFirst({
    where: { id: input.id, userId: input.userId },
    select: { content: true, format: true },
  });
  if (!document) return null;
  return { bytes: Buffer.from(document.content, "base64"), format: document.format };
}

/**
 * Unlocks (mode AUTOPILOT) or locks one portal in Settings.perPortalMode. The
 * JSON merge is transactional with the `portal.unlock`/`portal.lock` audit row,
 * so a policy can never change without the record of who changed it (gate 7.5).
 */
export async function setPortalPolicy(input: {
  userId: string;
  portal: string;
  mode: "AUTOPILOT" | "COPILOT";
}): Promise<Record<string, unknown>> {
  return prisma.$transaction(async (tx) => {
    const settings = await tx.settings.upsert({
      where: { userId: input.userId },
      update: {},
      create: { userId: input.userId },
    });
    const current = (settings.perPortalMode ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...current };
    if (input.mode === "AUTOPILOT") {
      next[input.portal] = { mode: "AUTOPILOT", unlockedAt: new Date().toISOString() };
    } else {
      delete next[input.portal];
    }

    await tx.settings.update({
      where: { userId: input.userId },
      data: { perPortalMode: next as Prisma.InputJsonValue },
    });
    await tx.auditLog.create({
      data: {
        actor: "USER",
        action: input.mode === "AUTOPILOT" ? "portal.unlock" : "portal.lock",
        entityType: "Settings",
        entityId: input.userId,
        payload: { portal: input.portal, mode: input.mode },
      },
    });
    return next;
  }, TX_OPTIONS);
}

/**
 * Settings rows for the Auto-Pilot scheduler. `perPortalMode` is returned raw so
 * the caller's pure predicate decides who is due (gate 8.2).
 */
export async function listSchedulingSettings(): Promise<
  Array<{
    userId: string;
    mode: string;
    allowSubmit: boolean;
    killSwitch: boolean;
    perPortalMode: unknown;
  }>
> {
  return prisma.settings.findMany({
    select: {
      userId: true,
      mode: true,
      allowSubmit: true,
      killSwitch: true,
      perPortalMode: true,
    },
    orderBy: { userId: "asc" },
  });
}

/** 4.6: the row a queued run is tracked by, created before the job is sent. */
export async function createAutopilotRun(input: {
  userId: string;
  limit?: number;
  jobIds?: string[];
}): Promise<{ id: string; status: string }> {
  return prisma.autopilotRun.create({
    data: {
      userId: input.userId,
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
      ...(input.jobIds !== undefined ? { jobIds: input.jobIds } : {}),
    },
    select: { id: true, status: true },
  });
}

/**
 * Marks a run RUNNING. Conditional on the current status, so a duplicate delivery
 * of the same job cannot run the batch twice.
 */
export async function startAutopilotRun(id: string): Promise<boolean> {
  const { count } = await prisma.autopilotRun.updateMany({
    where: { id, status: "QUEUED" },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  return count === 1;
}

export async function finishAutopilotRun(input: {
  id: string;
  result: Record<string, unknown>;
}): Promise<void> {
  await prisma.autopilotRun.update({
    where: { id: input.id },
    data: {
      status: "DONE",
      finishedAt: new Date(),
      result: input.result as Prisma.InputJsonValue,
    },
  });
}

export async function failAutopilotRun(input: { id: string; error: string }): Promise<void> {
  await prisma.autopilotRun.update({
    where: { id: input.id },
    data: { status: "FAILED", finishedAt: new Date(), error: input.error.slice(0, 1000) },
  });
}

/** Owner-scoped read: a run id from another account is simply not found. */
export async function getAutopilotRun(input: {
  id: string;
  userId: string;
}): Promise<{
  id: string;
  status: string;
  requestedAt: Date;
  finishedAt: Date | null;
  result: unknown;
  error: string | null;
} | null> {
  return prisma.autopilotRun.findFirst({
    where: { id: input.id, userId: input.userId },
    select: {
      id: true,
      status: true,
      requestedAt: true,
      finishedAt: true,
      result: true,
      error: true,
    },
  });
}

/** A run that a worker never picked up must not stay QUEUED for ever. */
export async function failStaleAutopilotRuns(before: Date): Promise<number> {
  const { count } = await prisma.autopilotRun.updateMany({
    where: { status: { in: ["QUEUED", "RUNNING"] }, requestedAt: { lt: before } },
    data: { status: "FAILED", finishedAt: new Date(), error: "No worker picked the run up." },
  });
  return count;
}
