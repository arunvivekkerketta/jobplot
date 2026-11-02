import type { JsonResumeProfile } from "./schema.js";
import { canonicalize, normalizeTerm } from "./aliases.js";

export type FactKind =
  | "EXPERIENCE_BULLET"
  | "PROJECT_BULLET"
  | "SKILL"
  | "EDUCATION"
  | "CERT"
  | "ROLE"
  | "SUMMARY";

export interface Fact {
  fid: string;
  path: string;
  kind: FactKind;
  text: string;
  entities: string[];
  numbers: string[];
  startDate?: string;
  endDate?: string;
}

export interface FactIndex {
  facts: Fact[];
  numbers: Set<string>;
  entities: Set<string>;
  yearsOfExperience(skill: string): number;
  hasSkill(term: string): boolean;
}

const SENIORITY_WORDS = new Set([
  "senior",
  "junior",
  "lead",
  "principal",
  "staff",
  "head",
  "chief",
  "intern",
  "director",
  "vp",
  "manager",
]);

/**
 * Extracts the numeric tokens a fact contains, normalized so that
 * "1,200", "1.2k", "40%", "$3M" all become comparable tokens.
 */
export function extractNumbers(text: string): string[] {
  const out: string[] = [];
  const re =
    /\$?\d[\d,]*(?:\.\d+)?\s*(?:k|m|bn|b|million|billion|%|percent|x)?/gi;
  for (const match of text.matchAll(re)) {
    const tok = match[0]!.trim().toLowerCase().replace(/\s+/g, " ");
    if (tok) out.push(tok);
  }
  return out;
}

/** Normalizes a numeric token to a canonical comparable form. */
export function normalizeNumberToken(tok: string): string {
  let t = tok.trim().toLowerCase().replace(/\s+/g, " ");
  t = t.replace(/^\$/, "");
  const suffixMap: Record<string, number> = {
    k: 1e3,
    m: 1e6,
    b: 1e9,
    bn: 1e9,
    million: 1e6,
    billion: 1e9,
  };
  const m = /^([\d,]+(?:\.\d+)?)(k|m|bn|b|million|billion|%|percent|x)?$/.exec(t);
  if (!m) return t;
  const numPart = m[1]!.replace(/,/g, "");
  const suffix = m[2] ?? "";
  if (suffix === "%" || suffix === "percent") return `${numPart}%`;
  if (suffix === "x") return `${numPart}x`;
  if (suffix) {
    const factor = suffixMap[suffix];
    if (factor !== undefined) {
      const value = Number(numPart) * factor;
      if (!Number.isNaN(value)) return String(value);
    }
  }
  return String(Number(numPart));
}

const TOOL_LIKE = new Set([
  "kubernetes",
  "docker",
  "terraform",
  "postgresql",
  "redis",
  "graphql",
  "typescript",
  "javascript",
  "python",
  "java",
  "react",
  "nextjs",
  "nodejs",
  "kafka",
  "spark",
  "airflow",
]);

function looksLikeTool(token: string): boolean {
  return TOOL_LIKE.has(token) || /\d/.test(token) === false;
}

