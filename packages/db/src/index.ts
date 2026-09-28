import { PrismaClient } from "@prisma/client";
import { redactDeep } from "@jobpilot/llm";
import type { JsonResumeProfile } from "@jobpilot/core";

export { hash as hashPassword, verify as verifyPassword } from "@node-rs/argon2";

export const prisma = new PrismaClient();

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
  });
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

/** Builds Fact table rows from a fid-complete profile (mirrors FactIndex kinds). */
export function buildFactRows(profile: JsonResumeProfile): FactRow[] {
  const rows: FactRow[] = [];
  const push = (
    fid: string,
    path: string,
    kind: string,
    text: string,
    startDate?: string,
    endDate?: string,
  ) => {
    rows.push({
      fid,
      path,
      kind,
      text,
      entities: [],
      numbers: [],
      startDate: toDate(startDate),
      endDate: toDate(endDate),
    });
  };

  for (const w of profile.work) {
    push(w.fid, `work[${w.company}]`, "ROLE", `${w.position} at ${w.company}`, w.startDate, w.endDate);
    for (const h of w.highlights) {
      push(h.fid, `work[${w.company}].highlights`, "EXPERIENCE_BULLET", h.text, w.startDate, w.endDate);
    }
  }
  for (const e of profile.education) {
    const text = [e.studyType, e.area].filter(Boolean).join(" ") || e.institution;
    push(e.fid, `education[${e.institution}]`, "EDUCATION", `${text} — ${e.institution}`, e.startDate, e.endDate);
  }
  for (const s of profile.skills) {
    push(s.fid, `skills[${s.name}]`, "SKILL", s.name);
    for (const k of s.keywords) {
      push(k.fid, `skills[${s.name}].keywords`, "SKILL", k.keyword);
    }
  }
  for (const p of profile.projects) {
    push(p.fid, `projects[${p.name}]`, "ROLE", p.name, p.startDate, p.endDate);
    for (const h of p.highlights) {
      push(h.fid, `projects[${p.name}].highlights`, "PROJECT_BULLET", h.text, p.startDate, p.endDate);
    }
    for (const k of p.keywords) {
      push(k.fid, `projects[${p.name}].keywords`, "SKILL", k.keyword);
    }
  }
  for (const c of profile.certificates) {
    push(c.fid, `certificates[${c.name}]`, "CERT", `${c.name} (${c.issuer ?? "issuer unknown"})`, c.date);
  }
  if (profile.basics.summary) {
    push(`fid_summary_${profile.basics.name.length}`, "basics.summary", "SUMMARY", profile.basics.summary);
  }
  return rows;
}
