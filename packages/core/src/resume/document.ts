import type { JsonResumeProfile } from "../profile/schema.js";

export type ResumeDocumentKind = "RESUME" | "MOCK_OFFER";

export interface ResumeContact {
  name: string;
  email: string;
  phone?: string;
  url?: string;
  location?: string;
  summary?: string;
}

export interface ResumeRole {
  company: string;
  title: string;
  startDate: string;
  endDate?: string;
  summary?: string;
  highlights: string[];
}

export interface ResumeEducation {
  institution: string;
  area?: string;
  studyType?: string;
  startDate?: string;
  endDate?: string;
  score?: string;
}

export interface ResumeSkillGroup {
  name: string;
  level?: string;
  keywords: string[];
}

export interface ResumeProject {
  name: string;
  description?: string;
  url?: string;
  startDate?: string;
  endDate?: string;
  highlights: string[];
  keywords: string[];
}

export interface ResumeCertificate {
  name: string;
  issuer?: string;
  date?: string;
  url?: string;
}

/**
 * The only shape renderers accept. Every string here is copied from the
 * profile by `buildResumeDocument`, which is what makes I1 checkable before
 * any artifact leaves the system.
 */
export interface ResumeDocument {
  contact: ResumeContact;
  roles: ResumeRole[];
  education: ResumeEducation[];
  skills: ResumeSkillGroup[];
  projects: ResumeProject[];
  certificates: ResumeCertificate[];
}

export function formatLocation(
  location: JsonResumeProfile["basics"]["location"],
): string | undefined {
  if (!location) return undefined;
  const parts = [location.city, location.region, location.country].filter(
    (p): p is string => Boolean(p),
  );
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/** Deterministic projection of the master profile; order is preserved. */
export function buildResumeDocument(profile: JsonResumeProfile): ResumeDocument {
  return {
    contact: {
      name: profile.basics.name,
      email: profile.basics.email,
      phone: profile.basics.phone,
      url: profile.basics.url,
      location: formatLocation(profile.basics.location),
      summary: profile.basics.summary,
    },
    roles: profile.work.map((w) => ({
      company: w.company,
      title: w.position,
      startDate: w.startDate,
      endDate: w.endDate,
      summary: w.summary,
      highlights: w.highlights.map((h) => h.text),
    })),
    education: profile.education.map((e) => ({
      institution: e.institution,
      area: e.area,
      studyType: e.studyType,
      startDate: e.startDate,
      endDate: e.endDate,
      score: e.score,
    })),
    skills: profile.skills.map((s) => ({
      name: s.name,
      level: s.level,
      keywords: s.keywords.map((k) => k.keyword),
    })),
    projects: profile.projects.map((p) => ({
      name: p.name,
      description: p.description,
      url: p.url,
      startDate: p.startDate,
      endDate: p.endDate,
      highlights: p.highlights.map((h) => h.text),
      keywords: p.keywords.map((k) => k.keyword),
    })),
    certificates: profile.certificates.map((c) => ({
      name: c.name,
      issuer: c.issuer,
      date: c.date,
      url: c.url,
    })),
  };
}

/** Flat text used by ATS keyword coverage and document search. */
export function resumeDocumentText(doc: ResumeDocument): string {
  const lines: string[] = [
    doc.contact.name,
    doc.contact.email,
    doc.contact.phone ?? "",
    doc.contact.url ?? "",
    doc.contact.location ?? "",
    doc.contact.summary ?? "",
  ];
  for (const role of doc.roles) {
    lines.push(role.title, role.company, role.startDate, role.endDate ?? "");
    if (role.summary) lines.push(role.summary);
    lines.push(...role.highlights);
  }
  for (const edu of doc.education) {
    lines.push(
      [edu.studyType, edu.area].filter(Boolean).join(" "),
      edu.institution,
      edu.startDate ?? "",
      edu.endDate ?? "",
    );
  }
  for (const group of doc.skills) {
    lines.push(group.name, ...group.keywords);
  }
  for (const project of doc.projects) {
    lines.push(project.name, project.description ?? "", ...project.highlights);
    lines.push(...project.keywords);
  }
  for (const cert of doc.certificates) {
    lines.push(cert.name, cert.issuer ?? "", cert.date ?? "");
  }
  return lines.filter(Boolean).join("\n");
}
