/**
 * The Answer Bank coverage loop: what Auto-Pilot's own stop notifications say
 * about the questions this account cannot answer yet.
 *
 * The input is audited data only — `autopilot.notify` rows (one per human-needed
 * stop) plus the `NEEDS_HUMAN` application events those stops produced. Nothing
 * here reads a page, calls a model or stores a form label: the output is the
 * count per reason, the Answer Bank keys that would have prevented the stop, and
 * a link to add each one.
 */
import { normalizeAnswerKey } from "./answers.js";

/** One audited stop notification (`autopilot.notify`). */
export interface NotifyStop {
  code: string;
  delivered: boolean;
  at: Date;
}

/** One question the run could not answer, as recorded on the application. */
export interface MissingAnswer {
  key: string | null;
  at: Date;
}

export interface CoverageGroup {
  /** The stop code the run audited, e.g. `NEEDS_HUMAN_FIELDS`. */
  code: string;
  count: number;
  lastAt: string;
  /** What this stop means and where it is fixed. */
  note: string;
  href: string | null;
}

export interface CoverageSuggestion {
  key: string;
  questionPattern: string;
  count: number;
  lastAt: string;
  /** Where the form prefills this key and pattern. */
  addHref: string;
}

export interface CoverageReport {
  totalStops: number;
  groups: CoverageGroup[];
  suggestions: CoverageSuggestion[];
  /** Stops whose reason has no Answer Bank fix (a captcha, a cap, a kill switch). */
  unanswerable: number;
}

/**
 * Where a stop is fixed when an answer is not the cure. A code that is missing
 * here still appears in the report, with a plain note and no link, rather than
 * being dropped or guessed at.
 */
const FIX_BY_CODE: Record<string, { note: string; href: string | null }> = {
  NEEDS_HUMAN_FIELDS: {
    note: "The form asked something Auto-Pilot could not answer from your data.",
    href: "#answer-form",
  },
  NO_APPROVED_RESUME: {
    note: "There was no approved resume version to attach.",
    href: "/tailor",
  },
  CONFIRMATION_MISSING: {
    note: "The page never showed a submission confirmation, so it was left with you.",
    href: null,
  },
  NO_SUBMIT_CONTROL: {
    note: "The page had no submit control Auto-Pilot could find.",
    href: null,
  },
  STEP_LIMIT: {
    note: "The form had more steps than one run may walk.",
    href: null,
  },
  KILL_SWITCH: {
    note: "Auto-Pilot was stopped by the kill switch.",
    href: "/settings",
  },
  DAILY_CAP: {
    note: "The daily submission cap was reached.",
    href: "/settings",
  },
  RATE_LIMIT: {
    note: "The per-host rate limit stopped the run.",
    href: "/settings",
  },
};

/**
 * A human phrasing for each canonical key, used as the question pattern when the
 * report links into the add-answer form. Only these two fields are sensitive
 * (I5); anything else keeps the key's own words.
 */
const PATTERN_BY_KEY: Record<string, string> = {
  salary_expectation: "salary|compensation|expected\\s+(pay|ctc|rate)",
  work_auth: "work(ing)?\\s+authori[sz]ation|visa|sponsor",
};

const DEFAULT_NOTE = "Auto-Pilot stopped and left this application for you.";
const DEFAULT_PATTERN_NOTE = "question";

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

function patternFor(key: string): string {
  const normalized = normalizeAnswerKey(key);
  return PATTERN_BY_KEY[normalized] ?? escapeForPattern(normalized.replace(/_/g, " "));
}

/**
 * Groups the audited stops by reason and proposes the Answer Bank entries that
 * would have prevented the answerable ones. A key the account already has is not
 * proposed — the point is what is missing, not what is there.
 */
export function buildAnswerCoverage(input: {
  stops: readonly NotifyStop[];
  missing: readonly MissingAnswer[];
  answeredKeys: readonly string[];
}): CoverageReport {
  const answered = new Set(input.answeredKeys.map((key) => normalizeAnswerKey(key)));

  const byCode = new Map<string, { count: number; lastAt: Date }>();
  for (const stop of input.stops) {
    const current = byCode.get(stop.code);
    if (!current) {
      byCode.set(stop.code, { count: 1, lastAt: stop.at });
      continue;
    }
    current.count += 1;
    if (stop.at > current.lastAt) current.lastAt = stop.at;
  }

  const groups: CoverageGroup[] = [...byCode.entries()]
    .map(([code, value]) => {
      const fix = FIX_BY_CODE[code];
      return {
        code,
        count: value.count,
        lastAt: value.lastAt.toISOString(),
        note: fix?.note ?? DEFAULT_NOTE,
        href: fix ? fix.href : null,
      };
    })
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  const byKey = new Map<string, { count: number; lastAt: Date }>();
  for (const row of input.missing) {
    if (!row.key) continue;
    const key = normalizeAnswerKey(row.key);
    if (!key || answered.has(key)) continue;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { count: 1, lastAt: row.at });
      continue;
    }
    current.count += 1;
    if (row.at > current.lastAt) current.lastAt = row.at;
  }

  const suggestions: CoverageSuggestion[] = [...byKey.entries()]
    .map(([key, value]) => ({
      key,
      questionPattern: patternFor(key),
      count: value.count,
      lastAt: value.lastAt.toISOString(),
      addHref: `/answers?key=${encodeURIComponent(key)}&questionPattern=${encodeURIComponent(
        patternFor(key),
      )}#answer-form`,
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  const answerable = suggestions.reduce((total, suggestion) => total + suggestion.count, 0);
  const totalStops = input.stops.length;

  return {
    totalStops,
    groups,
    suggestions,
    unanswerable: Math.max(0, totalStops - answerable),
  };
}

/** One line for the UI, so the empty and full states read the same way. */
export function coverageSummary(report: CoverageReport): string {
  if (report.totalStops === 0) {
    return `No Auto-Pilot stops recorded yet; the ${DEFAULT_PATTERN_NOTE} bank is untested.`;
  }
  if (report.suggestions.length === 0) {
    return `${report.totalStops} stop(s) recorded, none of them fixable with a new answer.`;
  }
  return `${report.totalStops} stop(s) recorded, ${report.suggestions.length} answer(s) would have prevented the answerable ones.`;
}
