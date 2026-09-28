import { z } from "zod";
import { customAlphabet } from "nanoid";

/**
 * JSON Resume v1 profile schema, extended with a `fid` on every fact
 * (work highlights, project highlights, skill keywords, education entries,
 * certificates, projects). Fids make every generated claim traceable to a
 * source fact (invariant I1).
 *
 * Plain JSON Resume files (strings for highlights/keywords, no fids) are
 * accepted on import; assignMissingFids upgrades and assigns stable ids.
 */

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

export const fidSchema = z
  .string()
  .min(1)
  .regex(/^fid_[0-9a-z]+$/, "fid must look like fid_<base36 id>");

const optionalFid = fidSchema.optional();

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}(-\d{2})?$/, "date must be YYYY-MM or YYYY-MM-DD");

/** Parses YYYY-MM or YYYY-MM-DD into an inclusive month index (year * 12 + month0). */
export function parseMonth(date: string): number {
  const m = /^(\d{4})-(\d{2})/.exec(date);
  if (!m) throw new Error(`Unparseable date: ${date}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new Error(`Bad month in date: ${date}`);
  return year * 12 + (month - 1);
}

const stringToHighlight = z.preprocess(
  (v) => (typeof v === "string" ? { text: v } : v),
  z.object({ fid: optionalFid, text: z.string().min(1) }),
);

const stringToKeyword = z.preprocess(
  (v) => (typeof v === "string" ? { keyword: v } : v),
  z.object({ fid: optionalFid, keyword: z.string().min(1) }),
);

export const basicsSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  url: z.string().url().optional(),
  summary: z.string().optional(),
  location: z
    .object({
      address: z.string().optional(),
      city: z.string().optional(),
      region: z.string().optional(),
      country: z.string().optional(),
    })
    .optional(),
});

export const workSchema = z.object({
  fid: optionalFid,
  company: z.string().min(1),
  position: z.string().min(1),
  website: z.string().url().optional(),
  startDate: dateSchema,
  endDate: dateSchema.optional(),
  summary: z.string().optional(),
  highlights: z.array(stringToHighlight).default([]),
});

export const educationSchema = z.object({
  fid: optionalFid,
  institution: z.string().min(1),
  area: z.string().optional(),
  studyType: z.string().optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  score: z.string().optional(),
  courses: z.array(z.string()).default([]),
});

export const skillSchema = z.object({
  fid: optionalFid,
  name: z.string().min(1),
  level: z.string().optional(),
  keywords: z.array(stringToKeyword).default([]),
});

export const projectSchema = z.object({
  fid: optionalFid,
  name: z.string().min(1),
  description: z.string().optional(),
  highlights: z.array(stringToHighlight).default([]),
  keywords: z.array(stringToKeyword).default([]),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  url: z.string().url().optional(),
  roles: z.array(z.string()).default([]),
  entity: z.string().optional(),
  type: z.string().optional(),
});

export const certificateSchema = z.object({
  fid: optionalFid,
  name: z.string().min(1),
  date: dateSchema.optional(),
  url: z.string().url().optional(),
  issuer: z.string().optional(),
});

/** Input shape: fids optional everywhere; strings accepted for highlights/keywords. */
export const profileInputSchema = z.object({
  basics: basicsSchema,
  work: z.array(workSchema).default([]),
  education: z.array(educationSchema).default([]),
  skills: z.array(skillSchema).default([]),
  projects: z.array(projectSchema).default([]),
  certificates: z.array(certificateSchema).default([]),
});

export type ProfileInput = z.input<typeof profileInputSchema>;

/** Output shape after assignMissingFids: every fact carries a fid. */
export interface Highlight {
  fid: string;
  text: string;
}
export interface SkillKeyword {
  fid: string;
  keyword: string;
}
export interface WorkEntry {
  fid: string;
  company: string;
  position: string;
  website?: string;
  startDate: string;
  endDate?: string;
  summary?: string;
  highlights: Highlight[];
}
export interface EducationEntry {
  fid: string;
  institution: string;
  area?: string;
  studyType?: string;
  startDate?: string;
  endDate?: string;
  score?: string;
  courses: string[];
}
export interface SkillEntry {
  fid: string;
  name: string;
  level?: string;
  keywords: SkillKeyword[];
}
export interface ProjectEntry {
  fid: string;
  name: string;
  description?: string;
  highlights: Highlight[];
  keywords: SkillKeyword[];
  startDate?: string;
  endDate?: string;
  url?: string;
  roles: string[];
  entity?: string;
  type?: string;
}
export interface CertificateEntry {
  fid: string;
  name: string;
  date?: string;
  url?: string;
  issuer?: string;
}
export interface JsonResumeProfile {
  basics: z.infer<typeof basicsSchema>;
  work: WorkEntry[];
  education: EducationEntry[];
  skills: SkillEntry[];
  projects: ProjectEntry[];
  certificates: CertificateEntry[];
}

/**
 * Adds a stable fid_<nanoid> where absent; never changes an existing fid.
 * Accepts plain JSON Resume (strings, no fids) as well as already-fid'd input.
 */
export function assignMissingFids(profile: unknown): JsonResumeProfile {
  const parsed = profileInputSchema.parse(profile);
  const newId = () => `fid_${nanoid()}`;

  const out: JsonResumeProfile = {
    basics: parsed.basics,
    work: parsed.work.map((w) => ({
      ...w,
      fid: w.fid ?? newId(),
      highlights: w.highlights.map((h) => ({ fid: h.fid ?? newId(), text: h.text })),
    })),
    education: parsed.education.map((e) => ({ ...e, fid: e.fid ?? newId() })),
    skills: parsed.skills.map((s) => ({
      ...s,
      fid: s.fid ?? newId(),
      keywords: s.keywords.map((k) => ({ fid: k.fid ?? newId(), keyword: k.keyword })),
    })),
    projects: parsed.projects.map((p) => ({
      ...p,
      fid: p.fid ?? newId(),
      highlights: p.highlights.map((h) => ({ fid: h.fid ?? newId(), text: h.text })),
      keywords: p.keywords.map((k) => ({ fid: k.fid ?? newId(), keyword: k.keyword })),
    })),
    certificates: parsed.certificates.map((c) => ({ ...c, fid: c.fid ?? newId() })),
  };
  return out;
}
