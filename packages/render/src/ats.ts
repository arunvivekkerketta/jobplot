import {
  resumeDocumentText,
  type ResumeDocument,
} from "@jobpilot/core";

export type AtsSeverity = "error" | "warning";

export interface AtsIssue {
  id: string;
  severity: AtsSeverity;
  message: string;
  path?: string;
}

export interface KeywordCoverage {
  required: string[];
  matched: string[];
  missing: string[];
  /** Percentage of required keywords present, 0–100. */
  coverage: number;
}

export interface AtsReport {
  ok: boolean;
  score: number;
  issues: AtsIssue[];
  keywordCoverage?: KeywordCoverage;
}

export interface AtsOptions {
  /** Job description text; words not present in the document are reported. */
  jobDescription?: string;
  /** Maximum characters for a single bullet before it is flagged. */
  maxBulletLength?: number;
  /** Coverage percentage below which a warning is raised. */
  minKeywordCoverage?: number;
}

const STOP_WORDS = new Set([
  "and",
  "are",
  "but",
  "for",
  "from",
  "has",
  "have",
  "into",
  "its",
  "our",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "was",
  "were",
  "will",
  "with",
  "you",
  "your",
  "about",
  "across",
  "also",
  "been",
  "being",
  "can",
  "company",
  "job",
  "more",
  "must",
  "not",
  "role",
  "such",
  "team",
  "than",
  "using",
  "work",
  "working",
  "years",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

/**
 * Deterministic ATS pass. It never calls an LLM and never mutates the
 * document; it only reports what a parser would struggle with.
 */
export function lintResumeDocument(
  doc: ResumeDocument,
  options: AtsOptions = {},
): AtsReport {
  const issues: AtsIssue[] = [];
  const maxBulletLength = options.maxBulletLength ?? 400;
  const minCoverage = options.minKeywordCoverage ?? 60;

  const add = (
    id: string,
    severity: AtsSeverity,
    message: string,
    path?: string,
  ): void => {
    issues.push({ id, severity, message, path });
  };

  if (!doc.contact.name.trim()) {
    add("ATS_NAME_MISSING", "error", "The resume has no name line.", "contact.name");
  }
  if (!doc.contact.email.trim()) {
    add("ATS_EMAIL_MISSING", "error", "No email address — most ATS parsers reject this.", "contact.email");
  }
  if (!doc.contact.phone) {
    add("ATS_PHONE_MISSING", "warning", "No phone number on the contact line.", "contact.phone");
  }
  if (!doc.contact.summary) {
    add("ATS_SUMMARY_MISSING", "warning", "No professional summary; keyword matching suffers.", "contact.summary");
  }

  if (doc.roles.length === 0) {
    add("ATS_EXPERIENCE_MISSING", "error", "No work experience entries.", "roles");
  }
  for (const [index, role] of doc.roles.entries()) {
    const path = `roles[${index}]`;
    if (role.highlights.length === 0) {
      add("ATS_BULLETS_MISSING", "warning", `${role.company} has no achievement bullets.`, path);
    }
    for (const [bulletIndex, bullet] of role.highlights.entries()) {
      if (bullet.length > maxBulletLength) {
        add(
          "ATS_BULLET_TOO_LONG",
          "warning",
          `Bullet exceeds ${maxBulletLength} characters and may be truncated.`,
          `${path}.highlights[${bulletIndex}]`,
        );
      }
    }
    if (!/^\d{4}-\d{2}/.test(role.startDate)) {
      add("ATS_DATE_FORMAT", "warning", `Use YYYY-MM dates for ${role.company}.`, `${path}.startDate`);
    }
  }

  if (doc.skills.length === 0) {
    add("ATS_SKILLS_MISSING", "warning", "No skills section; keyword scanners will miss it.", "skills");
  }

  const text = resumeDocumentText(doc);
  let keywordCoverage: KeywordCoverage | undefined;
  if (options.jobDescription) {
    const required = [...new Set(tokenize(options.jobDescription))];
    const present = new Set(tokenize(text));
    const matched = required.filter((token) => present.has(token));
    const missing = required.filter((token) => !present.has(token));
    const coverage =
      required.length === 0
        ? 100
        : Math.round((matched.length / required.length) * 1000) / 10;
    keywordCoverage = { required, matched, missing, coverage };
    if (coverage < minCoverage) {
      add(
        "ATS_KEYWORD_GAP",
        "warning",
        `Only ${coverage}% of the job description's keywords appear (target ${minCoverage}%).`,
        "keywords",
      );
    }
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const score = Math.max(0, 100 - errors * 15 - warnings * 4);

  return { ok: errors === 0, score, issues, keywordCoverage };
}
