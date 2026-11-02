import type { JsonResumeProfile } from "../profile/schema.js";
import { formatLocation, type ResumeDocument } from "../resume/document.js";

export type ClaimIssueCode =
  | "UNKNOWN_CONTACT"
  | "UNKNOWN_EMPLOYER"
  | "UNKNOWN_TITLE"
  | "UNKNOWN_DATE"
  | "UNKNOWN_BULLET"
  | "UNKNOWN_EDUCATION"
  | "UNKNOWN_SKILL"
  | "UNKNOWN_PROJECT"
  | "UNKNOWN_CERTIFICATE";

export interface ClaimIssue {
  code: ClaimIssueCode;
  path: string;
  value: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: ClaimIssue[];
  checkedClaims: number;
}

const norm = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, " ").trim();

function sameOptional(a?: string, b?: string): boolean {
  return norm(a ?? "") === norm(b ?? "");
}

/**
 * I1 — Truth. Every employer, title, date, bullet, school, skill, project and
 * certificate in the document must already exist in the master profile.
 *
 * Phase 2 documents are verbatim projections of the profile, so comparisons
 * are exact after whitespace/case normalization. Phase 3 tailoring must keep
 * satisfying this: it may reorder and omit facts, never invent them.
 */
export function validateResumeDocument(
  profile: JsonResumeProfile,
  doc: ResumeDocument,
): ValidationReport {
  const issues: ClaimIssue[] = [];
  let checkedClaims = 0;

  const fail = (code: ClaimIssueCode, path: string, value: string): void => {
    issues.push({ code, path, value });
  };

  const checkOptionalContact = (
    field: "name" | "email" | "phone" | "url" | "location" | "summary",
    expected: string | undefined,
    actual: string | undefined,
  ): void => {
    checkedClaims += 1;
    if (!sameOptional(expected, actual)) {
      fail("UNKNOWN_CONTACT", `contact.${field}`, actual ?? "");
    }
  };

  checkOptionalContact("name", profile.basics.name, doc.contact.name);
  checkOptionalContact("email", profile.basics.email, doc.contact.email);
  checkOptionalContact("phone", profile.basics.phone, doc.contact.phone);
  checkOptionalContact("url", profile.basics.url, doc.contact.url);
  checkOptionalContact(
    "location",
    formatLocation(profile.basics.location),
    doc.contact.location,
  );
  checkOptionalContact("summary", profile.basics.summary, doc.contact.summary);

  const workByCompany = new Map(profile.work.map((w) => [norm(w.company), w]));

  for (const role of doc.roles) {
    const path = `roles[${role.company}]`;
    checkedClaims += 2; // title + dates
    const work = workByCompany.get(norm(role.company));
    if (!work) {
      fail("UNKNOWN_EMPLOYER", `${path}.company`, role.company);
      continue;
    }
    if (norm(role.title) !== norm(work.position)) {
      fail("UNKNOWN_TITLE", `${path}.title`, role.title);
    }
    if (
      role.startDate !== work.startDate ||
      !sameOptional(role.endDate, work.endDate)
    ) {
      fail("UNKNOWN_DATE", `${path}.dates`, `${role.startDate}–${role.endDate ?? ""}`);
    }
    if (!sameOptional(role.summary, work.summary)) {
      fail("UNKNOWN_BULLET", `${path}.summary`, role.summary ?? "");
    }

    const allowedBullets = new Set(work.highlights.map((h) => norm(h.text)));
    for (const [index, bullet] of role.highlights.entries()) {
      checkedClaims += 1;
      if (!allowedBullets.has(norm(bullet))) {
        fail("UNKNOWN_BULLET", `${path}.highlights[${index}]`, bullet);
      }
    }
  }

  const educationByInstitution = new Map(
    profile.education.map((e) => [norm(e.institution), e]),
  );
  for (const edu of doc.education) {
    checkedClaims += 1;
    const entry = educationByInstitution.get(norm(edu.institution));
    if (!entry) {
      fail("UNKNOWN_EDUCATION", `education[${edu.institution}]`, edu.institution);
      continue;
    }
    if (
      !sameOptional(edu.area, entry.area) ||
      !sameOptional(edu.studyType, entry.studyType) ||
      !sameOptional(edu.startDate, entry.startDate) ||
      !sameOptional(edu.endDate, entry.endDate) ||
      !sameOptional(edu.score, entry.score)
    ) {
      fail("UNKNOWN_EDUCATION", `education[${edu.institution}].details`, edu.institution);
    }
  }

  const skillsByName = new Map(profile.skills.map((s) => [norm(s.name), s]));
  for (const group of doc.skills) {
    checkedClaims += 1;
    const entry = skillsByName.get(norm(group.name));
    if (!entry) {
      fail("UNKNOWN_SKILL", `skills[${group.name}]`, group.name);
      continue;
    }
    if (!sameOptional(group.level, entry.level)) {
      fail("UNKNOWN_SKILL", `skills[${group.name}].level`, group.level ?? "");
    }
    const allowed = new Set(entry.keywords.map((k) => norm(k.keyword)));
    for (const [index, keyword] of group.keywords.entries()) {
      checkedClaims += 1;
      if (!allowed.has(norm(keyword))) {
        fail("UNKNOWN_SKILL", `skills[${group.name}].keywords[${index}]`, keyword);
      }
    }
  }

  const projectsByName = new Map(
    profile.projects.map((p) => [norm(p.name), p]),
  );
  for (const project of doc.projects) {
    checkedClaims += 1;
    const entry = projectsByName.get(norm(project.name));
    if (!entry) {
      fail("UNKNOWN_PROJECT", `projects[${project.name}]`, project.name);
      continue;
    }
    if (!sameOptional(project.description, entry.description)) {
      fail("UNKNOWN_BULLET", `projects[${project.name}].description`, project.description ?? "");
    }
    if (
      !sameOptional(project.startDate, entry.startDate) ||
      !sameOptional(project.endDate, entry.endDate) ||
      !sameOptional(project.url, entry.url)
    ) {
      fail("UNKNOWN_DATE", `projects[${project.name}].dates`, project.name);
    }
    const allowedBullets = new Set(entry.highlights.map((h) => norm(h.text)));
    for (const [index, bullet] of project.highlights.entries()) {
      checkedClaims += 1;
      if (!allowedBullets.has(norm(bullet))) {
        fail("UNKNOWN_BULLET", `projects[${project.name}].highlights[${index}]`, bullet);
      }
    }
    const allowedKeywords = new Set(entry.keywords.map((k) => norm(k.keyword)));
    for (const [index, keyword] of project.keywords.entries()) {
      checkedClaims += 1;
      if (!allowedKeywords.has(norm(keyword))) {
        fail("UNKNOWN_SKILL", `projects[${project.name}].keywords[${index}]`, keyword);
      }
    }
  }

  const certificatesByName = new Map(
    profile.certificates.map((c) => [norm(c.name), c]),
  );
  for (const cert of doc.certificates) {
    checkedClaims += 2;
    const entry = certificatesByName.get(norm(cert.name));
    if (!entry) {
      fail("UNKNOWN_CERTIFICATE", `certificates[${cert.name}]`, cert.name);
      continue;
    }
    if (!sameOptional(cert.issuer, entry.issuer) || !sameOptional(cert.date, entry.date)) {
      fail("UNKNOWN_CERTIFICATE", `certificates[${cert.name}].details`, cert.name);
    }
  }

  return { ok: issues.length === 0, issues, checkedClaims };
}

/** Error thrown before any artifact is produced when I1 is violated. */
export class ClaimValidationError extends Error {
  readonly report: ValidationReport;

  constructor(report: ValidationReport) {
    const first = report.issues[0];
    super(
      first
        ? `Claim validation failed: ${first.code} at ${first.path} (${first.value})`
        : "Claim validation failed",
    );
    this.name = "ClaimValidationError";
    this.report = report;
  }
}