/** Capitalized words that are probably entity names, filtering sentence starts. */
function extractEntityCandidates(text: string): string[] {
  const candidates: string[] = [];
  const re = /\b[A-Z][A-Za-z0-9.+#-]{1,}\b/g;
  for (const m of text.matchAll(re)) {
    const tok = m[0];
    if (SENIORITY_WORDS.has(tok.toLowerCase())) continue;
    candidates.push(tok);
  }
  return candidates;
}

/**
 * Builds the Fact Index from a fid-complete profile.
 * All computations are pure and deterministic (no LLM).
 */
export function buildFactIndex(
  profile: JsonResumeProfile,
  opts: { now?: string } = {},
): FactIndex {
  const facts: Fact[] = [];
  const numbers = new Set<string>();
  const entities = new Set<string>();

  const pushFact = (
    fid: string,
    path: string,
    kind: FactKind,
    text: string,
    startDate?: string,
    endDate?: string,
  ): void => {
    const toks = extractNumbers(text).map(normalizeNumberToken);
    const ents = extractEntityCandidates(text).map((e) => canonicalize(e));
    for (const n of toks) numbers.add(n);
    for (const e of ents) entities.add(e);
    facts.push({ fid, path, kind, text, entities: ents, numbers: toks, startDate, endDate });
  };

  for (const w of profile.work) {
    pushFact(w.fid, `work[${w.company}]`, "ROLE", `${w.position} at ${w.company}`, w.startDate, w.endDate);
    entities.add(canonicalize(w.company));
    for (const h of w.highlights) {
      pushFact(h.fid, `work[${w.company}].highlights`, "EXPERIENCE_BULLET", h.text, w.startDate, w.endDate);
    }
  }

  for (const e of profile.education) {
    const text = [e.studyType, e.area].filter(Boolean).join(" ") || e.institution;
    pushFact(e.fid, `education[${e.institution}]`, "EDUCATION", `${text} — ${e.institution}`, e.startDate, e.endDate);
    entities.add(canonicalize(e.institution));
    if (e.area) entities.add(canonicalize(e.area));
    if (e.studyType) entities.add(canonicalize(e.studyType));
  }

  for (const s of profile.skills) {
    pushFact(s.fid, `skills[${s.name}]`, "SKILL", s.name);
    entities.add(canonicalize(s.name));
    for (const k of s.keywords) {
      pushFact(k.fid, `skills[${s.name}].keywords`, "SKILL", k.keyword);
      entities.add(canonicalize(k.keyword));
    }
  }

  for (const p of profile.projects) {
    pushFact(p.fid, `projects[${p.name}]`, "ROLE", p.name, p.startDate, p.endDate);
    entities.add(canonicalize(p.name));
    if (p.description) {
      // The project itself owns p.fid, so the description needs its own id.
      pushFact(
        `fid_pdesc_${p.fid.replace(/^fid_/, "")}`,
        `projects[${p.name}].description`,
        "SUMMARY",
        p.description,
        p.startDate,
        p.endDate,
      );
    }
    for (const h of p.highlights) {
      pushFact(h.fid, `projects[${p.name}].highlights`, "PROJECT_BULLET", h.text, p.startDate, p.endDate);
    }
    for (const k of p.keywords) {
      pushFact(k.fid, `projects[${p.name}].keywords`, "SKILL", k.keyword);
      entities.add(canonicalize(k.keyword));
    }
  }

  for (const c of profile.certificates) {
    pushFact(c.fid, `certificates[${c.name}]`, "CERT", `${c.name} (${c.issuer ?? "issuer unknown"})`, c.date);
    entities.add(canonicalize(c.name));
    if (c.issuer) entities.add(canonicalize(c.issuer));
  }

  if (profile.basics.summary) {
    const fid = `fid_summary_${profile.basics.name.length}`;
    pushFact(fid, "basics.summary", "SUMMARY", profile.basics.summary);
  }

  const hasSkill = (term: string): boolean => {
    const canon = canonicalize(term);
    if (entities.has(canon)) return true;
    for (const e of entities) {
      if (e.includes(canon) || canon.includes(e)) return true;
    }
    return false;
  };

  const yearsOfExperience = (skill: string): number => {
    const canon = canonicalize(skill);
    const skillWords = canon.split(" ");
    const intervals: Array<{ start: number; end: number }> = [];

    for (const f of facts) {
      if (f.kind !== "ROLE" && f.kind !== "EXPERIENCE_BULLET" && f.kind !== "PROJECT_BULLET") {
        continue;
      }
      const haystack = normalizeTerm(f.text) + " " + f.entities.map((e) => normalizeTerm(e)).join(" ");
      const mentions = skillWords.every((w) => haystack.includes(w)) || haystack.includes(canon);
      if (!mentions || !f.startDate) continue;

      const startRe = /^(\d{4})-(\d{2})/.exec(f.startDate);
      if (!startRe) continue;
      const start = Number(startRe[1]) * 12 + (Number(startRe[2]) - 1);
      let end: number;
      const endRe = f.endDate ? /^(\d{4})-(\d{2})/.exec(f.endDate) : null;
      if (endRe) {
        end = Number(endRe[1]) * 12 + (Number(endRe[2]) - 1);
      } else {
        const nowDate = opts.now ? new Date(opts.now) : new Date();
        end = nowDate.getUTCFullYear() * 12 + nowDate.getUTCMonth();
      }
      intervals.push({ start, end });
    }

    intervals.sort((a, b) => a.start - b.start);
    let total = 0;
    let curStart = -1;
    let curEnd = -1;
    for (const iv of intervals) {
      if (curStart === -1) {
        curStart = iv.start;
        curEnd = iv.end;
      } else if (iv.start <= curEnd + 1) {
        curEnd = Math.max(curEnd, iv.end);
      } else {
        total += curEnd - curStart + 1;
        curStart = iv.start;
        curEnd = iv.end;
      }
    }
    if (curStart !== -1) total += curEnd - curStart + 1;

    return Math.round((total / 12) * 10) / 10;
  };

  return { facts, numbers, entities, yearsOfExperience, hasSkill };
}

export { looksLikeTool };
