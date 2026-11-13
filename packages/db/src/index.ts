import { Prisma, PrismaClient } from "@prisma/client";
import { redactDeep } from "@jobpilot/llm";
import { buildFactIndex, type JsonResumeProfile } from "@jobpilot/core";
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
