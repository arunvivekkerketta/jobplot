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
 * Groups profile entries by a normalized key. Two roles (or schools, skill
 * groups, projects, certificates) can share a key — the same employer twice is
 * ordinary — so a lookup must consider every entry rather than keep the last one.
 */
function groupBy<T>(entries: readonly T[], key: (entry: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const entry of entries) {
    const normalized = norm(key(entry));
    const list = map.get(normalized);
    if (list) list.push(entry);
    else map.set(normalized, [entry]);
  }
  return map;
}

/**
 * I1 — Truth. Every employer, title, date, bullet, school, skill, project and
 * certificate in the document must already exist in the master profile.
 *
 * Phase 2 documents are verbatim projections of the profile, so comparisons
 * are exact after whitespace/case normalization. Phase 3 tailoring must keep
 * satisfying this: it may reorder and omit facts, never invent them.
 *
 * When one key appears more than once in the profile, a claim is accepted if it
 * matches ANY of those entries: a promotion at the same company must not make a
 * truthful resume fail.
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

  const workByCompany = groupBy(profile.work, (work) => work.company);

  for (const role of doc.roles) {
    const path = `roles[${role.company}]`;
    checkedClaims += 2; // title + dates
    const entries = workByCompany.get(norm(role.company));
    if (!entries || entries.length === 0) {
      fail("UNKNOWN_EMPLOYER", `${path}.company`, role.company);
      continue;
    }

    const matching = entries.filter(
      (work) =>
        norm(role.title) === norm(work.position) &&
        role.startDate === work.startDate &&
        sameOptional(role.endDate, work.endDate) &&
        sameOptional(role.summary, work.summary),
    );

    if (matching.length === 0) {
      // Report the differences against the closest entry (the first one stored)
      // so the message names what is actually wrong.
      const closest = entries[0]!;
      if (norm(role.title) !== norm(closest.position)) {
        fail("UNKNOWN_TITLE", `${path}.title`, role.title);
      }
      if (role.startDate !== closest.startDate || !sameOptional(role.endDate, closest.endDate)) {
        fail("UNKNOWN_DATE", `${path}.dates`, `${role.startDate}–${role.endDate ?? ""}`);
      }
      if (!sameOptional(role.summary, closest.summary)) {
        fail("UNKNOWN_BULLET", `${path}.summary`, role.summary ?? "");
      }
    }

    // A bullet is a fact of the company, so any of its roles may supply it.
    const allowedBullets = new Set(
      entries.flatMap((work) => work.highlights.map((highlight) => norm(highlight.text))),
    );
    for (const [index, bullet] of role.highlights.entries()) {
      checkedClaims += 1;
      if (!allowedBullets.has(norm(bullet))) {
        fail("UNKNOWN_BULLET", `${path}.highlights[${index}]`, bullet);
      }
    }
  }

  const educationByInstitution = groupBy(profile.education, (entry) => entry.institution);
  for (const edu of doc.education) {
    checkedClaims += 1;
    const entries = educationByInstitution.get(norm(edu.institution));
    if (!entries || entries.length === 0) {
      fail("UNKNOWN_EDUCATION", `education[${edu.institution}]`, edu.institution);
      continue;
    }
    const matches = entries.some(
      (entry) =>
        sameOptional(edu.area, entry.area) &&
        sameOptional(edu.studyType, entry.studyType) &&
        sameOptional(edu.startDate, entry.startDate) &&
        sameOptional(edu.endDate, entry.endDate) &&
        sameOptional(edu.score, entry.score),
    );
    if (!matches) {
      fail("UNKNOWN_EDUCATION", `education[${edu.institution}].details`, edu.institution);
    }
  }

  const skillsByName = groupBy(profile.skills, (skill) => skill.name);
  for (const group of doc.skills) {
    checkedClaims += 1;
    const entries = skillsByName.get(norm(group.name));
    if (!entries || entries.length === 0) {
      fail("UNKNOWN_SKILL", `skills[${group.name}]`, group.name);
      continue;
    }
    const levelKnown = entries.some((entry) => sameOptional(group.level, entry.level));
    if (!levelKnown) {
      fail("UNKNOWN_SKILL", `skills[${group.name}].level`, group.level ?? "");
    }
    const allowed = new Set(
      entries.flatMap((entry) => entry.keywords.map((keyword) => norm(keyword.keyword))),
    );
    for (const [index, keyword] of group.keywords.entries()) {
      checkedClaims += 1;
      if (!allowed.has(norm(keyword))) {
        fail("UNKNOWN_SKILL", `skills[${group.name}].keywords[${index}]`, keyword);
      }
    }
  }

  const projectsByName = groupBy(profile.projects, (project) => project.name);
  for (const project of doc.projects) {
    checkedClaims += 1;
    const entries = projectsByName.get(norm(project.name));
    if (!entries || entries.length === 0) {
      fail("UNKNOWN_PROJECT", `projects[${project.name}]`, project.name);
      continue;
    }
    const matching = entries.filter(
      (entry) =>
        sameOptional(project.description, entry.description) &&
        sameOptional(project.startDate, entry.startDate) &&
        sameOptional(project.endDate, entry.endDate) &&
        sameOptional(project.url, entry.url),
    );
    if (matching.length === 0) {
      const detailsMatch = entries.some((entry) =>
        sameOptional(project.startDate, entry.startDate) &&
        sameOptional(project.endDate, entry.endDate) &&
        sameOptional(project.url, entry.url),
      );
      if (!detailsMatch) {
        fail("UNKNOWN_DATE", `projects[${project.name}].dates`, project.name);
      }
      const descriptionMatch = entries.some((entry) =>
        sameOptional(project.description, entry.description),
      );
      if (!descriptionMatch) {
        fail(
          "UNKNOWN_BULLET",
          `projects[${project.name}].description`,
          project.description ?? "",
        );
      }
    }
    const allowedBullets = new Set(
      entries.flatMap((entry) => entry.highlights.map((highlight) => norm(highlight.text))),
    );
    for (const [index, bullet] of project.highlights.entries()) {
      checkedClaims += 1;
      if (!allowedBullets.has(norm(bullet))) {
        fail("UNKNOWN_BULLET", `projects[${project.name}].highlights[${index}]`, bullet);
      }
    }
    const allowedKeywords = new Set(
      entries.flatMap((entry) => entry.keywords.map((keyword) => norm(keyword.keyword))),
    );
    for (const [index, keyword] of project.keywords.entries()) {
      checkedClaims += 1;
      if (!allowedKeywords.has(norm(keyword))) {
        fail("UNKNOWN_SKILL", `projects[${project.name}].keywords[${index}]`, keyword);
      }
    }
  }

  const certificatesByName = groupBy(profile.certificates, (certificate) => certificate.name);
  for (const cert of doc.certificates) {
    checkedClaims += 2;
    const entries = certificatesByName.get(norm(cert.name));
    if (!entries || entries.length === 0) {
      fail("UNKNOWN_CERTIFICATE", `certificates[${cert.name}]`, cert.name);
      continue;
    }
    const matches = entries.some(
      (entry) => sameOptional(cert.issuer, entry.issuer) && sameOptional(cert.date, entry.date),
    );
    if (!matches) {
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
