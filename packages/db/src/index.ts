import { Prisma, PrismaClient } from "@prisma/client";
import { redactDeep } from "@jobpilot/llm";
import { buildFactIndex, type JsonResumeProfile } from "@jobpilot/core";

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
